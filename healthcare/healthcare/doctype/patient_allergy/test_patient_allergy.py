# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and Contributors
# See license.txt

import frappe

from healthcare.tests.utils import HealthcareTestSuite


class TestPatientAllergy(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		self.medication = frappe.db.get_value("Medication", {"generic_name": "Paracetamol"})

	def test_duplicate_active_allergy_is_blocked(self):
		create_patient_allergy("_Test Patient", "Medication", self.medication)

		self.assertRaises(
			frappe.ValidationError,
			create_patient_allergy,
			"_Test Patient",
			"Medication",
			self.medication,
		)

	def test_inactive_allergy_does_not_block_a_new_record(self):
		create_patient_allergy("_Test Patient 0", "Medication", self.medication, status="Inactive")
		allergy = create_patient_allergy("_Test Patient 0", "Medication", self.medication)

		self.assertEqual(allergy.status, "Active")

	def test_allergy_can_be_recorded_against_a_class(self):
		allergy = create_patient_allergy("_Test Patient 1", "Medication Class", "Analgesics")

		self.assertEqual(allergy.substance, "Analgesics")


def create_patient_allergy(patient, substance_type, substance, status="Active"):
	return frappe.get_doc(
		{
			"doctype": "Patient Allergy",
			"patient": patient,
			"substance_type": substance_type,
			"substance": substance,
			"status": status,
			"severity": "Severe",
		}
	).insert()
