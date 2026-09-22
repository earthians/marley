# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and Contributors
# See license.txt

import frappe

from healthcare.tests.utils import HealthcareTestSuite


class TestMedicationInteraction(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		self.warfarin = create_class("_Test Warfarins")
		self.salicylate = create_class("_Test Salicylates")

	def test_interactants_must_differ(self):
		self.assertRaises(frappe.ValidationError, create_interaction, self.warfarin, self.warfarin)

	def test_duplicate_in_reverse_order_is_blocked(self):
		create_interaction(self.warfarin, self.salicylate)

		self.assertRaises(frappe.ValidationError, create_interaction, self.salicylate, self.warfarin)

	def test_title_names_both_interactants(self):
		interaction = create_interaction(self.warfarin, self.salicylate)

		self.assertIn(self.warfarin, interaction.title)
		self.assertIn(self.salicylate, interaction.title)


def create_class(medication_class):
	return frappe.get_doc({"doctype": "Medication Class", "medication_class": medication_class}).insert().name


def create_interaction(interactant_a, interactant_b, severity="Major"):
	return frappe.get_doc(
		{
			"doctype": "Medication Interaction",
			"interactant_a_type": "Medication Class",
			"interactant_a": interactant_a,
			"interactant_b_type": "Medication Class",
			"interactant_b": interactant_b,
			"severity": severity,
			"advice": "Monitor INR closely",
		}
	).insert()
