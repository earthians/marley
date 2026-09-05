# Copyright (c) 2020, earthians Health Informatics Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.utils.make_random import get_random

from healthcare.healthcare.doctype.medication.medication import (
	expand,
	validate_medication_is_orderable,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestMedication(HealthcareTestSuite):
	def test_create_medication_item(self):
		price_list = frappe.db.get_single_value("Selling Settings", "selling_price_list")
		medication, item = create_medication("Aspirin", is_billable=True, price_list=price_list)

		self.assertTrue(medication.linked_items[0].item)
		self.assertTrue(frappe.db.exists("Item", "Aspirin"))
		self.assertTrue(frappe.db.exists("Item Price", {"item_code": item, "price_list": price_list}))
		self.assertEqual(
			frappe.db.get_value(
				"Item Price", {"item_code": item, "price_list": price_list}, "price_list_rate"
			),
			25,
		)

	def test_ingredient_only_medication_cannot_link_an_item(self):
		medication = create_ingredient_medication("_Test Clavulanic Acid")
		medication.append("linked_items", {"item_code": "_Test Clavulanic Acid", "item_group": "Drug"})

		self.assertRaises(frappe.ValidationError, medication.save)

	def test_ingredient_only_medication_cannot_be_ordered(self):
		medication = create_ingredient_medication("_Test Carbidopa")

		self.assertRaises(frappe.ValidationError, validate_medication_is_orderable, medication.name, "Row #1")

	def test_orderable_medication_passes_the_order_guard(self):
		medication = create_ingredient_medication("_Test Levodopa", is_orderable=1)

		self.assertIsNone(validate_medication_is_orderable(medication.name, "Row #1"))


def create_ingredient_medication(generic_name, is_orderable=0):
	medication = frappe.new_doc("Medication")
	medication.generic_name = generic_name
	medication.medication_class = "Analgesics"
	medication.strength = 125
	medication.strength_uom = "Milligram"
	medication.dosage_form = "Tablet"
	medication.is_orderable = is_orderable
	return medication.insert()


def create_medication(medication, is_billable=False, price_list=None):
	"""Testing if Item is auto created if is_billable is True"""
	medication_class = get_random("Medication Class")
	if frappe.db.exists("Medication", medication):
		medication_doc = frappe.get_doc("Medication", medication)
		item = None
		if medication_doc.linked_items and len(medication_doc.linked_items):
			item = medication_doc.linked_items[0].item

		return medication_doc, item

	medication_doc = frappe.new_doc("Medication")
	medication_doc.generic_name = medication
	medication_doc.medication_class = medication_class
	medication_doc.strength = 500
	medication_doc.strength_uom = "Milligram"
	medication_doc.price_list = price_list

	if not frappe.db.exists("Dosage Form", "Tablet"):
		frappe.get_doc({"doctype": "Dosage Form", "dosage_form": "Tablet"}).insert()
	medication_doc.dosage_form = "Tablet"
	medication_doc.append(
		"linked_items",
		{"item_code": medication, "item_group": "Drug", "is_billable": is_billable, "rate": 25},
	)
	medication_doc.save()
	return medication_doc, medication


class TestInteractantExpansion(HealthcareTestSuite):
	"""What a medication is matched against when a prescription is checked"""

	def setUp(self):
		super().setUp()
		self.amoxicillin = create_classed_medication("_Test Amoxicillin", "Amoxicillin")

	def test_expansion_reaches_every_ancestor_class(self):
		interactants = expand(self.amoxicillin)

		self.assertIn(("Medication", self.amoxicillin), interactants)
		self.assertIn(("Medication Class", "Amoxicillin"), interactants)
		self.assertIn(("Medication Class", "Penicillins"), interactants)
		self.assertIn(("Medication Class", "Anti-infectives"), interactants)

	def test_expansion_reaches_combination_ingredients(self):
		clavulanate = create_classed_medication("_Test Clavulanate", "Clavulanic Acid", is_orderable=0)
		combination = create_combination("_Test Co-Amoxiclav", [self.amoxicillin, clavulanate])

		interactants = expand(combination)

		self.assertIn(("Medication Class", "Clavulanic Acid"), interactants)
		self.assertIn(("Medication Class", "Penicillins"), interactants)

	def test_expansion_survives_a_self_referencing_combination(self):
		combination = create_combination("_Test Looping Product", [self.amoxicillin])
		medication = frappe.get_doc("Medication", combination)
		medication.append(
			"combinations", {"medication": combination, "strength": 1, "strength_uom": "Milligram"}
		)
		medication.save()

		self.assertIn(("Medication Class", "Amoxicillin"), expand(combination))


def create_classed_medication(generic_name, medication_class, is_orderable=1):
	existing = frappe.db.exists("Medication", {"generic_name": generic_name})
	if existing:
		return existing

	medication = frappe.new_doc("Medication")
	medication.generic_name = generic_name
	medication.medication_class = medication_class
	medication.strength = 100
	medication.strength_uom = "Milligram"
	medication.dosage_form = "Tablet"
	medication.is_orderable = is_orderable
	return medication.insert().name


def create_combination(generic_name, ingredients):
	existing = frappe.db.exists("Medication", {"generic_name": generic_name})
	if existing:
		return existing

	medication = frappe.new_doc("Medication")
	medication.generic_name = generic_name
	medication.medication_class = "Penicillins"
	medication.strength = 625
	medication.strength_uom = "Milligram"
	medication.dosage_form = "Tablet"
	medication.is_combination = 1

	for ingredient in ingredients:
		medication.append(
			"combinations", {"medication": ingredient, "strength": 1, "strength_uom": "Milligram"}
		)

	return medication.insert().name
