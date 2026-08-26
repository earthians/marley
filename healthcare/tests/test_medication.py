# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe

from healthcare.healthcare.api.medication import (
	DEFAULT_LEAD_TIME_MINUTES,
	MedicationScheduleSettings,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestMedicationScheduleSettings(HealthcareTestSuite):
	def set_lead_time(self, value):
		frappe.db.set_single_value("Healthcare Settings", "medication_dose_lead_time", value)
		frappe.clear_cache(doctype="Healthcare Settings")

	def test_lead_time_defaults_when_never_saved(self):
		self.set_lead_time(None)

		self.assertEqual(MedicationScheduleSettings().lead_time_minutes, DEFAULT_LEAD_TIME_MINUTES)

	def test_lead_time_defaults_when_left_at_zero(self):
		self.set_lead_time(0)

		self.assertEqual(MedicationScheduleSettings().lead_time_minutes, DEFAULT_LEAD_TIME_MINUTES)

	def test_a_configured_lead_time_is_used(self):
		self.set_lead_time(45)

		self.assertEqual(MedicationScheduleSettings().lead_time_minutes, 45)


class TestMedicationScheduling(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		from healthcare.healthcare.doctype.inpatient_record.inpatient_record import admit_patient
		from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import (
			create_inpatient,
			get_healthcare_service_unit,
		)

		frappe.db.sql("""delete from `tabInpatient Record`""")
		self.patient = frappe.get_list("Patient", pluck="name")[0]
		self.practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]

		record = create_inpatient(self.patient)
		record.expected_length_of_stay = 0
		record.save()
		record.reload()
		admit_patient(record, get_healthcare_service_unit(), frappe.utils.now_datetime())
		frappe.db.delete("Medication Administration", {"patient": self.patient})
		frappe.db.set_single_value("Healthcare Settings", "auto_schedule_medication_doses", 1)
		frappe.clear_cache(doctype="Healthcare Settings")

	def make_inpatient_order(self):
		order = frappe.new_doc("Inpatient Medication Order")
		order.patient = self.patient
		order.company = "_Test Company"
		order.practitioner = self.practitioner
		order.start_date = frappe.utils.getdate()
		order.add_order_entries(
			{
				"drug_code": "Dextromethorphan",
				"dosage": "1-1-1",
				"dosage_form": "Tablet",
				"period": "2 Day",
			}
		)
		order.insert(ignore_permissions=True)
		order.submit()
		self.issue_from_pharmacy(order)
		return order

	def issue_from_pharmacy(self, order):
		"""Inpatient Medication Entry sets this when it transfers the stock."""
		frappe.db.set_value(
			"Inpatient Medication Order Entry", {"parent": order.name}, "status", "Transferred"
		)

	def build(self, until=None):
		from healthcare.healthcare.api.medication import MedicationScheduler

		return MedicationScheduler(self.patient).build(
			until or frappe.utils.add_to_date(frappe.utils.now_datetime(), days=3)
		)

	def test_doses_become_medication_administrations(self):
		self.make_inpatient_order()

		created = self.build()

		self.assertTrue(created)
		self.assertEqual(
			frappe.db.count("Medication Administration", {"patient": self.patient}), len(created)
		)

	def test_running_twice_creates_no_duplicates(self):
		self.make_inpatient_order()

		first = self.build()
		second = self.build()

		self.assertTrue(first)
		self.assertEqual(second, [])

	def test_nothing_is_created_beyond_the_window(self):
		self.make_inpatient_order()

		created = MedicationSchedulerForPast(self.patient).build()

		self.assertEqual(created, [])

	def test_doses_from_before_the_backfill_floor_are_not_created(self):
		"""Switching the setting on must not import every historic dose."""
		from healthcare.healthcare.api.medication import MedicationScheduler

		order = self.make_inpatient_order()
		frappe.db.set_value(
			"Inpatient Medication Order Entry",
			{"parent": order.name},
			"date",
			frappe.utils.add_days(frappe.utils.getdate(), -30),
		)

		created = MedicationScheduler(self.patient).build()

		self.assertEqual(created, [])

	def test_a_discharged_patient_is_not_scheduled(self):
		order = self.make_inpatient_order()
		frappe.db.set_value("Inpatient Record", order.inpatient_record, "status", "Discharged")

		self.assertEqual(self.build(), [])

	def test_an_admission_still_open_is_scheduled(self):
		"""Anything short of discharged means the patient is on a ward."""
		order = self.make_inpatient_order()
		frappe.db.set_value("Inpatient Record", order.inpatient_record, "status", "Admission Scheduled")

		self.assertTrue(self.build())

	def test_doses_not_yet_issued_by_pharmacy_are_not_scheduled(self):
		order = self.make_inpatient_order()
		frappe.db.set_value("Inpatient Medication Order Entry", {"parent": order.name}, "status", "Pending")

		self.assertEqual(self.build(), [])

	def test_a_dose_left_undone_lapses_to_missed(self):
		"""It must not simply drop out of the round unrecorded."""
		from healthcare.healthcare.api.medication import ROUND_WINDOW_HOURS, lapse_missed_doses

		self.make_inpatient_order()
		dose = self.build()[0]
		frappe.db.set_value(
			"Medication Administration",
			dose,
			"scheduled_time",
			frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-(ROUND_WINDOW_HOURS + 1)),
		)

		lapse_missed_doses(self.patient)

		self.assertEqual(frappe.db.get_value("Medication Administration", dose, "status"), "Missed")

	def test_a_dose_still_on_the_round_does_not_lapse(self):
		from healthcare.healthcare.api.medication import lapse_missed_doses

		self.make_inpatient_order()
		dose = self.build()[0]

		lapse_missed_doses(self.patient)

		self.assertEqual(frappe.db.get_value("Medication Administration", dose, "status"), "Scheduled")

	def test_a_dose_already_given_never_lapses(self):
		from healthcare.healthcare.api.medication import ROUND_WINDOW_HOURS, lapse_missed_doses

		self.make_inpatient_order()
		dose = self.build()[0]
		frappe.db.set_value("Medication Administration", dose, "status", "Given")
		frappe.db.set_value(
			"Medication Administration",
			dose,
			"scheduled_time",
			frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-(ROUND_WINDOW_HOURS + 1)),
		)

		lapse_missed_doses(self.patient)

		self.assertEqual(frappe.db.get_value("Medication Administration", dose, "status"), "Given")

	def test_a_given_dose_drops_off_the_round(self):
		from healthcare.healthcare.api.medication import get_due_medications

		self.make_inpatient_order()
		dose = self.build()[0]
		frappe.db.set_value("Medication Administration", dose, "status", "Given")

		self.assertNotIn(dose, [row.name for row in get_due_medications(self.patient)])

	def test_a_held_dose_stays_in_view(self):
		from healthcare.healthcare.api.medication import get_due_medications

		self.make_inpatient_order()
		dose = self.build()[0]
		frappe.db.set_value("Medication Administration", dose, "status", "Held")

		self.assertIn(dose, [row.name for row in get_due_medications(self.patient)])

	def test_disabled_setting_creates_nothing(self):
		self.make_inpatient_order()
		frappe.db.set_single_value("Healthcare Settings", "auto_schedule_medication_doses", 0)
		frappe.clear_cache(doctype="Healthcare Settings")

		self.assertEqual(self.build(), [])


