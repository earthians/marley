# Copyright (c) 2020, earthians Health Informatics Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase


class TestMedication(IntegrationTestCase):
	def test_medication_item(self):
		price_list = get_price_list()
		frappe.db.set_single_value("Selling Settings", "selling_price_list", price_list)
		medication, item = create_medication("Paracetamol", is_billable=True)

		self.assertTrue(medication.linked_items[0].item)
		self.assertTrue(frappe.db.exists("Item", "Paracetamol"))

		self.assertTrue(frappe.db.exists("Item Price", {"item_code": item, "price_list": price_list}))

		self.assertEqual(
			frappe.db.get_value(
				"Item Price", {"item_code": item, "price_list": price_list}, "price_list_rate"
			),
			25,
		)


def create_medication(medication, is_billable=False, price_list=None):
	make_medication_class("Medication")
	if frappe.db.exists("Medication", medication):
		medication_doc = frappe.get_doc("Medication", medication)
		item = None
		if medication_doc.linked_items and len(medication_doc.linked_items):
			item = medication_doc.linked_items[0].item

		return medication_doc, item

	medication_doc = frappe.new_doc("Medication")
	medication_doc.generic_name = medication
	medication_doc.medication_class = "Medication"
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


def make_medication_class(medication_class_name):
	if not frappe.db.exists("Medication Class", medication_class_name):
		medication_class = frappe.new_doc("Medication Class")
		medication_class.medication_class = medication_class_name
		medication_class.save()


def get_price_list():
	price_list = frappe.db.exists("Price List", "Standard Selling")
	if not price_list:
		price_list_doc = frappe.new_doc("Price List")
		price_list_doc.price_list_name = "Standard Selling"
		price_list_doc.selling = 1
		price_list_doc.save()

		price_list = price_list_doc.name

	return price_list
