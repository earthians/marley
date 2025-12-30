# Copyright (c) 2022, healthcare and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import get_time, now

from erpnext.stock.doctype.item.test_item import create_item

from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import (
	create_healthcare_docs,
)
from healthcare.healthcare.doctype.service_request.test_service_request import (
	create_encounter,
	create_sales_invoice,
)


class TestMedicationRequest(IntegrationTestCase):
	def setup(self):
		frappe.db.sql("""delete from `tabMedication` where name = '_Test Medication'""")

	def test_medication_request(self):
		patient, practitioner = create_healthcare_docs()
		medication = create_medication()
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
		patient, practitioner = create_healthcare_docs()
		medication = create_medication()

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
			}
		).insert(ignore_permissions=True)

		self.assertEqual(medication_request.quantity, 4)
		self.assertEqual(medication_request.total_dispensable_quantity, 12)


def create_medication():
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
			item_name = "_Test PL Item"
			item = create_item(item_code=item_name, is_stock_item=0)
			medication = frappe.get_doc(
				{
					"doctype": "Medication",
					"generic_name": "_Test Medication",
					"medication_class": "Tablet",
					"abbr": "Test",
					"strength": 500,
					"strength_uom": "Unit",
					"dosage_form": "Capsule",
					"default_prescription_dosage": "0-1-0",
					"default_prescription_duration": "1 Hour",
					"is_billable": 1,
					"rate": 800,
					"linked_items": [
						{"item": item.item_code, "item_code": item.item_name, "item_group": "Drug"}
					],
				}
			).insert(ignore_permissions=True, ignore_mandatory=True)
			return medication
		except frappe.DuplicateEntryError:
			pass
	else:
		return frappe.get_doc("Medication", "_Test Medication")
