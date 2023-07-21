# -*- coding: utf-8 -*-
# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase


class TestHealthcarePractitioner(FrappeTestCase):
	def test_practitioner_mandatory_charges(self):
		fieldnames = ["op_consulting_charge", "inpatient_visit_charge"]
		for idx, fieldname in enumerate(fieldnames):
			item_fieldname = f"{fieldname}_item"
			charge_fieldname = f"{fieldname}"
			practitioner = frappe.get_doc(
				{
					"doctype": "Healthcare Practitioner",
					"first_name": f"__Test Healthcare Practitioner {idx}",
					"gender": "Female",
					item_fieldname: self.get_item(is_stock_item=False),
					charge_fieldname: 0,
				}
			)
			self.assertRaises(frappe.MandatoryError, practitioner.insert)

	def test_practitioner_service_item(self):
		fieldnames = ["op_consulting_charge", "inpatient_visit_charge"]
		for idx, fieldname in enumerate(fieldnames):
			item_fieldname = f"{fieldname}_item"
			charge_fieldname = f"{fieldname}"
			practitioner = frappe.get_doc(
				{
					"doctype": "Healthcare Practitioner",
					"first_name": f"__Test Healthcare Practitioner {idx}",
					"gender": "Male",
					item_fieldname: self.get_item(is_stock_item=True),
					charge_fieldname: 0,
				}
			)
			self.assertRaises(frappe.ValidationError, practitioner.insert)

	def get_item(self, is_stock_item=False):
		item_code = "__Test Stock Item" if is_stock_item else "__Test Service Item"

		if not frappe.db.exists("Item", item_code):
			return (
				frappe.get_doc(
					{
						"doctype": "Item",
						"name": item_code,
						"item_code": item_code,
						"item_name": item_code,
						"is_stock_item": is_stock_item,
						"item_group": "All Item Groups",
						"stock_uom": "Nos",
					}
				)
				.insert()
				.name
			)
		else:
			return item_code

	@classmethod
	def tearDown(cls):
		frappe.delete_doc_if_exists("Item", "__Test Stock Item", force=True)
		frappe.delete_doc_if_exists("Item", "__Test Service Item", force=True)
		frappe.db.sql(
			"""delete from `tabHealthcare Practitioner` where name like '__Test Healthcare Practitioner%'"""
		)
