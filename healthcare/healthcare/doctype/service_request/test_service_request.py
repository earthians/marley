# -*- coding: utf-8 -*-
# Copyright (c) 2020, earthians and Contributors
# See license.txt
from __future__ import unicode_literals

import unittest

import erpnext
import frappe
from frappe.utils import getdate, nowtime

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import (
	get_income_account,
	get_receivable_account,
)
from healthcare.healthcare.doctype.lab_test.test_lab_test import (
	create_lab_test,
	create_lab_test_template,
)
from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import (
	create_healthcare_docs,
)


class TestServiceRequest(unittest.TestCase):
	def test_creation_on_encounter_submission(self):
		patient, practitioner = create_healthcare_docs()
		insulin_resistance_template = create_lab_test_template()
		encounter = create_encounter(
			patient, practitioner, "lab_test_prescription", insulin_resistance_template
		)
		self.assertTrue(frappe.db.exists("Service Request", {"order_group": encounter.name}))
		service_request = frappe.db.get_value("Service Request", {"order_group": encounter.name}, "name")
		if service_request:
			service_request_doc = frappe.get_doc("Service Request", service_request)
			service_request_doc.submit()
			lab_test = create_lab_test(insulin_resistance_template)
			lab_test.service_request = service_request
			lab_test.descriptive_test_items[0].result_value = 1
			lab_test.descriptive_test_items[1].result_value = 2
			lab_test.descriptive_test_items[2].result_value = 3
			lab_test.submit()
			# create sales invoice with service request and check service request and lab test is marked as invoiced
			create_sales_invoice(
				patient, service_request_doc, insulin_resistance_template, "lab_test_prescription"
			)
			self.assertEqual(
				frappe.db.get_value("Service Request", service_request_doc.name, "billing_status"), "Invoiced"
			)
			self.assertTrue(frappe.db.get_value("Lab Test", lab_test.name, "invoiced"))


def create_encounter(patient, practitioner, type, template):
	patient_encounter = frappe.new_doc("Patient Encounter")
	patient_encounter.patient = patient
	patient_encounter.practitioner = practitioner
	patient_encounter.encounter_date = getdate()
	patient_encounter.encounter_time = nowtime()
	if type == "lab_test_prescription":
		patient_encounter.append(
			type, {"lab_test_code": template.item, "lab_test_name": template.lab_test_name}
		)
	elif type == "drug_prescription":
		patient_encounter.append(type, {"medication": template.name})

	patient_encounter.submit()
	return patient_encounter


def create_sales_invoice(patient, service_request, template, type):
	sales_invoice = frappe.new_doc("Sales Invoice")
	sales_invoice.patient = patient
	sales_invoice.customer = frappe.db.get_value("Patient", patient, "customer")
	sales_invoice.due_date = getdate()
	sales_invoice.currency = "INR"
	sales_invoice.company = "_Test Company"
	sales_invoice.debit_to = get_receivable_account("_Test Company")
	if type == "lab_test_prescription":
		sales_invoice.append(
			"items",
			{
				"qty": 1,
				"uom": "Nos",
				"conversion_factor": 1,
				"income_account": get_income_account(None, "_Test Company"),
				"rate": template.lab_test_rate,
				"amount": template.lab_test_rate,
				"reference_dt": service_request.doctype,
				"reference_dn": service_request.name,
				"cost_center": erpnext.get_default_cost_center("_Test Company"),
				"item_code": template.item,
				"item_name": template.lab_test_name,
				"description": template.lab_test_description,
			},
		)
	elif type == "drug_prescription":
		sales_invoice.append(
			"items",
			{
				"qty": 1,
				"uom": "Nos",
				"conversion_factor": 1,
				"income_account": get_income_account(None, "_Test Company"),
				"reference_dt": service_request.doctype,
				"reference_dn": service_request.name,
				"cost_center": erpnext.get_default_cost_center("_Test Company"),
				"item_name": template.name,
				"description": template.name,
			},
		)
	sales_invoice.set_missing_values()

	sales_invoice.submit()
	return sales_invoice
