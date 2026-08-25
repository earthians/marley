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
		frappe.db.set_value("Inpatient Medication Order Entry", {"parent": order.name}, "is_completed", 1)

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
		frappe.db.set_value("Inpatient Medication Order Entry", {"parent": order.name}, "is_completed", 0)

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
