# Copyright (c) 2026, Healthcare contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import today

from healthcare.api.op_prescription_cleanup import (
	_append_missing_lines,
)
from healthcare.api.patient_medication_order_import import (
	import_patient_medication_order_for_admission,
)
from healthcare.api.prescription_sync import (
	ERROR_LIMIT,
	HS_TABLE,
	IP_ADMISSION_TABLE,
	IP_TABLE,
	OP_TABLE,
	SAMPLE_LIMIT,
	_build_work_limit,
	_ip_missing_rows,
	_map_ip_rows,
	_map_op_rows,
	_new_progress,
	_numeric_sort_key,
	_record_errors,
	_record_samples,
	_summary_message,
	_tag_his_deduplicate,
)
from healthcare.api.utils.api_utility import get_next_transaction_number


class TestPrescriptionSyncRows(IntegrationTestCase):
	"""Oracle row mapping of the one-button prescription reconciliation.

	The job itself talks to Oracle, but the mapping decided here is what the
	regular importers consume: ``PATIENT_VISIT_PRESCRIPTION`` rows become the row
	format of ``patient_visit_prescription_import`` and ``IP_ADMISSION_MEDICINE``
	rows the row format of ``import_patient_medication_order_for_admission``. A
	mapping mistake silently imports the wrong medicine or drops a visit, so it
	is pinned here.
	"""

	def test_oracle_tables_are_the_legacy_sources(self):
		self.assertEqual(OP_TABLE, "PATIENT_VISIT_PRESCRIPTION")
		self.assertEqual(IP_TABLE, "IP_ADMISSION_MEDICINE")
		# Live CLINIC2 patient filter joins medicine rows through the admission header.
		self.assertEqual(IP_ADMISSION_TABLE, "IP_ADMISSION_01")

	def test_op_rows_are_mapped_to_the_importer_row(self):
		rows = _map_op_rows(
			[
				{
					"VISIT_CD": "136827",
					"PRESCRIP_ID": "0166879",
					"PATIENT_FILE_NO": "849995",
					"MEDICINE_CD": "0509494",
					"FREQUENCY": "HS",
					"HIST_ORD": "1",
					"NOTE": "after food",
					"CREATE_DATE": "2026-07-01 09:30:00",
					"BRANCH_NUM": "1",
				}
			]
		)

		self.assertEqual(len(rows), 1)
		row = rows[0]
		self.assertEqual(row["visit_cd"], "136827")
		# Prescrip / medicine ids keep the raw Oracle value here; the planner
		# and the importer normalise the zero padding themselves.
		self.assertEqual(row["prescrip_id"], "0166879")
		self.assertEqual(row["medicine_cd"], "0509494")
		self.assertEqual(row["patient_file_no"], "849995")
		self.assertEqual(row["frequency"], "HS")
		self.assertEqual(row["note"], "after food")
		self.assertEqual(row["branch_num"], "1")
		self.assertEqual(row["hist_ord"], 1)

	def test_op_rows_without_visit_are_dropped(self):
		rows = _map_op_rows(
			[
				{"PRESCRIP_ID": "1", "MEDICINE_CD": "2"},
				{"VISIT_CD": "", "PRESCRIP_ID": "3", "MEDICINE_CD": "4"},
				{"VISIT_CD": "10", "PRESCRIP_ID": "5", "MEDICINE_CD": "6"},
			]
		)

		self.assertEqual([row["visit_cd"] for row in rows], ["10"])

	def test_ip_rows_are_mapped_to_the_importer_row(self):
		rows = _map_ip_rows(
			[
				{
					"ADMISSION_NUM": "2338",
					"TRANS_NUM": "7703301",
					"MEDICINE_NUM": "000583",
					"DOSE_NOTES": "1 tab",
					"FREQUENCY": "OD",
					"START_DATE": "2026-06-02 00:00:00",
					"TRANS_DATE": "2026-06-01 00:00:00",
					"TRANS_TYPE": "2",
					"BRANCH_NUM": "1",
					"EFFECTIVE_STATUS": "1",
				}
			]
		)

		self.assertEqual(len(rows), 1)
		row = rows[0]
		self.assertEqual(row["admission_num"], "2338")
		self.assertEqual(row["trans_no"], "7703301")
		# Medicine ids keep the Oracle zero padding; the importer strips it when it
		# resolves the legacy ITEM_00_01 code (``_normalize_oracle_medicine_num``).
		self.assertEqual(row["medicine_num"], "000583")
		self.assertEqual(row["dose_notes"], "1 tab")
		self.assertEqual(row["frequency"], "OD")
		self.assertEqual(row["branch"], "1")
		self.assertEqual(row["effective_status"], "1")

	def test_ip_rows_without_admission_are_dropped(self):
		rows = _map_ip_rows(
			[
				{"TRANS_NUM": "1", "MEDICINE_NUM": "2"},
				{"ADMISSION_NUM": "2338", "TRANS_NUM": "3", "MEDICINE_NUM": "4"},
			]
		)

		self.assertEqual([row["admission_num"] for row in rows], ["2338"])

	def test_ip_missing_rows_uses_the_legacy_trans_num(self):
		lines = [
			{"trans_no": "100", "medicine_num": "5"},
			{"trans_no": "101", "medicine_num": "6"},
		]
		# ``trans_no`` values already stored as ``reference_no`` are not re-created.
		missing = _ip_missing_rows("ADM-1", lines, {"100"})
		self.assertEqual([row["trans_no"] for row in missing], ["101"])

	def test_numeric_sort_key_orders_legacy_ids(self):
		values = ["9", "136827", "100", "A-1"]
		self.assertEqual(sorted(values, key=_numeric_sort_key), ["9", "100", "136827", "A-1"])

	def test_work_limit_is_applied_per_phase(self):
		visits = [str(index) for index in range(10)]
		admissions = [str(index) for index in range(4)]
		self.assertEqual(_build_work_limit(visits, admissions, 3), (visits[:3], admissions[:3]))
		self.assertEqual(_build_work_limit(visits, admissions, 0), (visits, admissions))



