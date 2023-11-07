# Copyright (c) 2023, healthcare and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import getdate, nowtime

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import (
	get_income_account,
	get_receivable_account,
)
from healthcare.healthcare.doctype.lab_test.test_lab_test import create_practitioner
from healthcare.healthcare.doctype.observation_template.test_observation_template import (
	create_grouped_observation_template,
	create_observation_template,
)
from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import (
	create_patient,
)


class TestObservation(FrappeTestCase):
	def test_single_observation_from_invoice(self):
		frappe.db.set_single_value("Healthcare Settings", "create_observation_on_si_submit", 1)
		obs_name = "Total Cholesterol"
		# observation without sample
		patient = create_patient()
		obs_template = create_observation_template(obs_name)
		sales_invoice = create_sales_invoice(patient, obs_name)
		self.assertTrue(
			frappe.db.exists(
				"Observation",
				{
					"observation_template": obs_template.name,
					"patient": patient,
					"sales_invoice": sales_invoice.name,
				},
			)
		)

		self.assertTrue(
			frappe.db.exists(
				"Diagnostic Report",
				{
					"docname": sales_invoice.name,
					"patient": patient,
				},
			)
		)

		# observation with sample
		patient = create_patient()
		idx = 1
		obs_template = create_observation_template(obs_name, idx, True)
		sales_invoice = create_sales_invoice(patient, obs_name + str(idx))

		sample_docname = frappe.db.exists(
			"Sample Collection",
			{
				"patient": patient,
			},
		)

		self.assertTrue(sample_docname)
		self.assertTrue(
			frappe.db.exists(
				"Observation Sample Collection",
				{
					"parent": sample_docname,
					"observation_template": obs_template.name,
				},
			)
		)

		self.assertTrue(
			frappe.db.exists(
				"Diagnostic Report",
				{
					"docname": sales_invoice.name,
					"patient": patient,
				},
			)
		)

	def test_has_component_observation_from_invoice(self):
		frappe.db.set_single_value("Healthcare Settings", "create_observation_on_si_submit", 1)
		patient = create_patient()
		idx = 2
		obs_name = "Complete Blood Count (CBC)"
		obs_template = create_grouped_observation_template(obs_name, idx)
		sales_invoice = create_sales_invoice(patient, obs_name + str(idx))
		# parent_observation
		self.assertTrue(
			frappe.db.exists(
				"Observation",
				{
					"observation_template": obs_template.name,
					"patient": patient,
					"sales_invoice": sales_invoice.name,
				},
			)
		)

		# child_observation
		self.assertTrue(
			frappe.db.exists(
				"Observation",
				{
					"observation_template": obs_name + str(idx + 1),
					"patient": patient,
					"sales_invoice": sales_invoice.name,
				},
			)
		)

		self.assertTrue(
			frappe.db.exists(
				"Diagnostic Report",
				{
					"docname": sales_invoice.name,
					"patient": patient,
				},
			)
		)

		# observation with sample
		patient = create_patient()
		idx = 4  # since 3 is selected in previous grouped test
		obs_template = create_grouped_observation_template(obs_name, idx, True)
		sales_invoice = create_sales_invoice(patient, obs_name + str(idx))

		# parent_observation
		self.assertTrue(
			frappe.db.exists(
				"Observation",
				{
					"observation_template": obs_template.name,
					"patient": patient,
					"sales_invoice": sales_invoice.name,
				},
			)
		)

		sample_docname = frappe.db.exists(
			"Sample Collection",
			{
				"patient": patient,
			},
		)

		self.assertTrue(sample_docname)
		self.assertTrue(
			frappe.db.exists(
				"Observation Sample Collection",
				{
					"parent": sample_docname,
					"observation_template": obs_template.name,
				},
			)
		)

		self.assertTrue(
			frappe.db.exists(
				"Diagnostic Report",
				{
					"docname": sales_invoice.name,
					"patient": patient,
				},
			)
		)

	def test_observation_from_encounter(self):
		observation_template = create_observation_template("Total Cholesterol")
		patient = create_patient()
		encounter = create_patient_encounter(patient, observation_template.name)
		self.assertTrue(
			frappe.db.exists(
				"Service Request",
				{
					"patient": patient,
					"template_dn": observation_template.name,
					"order_group": encounter.name,
				},
			)
		)


def create_sales_invoice(patient, item):
	sales_invoice = frappe.new_doc("Sales Invoice")
	sales_invoice.patient = patient
	sales_invoice.customer = frappe.db.get_value("Patient", patient, "customer")
	sales_invoice.due_date = getdate()
	sales_invoice.company = "_Test Company"
	sales_invoice.debit_to = get_receivable_account("_Test Company")
	sales_invoice.append(
		"items",
		{
			"item_code": item,
			"item_name": item,
			"description": item,
			"qty": 1,
			"uom": "Nos",
			"conversion_factor": 1,
			"income_account": get_income_account(None, "_Test Company"),
			"rate": 300,
			"amount": 300,
		},
	)

	sales_invoice.set_missing_values()

	sales_invoice.submit()
	return sales_invoice


def create_patient_encounter(patient, observation_template):
	patient_encounter = frappe.new_doc("Patient Encounter")
	patient_encounter.patient = patient
	patient_encounter.practitioner = create_practitioner()
	patient_encounter.encounter_date = getdate()
	patient_encounter.encounter_time = nowtime()

	patient_encounter.append("lab_test_prescription", {"observation_template": observation_template})

	patient_encounter.submit()
	return patient_encounter
