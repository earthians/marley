# Copyright (c) 2022, healthcare and Contributors
# See license.txt

import unittest

import frappe

from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import (
	create_healthcare_docs,
)
from healthcare.healthcare.doctype.service_request.test_service_request import (
	create_encounter,
	create_sales_invoice,
)


class TestMedicationRequest(unittest.TestCase):
	def setup(self):
		frappe.db.sql("""delete from `tabMedication` where name = '_Test Medication'""")

	def test_medication_request(self):
		patient, practitioner = create_healthcare_docs()
		medication = create_medcation()
		encounter = create_encounter(patient, practitioner, "drug_prescription", medication)
		self.assertTrue(frappe.db.exists("Medication Request", {"order_group": encounter.name}))
		medication_request = frappe.db.get_value(
			"Medication Request", {"order_group": encounter.name}, "name"
		)
		if medication_request:
			medication_request_doc = frappe.get_doc("Medication Request", medication_request)
			medication_request_doc.submit()
			create_sales_invoice(patient, medication_request_doc, medication, "drug_prescription")
			self.assertEqual(
				frappe.db.get_value("Medication Request", medication_request_doc.name, "qty_invoiced"), 1
			)
			self.assertEqual(
				frappe.db.get_value("Medication Request", medication_request_doc.name, "billing_status"),
				"Invoiced",
			)


def create_medcation():
	if not frappe.db.exists("Medication", "_Test Medication"):
		if not frappe.db.exists("Medication Class", "Tablet"):
			try:
				medication = frappe.get_doc(
					{
						"doctype": "Medication Class",
						"medication_class": "Tablet",
					}
				).insert(ignore_permissions=True)
			except frappe.DuplicateEntryError:
				pass
		try:
			medication = frappe.get_doc(
				{
					"doctype": "Medication",
					"generic_name": "_Test Medication",
					"medication_class": "Tablet",
					"abbr": "Test",
					"strength": 500,
					"strength_uom": "Unit",
					"item_code": "_Test",
					"item_group": "Drug",
					"dosage_form": "Capsule",
					"default_prescription_dosage": "0-1-0",
					"default_prescription_duration": "1 Hour",
					"is_billable": 1,
					"rate": 800,
				}
			).insert(ignore_permissions=True, ignore_mandatory=True)
			return medication
		except frappe.DuplicateEntryError:
			pass
	else:
		return frappe.get_doc("Medication", "_Test Medication")