class TestPrescriptionSyncProgress(IntegrationTestCase):
	def test_new_progress_starts_empty(self):
		progress = _new_progress()
		self.assertEqual(progress["state"], "queued")
		self.assertEqual(progress["phase"], "op")
		self.assertEqual(progress["op_created"], 0)
		self.assertEqual(progress["ip_created"], 0)
		self.assertEqual(progress["errors"], [])
		self.assertEqual(progress["samples"], [])

	def test_samples_and_errors_are_capped(self):
		progress = _new_progress()
		_record_samples(progress, [f"visit {index}" for index in range(SAMPLE_LIMIT + 5)])
		self.assertEqual(len(progress["samples"]), SAMPLE_LIMIT)

		_record_errors(progress, [f"error {index}" for index in range(ERROR_LIMIT + 2)])
		self.assertEqual(len(progress["errors"]), ERROR_LIMIT)
		self.assertEqual(progress["failed"], ERROR_LIMIT + 2)
		# Blank entries are ignored by both recorders.
		_record_errors(progress, ["", None])
		self.assertEqual(progress["failed"], ERROR_LIMIT + 2)

	def test_summary_message_reports_both_sides(self):
		progress = _new_progress()
		progress.update(
			{
				"op_visits": 10,
				"op_complete_visits": 6,
				"op_missing_visits": 2,
				"op_partial_visits": 2,
				"op_missing_lines": 5,
				"op_created": 2,
				"op_updated": 2,
				"op_added_lines": 3,
				"op_hs_visits": 3,
				"op_hs_lines": 74,
				"op_hs_deduplicate_lines": 74,
				"op_hs_created": 7,
				"op_hs_updated": 0,
				"op_hs_skipped": 0,
				"ip_admissions": 4,
				"ip_complete_admissions": 3,
				"ip_gap_admissions": 1,
				"ip_missing_lines": 5,
				"ip_created": 1,
				"ip_added_lines": 5,
			}
		)

		message = _summary_message(progress)

		self.assertIn("OP - PATIENT_VISIT_PRESCRIPTION", message)
		self.assertIn("Visits checked: 10 (complete: 6)", message)
		self.assertIn("HIS - PATIENT_VISIT_PRESCRIPTION_HIS", message)
		self.assertIn("HIS visits: 3 (74 lines, 74 marked Is Deduplicate)", message)
		self.assertIn("HIS prescriptions created: 7, updated: 0, already complete: 0", message)
		self.assertNotIn("Duplicate PVP_HIS lines deleted", message)
		self.assertIn("IP - IP_ADMISSION_MEDICINE", message)
		self.assertIn("Admissions with missing lines: 1 (5 lines)", message)
		self.assertNotIn("DRY RUN", message)

	def test_summary_marks_a_dry_run(self):
		progress = _new_progress()
		progress["dry_run"] = 1
		progress["failed"] = 1
		progress["errors"] = ["PMO-1: boom"]

		message = _summary_message(progress)

		self.assertIn("DRY RUN", message)
		self.assertIn("Failed records: 1", message)
		self.assertIn("PMO-1: boom", message)
