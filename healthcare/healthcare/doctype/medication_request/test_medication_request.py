# Copyright (c) 2022, healthcare and Contributors
# See license.txt

import frappe
from frappe.utils import get_time, now

from erpnext.stock.doctype.item.test_item import create_item

from healthcare.healthcare.doctype.service_request.test_service_request import (
	create_encounter,
	create_sales_invoice,
)
from healthcare.healthcare.utils import get_drugs_to_invoice
from healthcare.tests.utils import HealthcareTestSuite


class TestMedicationRequest(HealthcareTestSuite):
	def test_medication_request(self):
		patient = frappe.get_list("Patient", pluck="name")[0]
		practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
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
		patient = frappe.get_list("Patient", pluck="name")[0]
		practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
		medication = frappe.get_doc("Medication", "Tablet Paracetamol 300Milligram")

		medication_request = create_medication_request(
			patient, practitioner, medication, number_of_repeats_allowed=2
		)

		self.assertEqual(medication_request.quantity, 4)
		self.assertEqual(medication_request.total_dispensable_quantity, 12)

	def test_medication_request_without_order_group_is_billable(self):
		"""a Medication Request raised outside a Patient Encounter has no order_group"""
		patient = frappe.get_list("Patient", pluck="name")[0]
		practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
		medication = frappe.get_doc("Medication", "Tablet Paracetamol 300Milligram")

		medication_request = create_medication_request(patient, practitioner, medication)
		medication_request.submit()
		self.assertFalse(medication_request.order_group)

		drugs = get_drugs_to_invoice(patient, get_customer(patient), company="_Test Company")
		self.assertIn(medication_request.name, [drug.get("reference_name") for drug in drugs])

	def test_medication_request_of_draft_encounter_is_billable(self):
		"""submit_orders_on_save submits Medication Requests of a still draft Patient Encounter"""
		patient = frappe.get_list("Patient", pluck="name")[0]
		practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
		medication = frappe.get_doc("Medication", "Tablet Paracetamol 300Milligram")

		encounter = create_encounter(patient, practitioner, "drug_prescription", medication)
		encounter.submit_orders_on_save = True
		encounter.save()
		self.assertEqual(encounter.docstatus, 0)

		drugs = get_drugs_to_invoice(
			patient, get_customer(patient), encounter=encounter.name, company="_Test Company"
		)
		self.assertEqual(len(drugs), 1)
		self.assertEqual(drugs[0].get("reference_type"), "Medication Request")

	def test_drugs_to_invoice_are_limited_to_the_given_encounter(self):
		patient = frappe.get_list("Patient", pluck="name")[0]
		practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
		medication = frappe.get_doc("Medication", "Tablet Paracetamol 300Milligram")

		encounter = create_encounter(patient, practitioner, "drug_prescription", medication, submit=True)
		standalone_request = create_medication_request(patient, practitioner, medication)
		standalone_request.submit()

		drugs = get_drugs_to_invoice(
			patient, get_customer(patient), encounter=encounter.name, company="_Test Company"
		)
		self.assertNotIn(standalone_request.name, [drug.get("reference_name") for drug in drugs])


def get_customer(patient):
	return frappe.db.get_value("Patient", patient, "customer")


def create_medication_request(patient, practitioner, medication, **kwargs):
	medication_item = medication.linked_items[0].item if medication.get("linked_items") else ""

	return frappe.get_doc(
		{
			"doctype": "Medication Request",
			"patient": patient,
			"practitioner": practitioner,
			"medication": medication.name,
			"medication_item": medication_item,
			"dosage": "1-0-1",
			"period": "2 Day",
			"dosage_form": medication.dosage_form,
			"order_time": get_time(now()),
			"company": "_Test Company",
			**kwargs,
		}
	).insert(ignore_permissions=True)
