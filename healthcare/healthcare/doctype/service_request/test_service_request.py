# -*- coding: utf-8 -*-
# Copyright (c) 2020, earthians and Contributors
# See license.txt
from __future__ import unicode_literals

import unittest

import frappe
from frappe.utils import getdate, nowtime

import erpnext

from healthcare.healthcare.doctype.clinical_procedure.test_clinical_procedure import (
	create_procedure,
)
from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import (
	get_income_account,
	get_receivable_account,
)
from healthcare.healthcare.doctype.lab_test.test_lab_test import (
	create_lab_test,
	create_lab_test_template,
)
from healthcare.healthcare.doctype.observation_template.test_observation_template import (
	create_observation_template,
)
from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import (
	create_clinical_procedure_template,
	create_healthcare_docs,
)
from healthcare.healthcare.doctype.service_request.service_request import make_clinical_procedure


class TestServiceRequest(unittest.TestCase):
	def test_creation_on_encounter_submission(self):
		patient, practitioner = create_healthcare_docs()
		insulin_resistance_template = create_lab_test_template()
		procedure_template = create_clinical_procedure_template()
		procedure_template.allow_stock_consumption = 1
		encounter = create_encounter(
			patient,
			practitioner,
			"lab_test_prescription",
			insulin_resistance_template,
			procedure_template,
			submit=True,
		)
		self.assertTrue(frappe.db.exists("Service Request", {"order_group": encounter.name}))
		service_request = frappe.db.get_all(
			"Service Request", {"order_group": encounter.name}, ["name", "template_dt"]
		)
		if service_request:
			for serv in service_request:
				service_request_doc = frappe.get_doc("Service Request", serv.get("name"))
				service_request_doc.submit()
				if serv.get("name"):
					if serv.get("template_dt") == "Lab Test Template":
						template = insulin_resistance_template
						type = "lab_test_prescription"
						doc = "Lab Test"
						test = create_lab_test(template)
						test.service_request = serv.get("name")
						test.descriptive_test_items[0].result_value = 1
						test.descriptive_test_items[1].result_value = 2
						test.descriptive_test_items[2].result_value = 3
						test.submit()
					elif serv.get("template_dt") == "Clinical Procedure Template":
						test = make_clinical_procedure(service_request_doc)
						test.submit()
						doc = "Clinical Procedure"
						template = procedure_template
						type = "procedure_prescription"

					# create sales invoice with service request and check service request and lab test is marked as invoiced
					create_sales_invoice(patient, service_request_doc, template, type)
					self.assertEqual(
						frappe.db.get_value("Service Request", serv.get("name"), "billing_status"), "Invoiced"
					)
					self.assertEqual(
						frappe.db.get_value("Service Request", serv.get("name"), "status"),
						"completed-Request Status",
					)
					self.assertTrue(frappe.db.get_value(doc, test.name, "invoiced"))

	def test_creation_on_encounter_with_create_order_on_save_checked(self):
		patient, practitioner = create_healthcare_docs()
		insulin_resistance_template = create_lab_test_template()
		encounter = create_encounter(
			patient, practitioner, "lab_test_prescription", insulin_resistance_template
		)
		encounter.submit_orders_on_save = True
		encounter.save()
		self.assertTrue(frappe.db.exists("Service Request", {"order_group": encounter.name}))
		encounter.submit()

		# to check if submit creates order
		self.assertEqual(
			frappe.db.count(
				"Service Request",
				filters={"order_group": encounter.name},
			),
			1,
		)

	def test_mark_observation_as_invoiced(self):
		obs_template = create_observation_template("Total Cholesterol")
		patient, practitioner = create_healthcare_docs()
		encounter = create_encounter(
			patient, practitioner, "lab_test_prescription", obs_template, submit=True, obs=True
		)
		service_request = frappe.db.get_value("Service Request", {"order_group": encounter.name}, "name")
		if service_request:
			service_request_doc = frappe.get_doc("Service Request", service_request)
			observation = create_observation(patient, service_request, obs_template.name)
			create_sales_invoice(patient, service_request_doc, obs_template, "observation")
			self.assertEqual(frappe.db.get_value("Observation", observation.name, "invoiced"), 1)


def create_encounter(
	patient, practitioner, type, template, procedure_template=False, submit=False, obs=False
):
	patient_encounter = frappe.new_doc("Patient Encounter")
	patient_encounter.patient = patient
	patient_encounter.practitioner = practitioner
	patient_encounter.encounter_date = getdate()
	patient_encounter.encounter_time = nowtime()
	if not obs:
		if type == "lab_test_prescription":
			patient_encounter.append(
				type, {"lab_test_code": template.item, "lab_test_name": template.lab_test_name}
			)
		elif type == "drug_prescription":
			patient_encounter.append(
				type, {"medication": template.name, "drug_code": template.linked_items[0].get("item")}
			)
	else:
		patient_encounter.append(type, {"observation_template": template.name})

	if procedure_template:
		patient_encounter.append(
			"procedure_prescription",
			{"procedure": procedure_template.template, "procedure_name": procedure_template.item_code},
		)

	if submit:
		patient_encounter.submit()
	else:
		patient_encounter.save()

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
	elif type in ["observation", "procedure_prescription"]:
		sales_invoice.append(
			"items",
			{
				"qty": 1,
				"uom": "Nos",
				"conversion_factor": 1,
				"income_account": get_income_account(None, "_Test Company"),
				"rate": template.rate,
				"amount": template.rate,
				"reference_dt": service_request.doctype,
				"reference_dn": service_request.name,
				"cost_center": erpnext.get_default_cost_center("_Test Company"),
				"item_code": template.item,
				"item_name": template.item_code,
				"description": template.description,
			},
		)

	sales_invoice.set_missing_values()

	sales_invoice.submit()
	return sales_invoice


def create_observation(patient, service_request, obs_template):
	observation = frappe.new_doc("Observation")
	observation.patient = patient
	observation.service_request = service_request
	observation.observation_template = obs_template
	observation.insert()
	return observation
