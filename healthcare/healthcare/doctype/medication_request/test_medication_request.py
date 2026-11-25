# Copyright (c) 2022, healthcare and Contributors
# See license.txt

import frappe
from frappe.utils import get_time, now

from erpnext.stock.doctype.item.test_item import create_item

from healthcare.healthcare.doctype.service_request.test_service_request import (
	create_encounter,
	create_sales_invoice,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestMedicationRequest(HealthcareTestSuite):
	def test_medication_request(self):
		patient = "_Test Patient"
		practitioner = "_Test Healthcare Practitioner 2"
		medication = frappe.get_doc("Medication", "Tablet Paracetamol 300Milligram")
		encounter = create_encounter(patient, practitioner, "drug_prescription", medication, submit=True)
		self.assertTrue(frappe.db.exists("Medication Request", {"order_group": encounter.name}))
		medication_request = frappe.db.get_value(
			"Medication Request", {"order_group": encounter.name}, "name"
		)
		if medication_request:
			medication_request_doc = frappe.get_doc("Medication Request", medication_request)
			medication_request_doc.submit()
			create_sales_invoice(patient, medication_request_doc, medication, "drug_prescription")
			self.assertEqual(
				frappe.db.get_value("Medication Request", medication_request_doc.name, "qty_invoiced"),
				1,
			)
			self.assertEqual(
				frappe.db.get_value("Medication Request", medication_request_doc.name, "billing_status"),
				"Invoiced",
			)

	def test_medication_qty_calculation(self):
		patient = "_Test Patient"
		practitioner = "_Test Healthcare Practitioner 2"
		medication = frappe.get_doc("Medication", "Tablet Paracetamol 300Milligram")

		# Create Medication Request
		medication_item = (
			medication.linked_items[0].item
			if hasattr(medication, "linked_items") and len(medication.linked_items) > 0
			else ""
		)

		medication_request = frappe.get_doc(
			{
				"doctype": "Medication Request",
				"patient": patient,
				"practitioner": practitioner,
				"medication": medication.name,
				"medication_item": medication_item,
				"dosage": "1-0-1",
				"period": "2 Day",
				"dosage_form": medication.dosage_form,
				"number_of_repeats_allowed": 2,
				"order_time": get_time(now()),
				"company": "_Test Company",
			}
		).insert(ignore_permissions=True)

		self.assertEqual(medication_request.quantity, 4)
		self.assertEqual(medication_request.total_dispensable_quantity, 12)