def MedicationSchedulerForPast(patient):
	"""A scheduler whose window closed before any dose was due."""
	from healthcare.healthcare.api.medication import MedicationScheduler

	class PastBuilder(MedicationScheduler):
		def build(self):
			return super().build(until=frappe.utils.add_to_date(frappe.utils.now_datetime(), days=-30))

	return PastBuilder(patient)


class TestMissedDosesAreVisible(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		self.patient = frappe.get_list("Patient", pluck="name")[0]
		frappe.db.delete("Medication Administration", {"patient": self.patient})

	def make_missed_dose(self, hours_ago):
		return frappe.get_doc(
			{
				"doctype": "Medication Administration",
				"patient": self.patient,
				"drug_code": frappe.get_list("Item", filters={"is_stock_item": 1}, pluck="name")[0],
				"dosage": 1,
				"status": "Missed",
				"scheduled_time": frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-hours_ago),
			}
		).insert(ignore_permissions=True)

	def test_a_recently_missed_dose_stays_on_the_pane(self):
		from healthcare.healthcare.api.medication import missed_doses

		dose = self.make_missed_dose(hours_ago=20)

		self.assertIn(dose.name, [row.name for row in missed_doses(self.patient)])

	def test_a_missed_dose_older_than_a_day_drops_off(self):
		from healthcare.healthcare.api.medication import missed_doses

		dose = self.make_missed_dose(hours_ago=30)

		self.assertNotIn(dose.name, [row.name for row in missed_doses(self.patient)])


