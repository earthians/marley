# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and Contributors
# See license.txt

import frappe

from healthcare.healthcare.doctype.allergy.test_allergy import create_allergy
from healthcare.tests.utils import HealthcareTestSuite


class TestPatientAllergy(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		self.allergen = create_allergy("_Test Analgesic Allergy", substance="Analgesics").name

	def test_duplicate_active_allergy_is_blocked(self):
		create_patient_allergy("_Test Patient", self.allergen)

		self.assertRaises(frappe.ValidationError, create_patient_allergy, "_Test Patient", self.allergen)

	def test_inactive_allergy_does_not_block_a_new_record(self):
		create_patient_allergy("_Test Patient 0", self.allergen, status="Inactive")
		allergy = create_patient_allergy("_Test Patient 0", self.allergen)

		self.assertEqual(allergy.status, "Active")

	def test_category_is_fetched_from_the_allergen(self):
		peanut = create_allergy("_Test Peanut Allergy", category="Food").name
		allergy = create_patient_allergy("_Test Patient 1", peanut)

		self.assertEqual(allergy.allergy_category, "Food")


def create_patient_allergy(patient, allergy, status="Active"):
	return frappe.get_doc(
		{
			"doctype": "Patient Allergy",
			"patient": patient,
			"allergy": allergy,
			"status": status,
			"severity": "Severe",
		}
	).insert()