class TestPrescriptionSyncAppend(IntegrationTestCase):
	"""Lines Oracle gained after the first import (the newest admission) must still land.

	ERPNext freezes a submitted prescription: Posting Date, Start Date and the order counters
	cannot move any more, so an append may only grow the line table. Rebuilding the header from
	the newer Oracle row aborted every run with "Not allowed to change Posting Date after
	submission" whenever that row had no ``TRANS_DATE`` - exactly how the newest admission's
	discharge lines look - and those prescriptions stayed short for ever.
	"""

	def _admission(self, case_no: str) -> str:
		patient = frappe.get_doc(
			{"doctype": "Patient", "first_name": "_Test Prescription Append", "sex": "Female"}
		).insert(ignore_permissions=True)
		admission = frappe.get_doc(
			{
				"doctype": "Inpatient Admission",
				"case_no": case_no,
				"patient": patient.name,
				"company": "_Test Company",
				"scheduled_date": today(),
				"admission_date": today(),
			}
		).insert(ignore_permissions=True)
		return admission.name

	def _rows(self, admission: str, trans_no: str, start_date: str, trans_date: str | None) -> list[dict]:
		patient = frappe.db.get_value("Inpatient Admission", admission, "patient")
		return _map_ip_rows(
			[
				{
					"ADMISSION_NUM": admission,
					"PATIENT_NUM": patient,
					"TRANS_NUM": trans_no,
					"MEDICINE_NUM": "000583",
					"DOSE_NOTES": "1 tab",
					"FREQUENCY": "OD",
					"START_DATE": start_date,
					"TRANS_DATE": trans_date,
					"TRANS_TYPE": "1",
					"BRANCH_NUM": "1",
					"EFFECTIVE_STATUS": "1",
				}
			]
		)

	def test_ip_append_keeps_the_submitted_header(self):
		admission = self._admission("990001")

		first = import_patient_medication_order_for_admission(
			admission, self._rows(admission, "900001", "2026-06-28", "2026-06-28")
		)
		self.assertEqual(first["status"], "ok")
		pmo = frappe.get_doc("Patient Medication Order", first["pmo"])
		self.assertEqual(pmo.docstatus, 1)
		posting_date, start_date = pmo.posting_date, pmo.start_date

		# The newest Oracle row has no TRANS_DATE, like admission 2338's discharge lines.
		second = import_patient_medication_order_for_admission(
			admission, self._rows(admission, "900002", "2026-07-04", None)
		)

		self.assertEqual(second["status"], "ok")
		self.assertEqual(second["pmo"], pmo.name)
		self.assertEqual(second["added_lines"], 1)
		pmo.reload()
		self.assertEqual(pmo.posting_date, posting_date)
		self.assertEqual(pmo.start_date, start_date)
		self.assertEqual(pmo.docstatus, 1)
		self.assertEqual(len(pmo.medication_orders), 2)
		self.assertEqual(pmo.total_orders, 2)
		self.assertEqual(pmo.completed_orders, 2)
		self.assertEqual(
			sorted(row.reference_no for row in pmo.medication_orders), ["900001", "900002"]
		)

	def test_ip_append_is_idempotent(self):
		admission = self._admission("990002")
		rows = self._rows(admission, "900003", "2026-06-28", "2026-06-28")
		created = import_patient_medication_order_for_admission(admission, rows)

		again = import_patient_medication_order_for_admission(admission, rows)
		# The same TRANS_NUM twice: nothing is appended and no duplicate prescription is created.
		self.assertEqual(again["status"], "skip_no_new_lines")
		self.assertEqual(again["pmo"], created["pmo"])
		self.assertEqual(again["skipped"], 1)
		self.assertEqual(
			len(frappe.get_doc("Patient Medication Order", created["pmo"]).medication_orders), 1
		)


