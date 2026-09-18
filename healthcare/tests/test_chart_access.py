# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe

from healthcare.healthcare.api.nursing_common import ChartAccess
from healthcare.tests.utils import HealthcareTestSuite

NURSE = "nurse@marleyhealth.io"
READER = "chart.reader@marleyhealth.io"  # may read patients and tasks, change nothing
NOBODY = "test_user@marleyhealth.io"  # a login with no clinical role at all
READER_ROLE = "_Test Chart Reader"


class TestChartAccess(HealthcareTestSuite):
	"""Who may write to a patient's chart, and against which record."""

	def setUp(self):
		super().setUp()
		from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import create_inpatient

		self.make_nurse()
		self.patient, self.other_patient = frappe.get_list("Patient", pluck="name", limit=2)
		frappe.db.sql("delete from `tabInpatient Record`")
		admission = create_inpatient(self.other_patient)
		admission.save()
		self.admission = admission.name

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.delete("Inpatient Record", {"name": self.admission})
		frappe.db.set_value(
			"Patient", self.other_patient, {"inpatient_record": None, "inpatient_status": None}
		)

	def make_nurse(self):
		self.make_user(NURSE, "Nursing User")
		self.make_reader_role()
		self.make_user(READER, READER_ROLE)

	def make_user(self, email, role):
		if frappe.db.exists("User", email):
			return
		frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": email.split("@")[0],
				"send_welcome_email": 0,
				"roles": [{"role": role}],
			}
		).insert(ignore_permissions=True)

	def make_reader_role(self):
		"""add_permission copies a doctype's standard permissions into custom
		ones before adding a row, so the roles it already had keep theirs."""
		from frappe.permissions import add_permission

		if not frappe.db.exists("Role", READER_ROLE):
			frappe.get_doc({"doctype": "Role", "role_name": READER_ROLE}).insert(ignore_permissions=True)
		for doctype in ("Patient", "Nursing Task"):
			add_permission(doctype, READER_ROLE)

	def test_a_login_without_a_clinical_role_cannot_write_the_chart(self):
		frappe.set_user(NOBODY)

		self.assertRaises(frappe.PermissionError, ChartAccess(self.patient).to_write, "Observation")

	def test_a_login_without_a_clinical_role_cannot_read_the_chart(self):
		frappe.set_user(NOBODY)

		self.assertRaises(frappe.PermissionError, ChartAccess(self.patient).to_read)

	def test_a_nurse_may_write_the_chart(self):
		frappe.set_user(NURSE)

		ChartAccess(self.patient).to_write("Observation")

	def test_a_nurse_cannot_file_an_entry_under_another_patients_record(self):
		frappe.set_user(NURSE)
		access = ChartAccess(self.patient, "Inpatient Record", self.admission)

		self.assertRaises(frappe.PermissionError, access.to_write, "Observation")

	def test_an_entry_may_be_filed_under_the_patients_own_record(self):
		frappe.set_user(NURSE)

		ChartAccess(self.other_patient, "Inpatient Record", self.admission).to_write("Observation")

	def test_an_entry_may_be_filed_under_the_patient_themselves(self):
		frappe.set_user(NURSE)

		ChartAccess(self.patient, "Patient", self.patient).to_write("Observation")

	def test_a_reference_needs_both_its_parts(self):
		self.assertRaises(
			frappe.ValidationError, ChartAccess(self.patient, "Inpatient Record").to_write, "Observation"
		)

	def test_a_document_without_a_patient_cannot_be_a_reference(self):
		access = ChartAccess(self.patient, "Company", "_Test Company")

		self.assertRaises(frappe.ValidationError, access.to_write, "Observation")

	def test_the_banner_will_not_read_another_patients_record(self):
		from healthcare.healthcare.api.nursing import get_banner

		frappe.set_user(NURSE)

		self.assertRaises(
			frappe.PermissionError, get_banner, self.patient, "Inpatient Record", self.admission
		)

	def test_the_scheduler_run_over_every_patient_is_not_callable_remotely(self):
		from healthcare.healthcare.api import medication

		self.assertNotIn(medication.schedule_due_medications, frappe.whitelisted)
		self.assertIn(medication.schedule_patient_medications, frappe.whitelisted)

	def test_a_reader_listing_tasks_does_not_lapse_them(self):
		"""Listing is a read; only a caller who could change the task may mark it Missed."""
		from healthcare.healthcare.api.nursing_tasks import TASK_LAPSE_HOURS, get_nursing_tasks

		task = self.make_task()
		frappe.db.set_value(
			"Nursing Task",
			task.name,
			"requested_start_time",
			frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-(TASK_LAPSE_HOURS + 1)),
		)
		frappe.set_user(READER)

		get_nursing_tasks(self.patient)

		self.assertEqual(frappe.db.get_value("Nursing Task", task.name, "status"), "Requested")

	def test_patient_search_is_refused_without_patient_access(self):
		from healthcare.healthcare.api.nursing import find_patients

		frappe.set_user(NOBODY)

		self.assertRaises(frappe.PermissionError, find_patients, self.other_patient)

	def test_a_record_number_the_caller_cannot_read_resolves_to_nobody(self):
		from healthcare.healthcare.api.nursing import find_patients

		frappe.set_user(READER)  # may read patients, but not admissions

		self.assertEqual(
			[match["matched_via"] for match in find_patients(self.admission) if match.get("matched_via")], []
		)

	def test_recording_vitals_as_nobody_is_refused(self):
		from healthcare.healthcare.api.vitals import record_vitals

		frappe.set_user(NOBODY)

		self.assertRaises(
			frappe.PermissionError, record_vitals, self.patient, {"_Test Pulse": 80}, "Patient", self.patient
		)

	def make_task(self):
		return frappe.get_doc(
			{
				"doctype": "Nursing Task",
				"patient": self.patient,
				"activity": "BP Check",
				"status": "Requested",
				"company": "_Test Company",
				"requested_start_time": frappe.utils.now_datetime(),
			}
		).insert()

	def test_updating_a_task_as_nobody_is_refused(self):
		from healthcare.healthcare.api.nursing_tasks import update_nursing_task

		task = self.make_task()
		frappe.set_user(NOBODY)

		self.assertRaises(frappe.PermissionError, update_nursing_task, task.name, "In Progress")