class TestAdministeredMedicationLeavesTheWard(HealthcareTestSuite):
	"""The dose is issued from the bed and billed when a nurse gives it."""

	def setUp(self):
		super().setUp()
		from healthcare.healthcare.doctype.inpatient_record.inpatient_record import admit_patient
		from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import (
			create_inpatient,
			get_healthcare_service_unit,
		)

		frappe.db.sql("""delete from `tabInpatient Record`""")
		frappe.db.set_single_value("Healthcare Settings", "manage_inpatient_medication_stock", 1)
		frappe.clear_cache(doctype="Healthcare Settings")

		self.patient = frappe.get_list("Patient", pluck="name")[0]
		self.bed = frappe.get_doc("Healthcare Service Unit", get_healthcare_service_unit())
		self.bed.save()  # the setting is on, so the bed gets a warehouse

		record = create_inpatient(self.patient)
		record.expected_length_of_stay = 0
		record.save()
		record.reload()
		admit_patient(record, self.bed.name, frappe.utils.now_datetime())
		self.admission = record.name
		self.stock_the_bed()

	def tearDown(self):
		frappe.db.set_single_value("Healthcare Settings", "manage_inpatient_medication_stock", 0)
		frappe.clear_cache(doctype="Healthcare Settings")
		self.close_the_admission()

	def close_the_admission(self):
		"""Leave no admission behind, and no patient pointing at one that is gone."""
		frappe.db.set_value(
			"Patient",
			self.patient,
			{"inpatient_record": None, "inpatient_status": None},
			update_modified=False,
		)
		frappe.db.delete("Inpatient Record", {"name": self.admission})

	def stock_the_bed(self):
		"""Stands in for the Inpatient Medication Entry transfer."""
		from healthcare.healthcare.doctype.inpatient_medication_entry.test_inpatient_medication_entry import (
			make_stock_entry,
		)

		make_stock_entry()
		transfer = frappe.new_doc("Stock Entry")
		transfer.stock_entry_type = "Material Transfer"
		transfer.company = "_Test Company"
		row = transfer.append("items")
		row.item_code = "Dextromethorphan"
		row.qty = 2
		row.conversion_factor = 1
		row.s_warehouse = "Stores - _TC"
		row.t_warehouse = self.bed.warehouse
		transfer.submit()

	def give_a_dose(self):
		dose = frappe.get_doc(
			{
				"doctype": "Medication Administration",
				"patient": self.patient,
				"company": "_Test Company",
				"drug_code": "Dextromethorphan",
				"dosage": 1,
				"scheduled_time": frappe.utils.now_datetime(),
				"inpatient_record": self.admission,
				"status": "Scheduled",
			}
		).insert(ignore_permissions=True)

		dose.status = "Given"
		dose.save(ignore_permissions=True)
		return dose.reload()

	def test_a_given_dose_is_issued_from_the_bed_and_billed(self):
		dose = self.give_a_dose()

		self.assertTrue(dose.stock_entry)
		stock_entry = frappe.get_doc("Stock Entry", dose.stock_entry)
		self.assertEqual(stock_entry.purpose, "Material Issue")
		self.assertEqual(stock_entry.items[0].s_warehouse, self.bed.warehouse)
		self.assertEqual(stock_entry.items[0].qty, 1)

		billable = frappe.get_all(
			"Inpatient Record Item",
			filters={"parent": self.admission, "stock_entry": dose.stock_entry},
			fields=["item_code", "quantity", "invoiced"],
		)
		self.assertEqual(len(billable), 1)
		self.assertEqual(billable[0].item_code, "Dextromethorphan")
		self.assertEqual(billable[0].quantity, 1)
		self.assertEqual(billable[0].invoiced, 0)

	def test_a_dose_that_was_given_cannot_be_taken_back(self):
		dose = self.give_a_dose()

		dose.status = "Held"
		dose.reason = "changed my mind"
		self.assertRaises(frappe.ValidationError, dose.save)

	def test_a_dose_is_issued_once_however_often_it_is_saved(self):
		dose = self.give_a_dose()

		dose.site = "left arm"
		dose.save(ignore_permissions=True)
		dose.reload()

		issued = frappe.get_all("Stock Entry", filters={"name": dose.stock_entry})
		self.assertEqual(len(issued), 1)
		self.assertEqual(
			frappe.db.count(
				"Inpatient Record Item", {"parent": self.admission, "stock_entry": dose.stock_entry}
			),
			1,
		)