class TestPrescriptionSyncHsTable(IntegrationTestCase):
	"""``PATIENT_VISIT_PRESCRIPTION_HIS`` is imported as its own transactions.

	Every HIS row is kept. A ``PRESCIP_ID`` that ``PATIENT_VISIT_PRESCRIPTION`` also has is
	flagged ``is_deduplicate`` on the child line (UI can hide it). A ``PRESCIP_ID`` only HIS
	has is imported the same way with ``is_deduplicate = 0``. Repeats of the same id stay as
	separate lines.
	"""

	def test_hs_table_is_the_re_prescription_source(self):
		self.assertEqual(HS_TABLE, "PATIENT_VISIT_PRESCRIPTION_HIS")

	def test_his_line_also_on_pvp_is_marked_deduplicate(self):
		tagged = _tag_his_deduplicate(
			[
				{"prescrip_id": "0500", "medicine_cd": "005"},
				{"prescrip_id": "900", "medicine_cd": "7"},
			],
			{"500"},
		)

		self.assertEqual(tagged["deduplicate_lines"], 1)
		self.assertEqual(tagged["rows"][0]["is_deduplicate"], 1)
		self.assertEqual(tagged["rows"][1]["is_deduplicate"], 0)

	def test_his_repeats_of_the_same_prescrip_id_are_all_kept(self):
		tagged = _tag_his_deduplicate(
			[
				{"prescrip_id": "900", "medicine_cd": "7"},
				{"prescrip_id": "0900", "medicine_cd": "007"},
				{"prescrip_id": "900", "medicine_cd": "7"},
			],
			{"900"},
		)

		# Three HIS rows → three transactions; all flagged because OP already has 900.
		self.assertEqual(len(tagged["rows"]), 3)
		self.assertEqual(tagged["deduplicate_lines"], 3)
		self.assertTrue(all(row["is_deduplicate"] == 1 for row in tagged["rows"]))

	def test_his_only_prescrip_id_is_not_deduplicate(self):
		tagged = _tag_his_deduplicate(
			[{"prescrip_id": "1", "medicine_cd": "2"}],
			set(),
		)

		self.assertEqual(tagged["deduplicate_lines"], 0)
		self.assertEqual(tagged["rows"][0]["is_deduplicate"], 0)


class TestPrescriptionHsFlag(IntegrationTestCase):
	"""The ``from_hs_tb`` checkbox is ticked on the submitted prescription itself."""

	def _prescription(self) -> str:
		company = "_Test Company"
		if not frappe.db.exists("Company", company):
			company = (frappe.get_all("Company", pluck="name", limit=1) or [None])[0]
		doc = frappe.get_doc(
			{
				"doctype": "Patient Medication Order",
				"trans_no": get_next_transaction_number("Patient Medication Order", fieldname="trans_no"),
				"care_context": "Patient Visit",
				"company": company,
				"posting_date": today(),
				"start_date": today(),
				"medication_orders": [
					{"prescrip_id": "500", "medicine_num": "5", "frequency": "OD", "date": today()}
				],
			}
		).insert(ignore_permissions=True)
		doc.submit()
		return doc.name

	def test_hs_line_flags_the_submitted_prescription(self):
		pmo = self._prescription()

		outcome = _append_missing_lines(
			pmo,
			[{"prescrip_id": "900", "medicine_cd": "7", "frequency": "OD", "from_hs_tb": 1}],
		)

		self.assertEqual(outcome["status"], "updated")
		self.assertEqual(outcome["from_hs_tb"], 1)
		doc = frappe.get_doc("Patient Medication Order", pmo)
		self.assertEqual(doc.docstatus, 1)
		self.assertEqual(doc.from_hs_tb, 1)
		self.assertEqual(len(doc.medication_orders), 2)

	def test_legacy_line_keeps_the_prescription_unflagged(self):
		pmo = self._prescription()

		outcome = _append_missing_lines(
			pmo, [{"prescrip_id": "901", "medicine_cd": "7", "frequency": "OD"}]
		)

		self.assertEqual(outcome["status"], "updated")
		# A legacy line never ticks the HS flag.
		self.assertEqual(frappe.db.get_value("Patient Medication Order", pmo, "from_hs_tb"), 0)

