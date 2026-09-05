# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and Contributors
# See license.txt

import frappe

from healthcare.healthcare.doctype.allergy.allergy_seed import read_seed
from healthcare.healthcare.doctype.medication_class.medication_class_seed import (
	get_seeded_class_names,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestAllergy(HealthcareTestSuite):
	def test_medication_allergen_keeps_its_substance(self):
		allergen = create_allergy("_Test Penicillin", substance="Analgesics")

		self.assertEqual(allergen.substance, "Analgesics")

	def test_non_medication_allergen_drops_its_substance(self):
		allergen = create_allergy("_Test Peanut", category="Food", substance="Analgesics")

		self.assertIsNone(allergen.substance)
		self.assertIsNone(allergen.substance_type)

	def test_medication_allergen_needs_a_substance(self):
		self.assertRaises(frappe.ValidationError, create_allergy, "_Test Sulfonamides", substance=None)

	def test_every_seeded_substance_exists_in_the_class_seed(self):
		substances = {record["substance"] for record in read_seed() if record.get("substance")}

		self.assertEqual(substances - get_seeded_class_names(), set())

	def test_seeded_allergens_are_installed(self):
		self.assertTrue(frappe.db.exists("Allergy", "Penicillin"))
		self.assertEqual(frappe.db.get_value("Allergy", "Penicillin", "substance"), "Penicillins")
		self.assertEqual(frappe.db.get_value("Allergy", "Peanut", "category"), "Food")
		self.assertIsNone(frappe.db.get_value("Allergy", "Peanut", "substance"))


def create_allergy(allergy_name, category="Medication", substance_type="Medication Class", substance=None):
	return frappe.get_doc(
		{
			"doctype": "Allergy",
			"allergy_name": allergy_name,
			"category": category,
			"substance_type": substance_type,
			"substance": substance,
		}
	).insert()
