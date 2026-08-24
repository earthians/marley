# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe
from frappe.utils import add_to_date, now_datetime

from healthcare.tests.utils import HealthcareTestSuite


class TestMedicationAdministration(HealthcareTestSuite):
	def setUp(self):
		self.patient = frappe.get_list("Patient", pluck="name")[0]
		self.drug = frappe.get_list("Item", filters={"is_stock_item": 1}, pluck="name")[0]
		frappe.db.delete("Medication Administration", {"patient": self.patient})

	def make(self, **kwargs):
		values = {
			"doctype": "Medication Administration",
			"patient": self.patient,
			"drug_code": self.drug,
			"dosage": 1,
			"scheduled_time": now_datetime(),
		}
		values.update(kwargs)
		return frappe.get_doc(values).insert(ignore_permissions=True)

	def test_a_new_dose_starts_scheduled(self):
		dose = self.make()

		self.assertEqual(dose.status, "Scheduled")
		self.assertFalse(dose.administered_time)

	def test_the_same_dose_cannot_be_recorded_twice(self):
		scheduled_time = now_datetime()
		self.make(scheduled_time=scheduled_time)

		self.assertRaises(frappe.UniqueValidationError, self.make, scheduled_time=scheduled_time)

	def test_a_different_slot_is_a_different_dose(self):
		scheduled_time = now_datetime()
		self.make(scheduled_time=scheduled_time)

		later = self.make(scheduled_time=add_to_date(scheduled_time, hours=6))

		self.assertTrue(later.name)

	def test_giving_a_dose_stamps_who_and_when(self):
		dose = self.make()

		dose.status = "Given"
		dose.save()

		self.assertTrue(dose.administered_time)
		self.assertEqual(dose.administered_by, frappe.session.user)

	def test_a_dose_not_given_needs_a_reason(self):
		dose = self.make()
		dose.status = "Held"

		self.assertRaises(frappe.ValidationError, dose.save)

	def test_a_held_dose_records_its_reason(self):
		dose = self.make()

		dose.status = "Held"
		dose.reason = "Systolic below 100"
		dose.save()

		self.assertEqual(dose.status, "Held")
		self.assertTrue(dose.administered_time)
