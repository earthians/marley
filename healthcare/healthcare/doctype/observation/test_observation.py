# Copyright (c) 2023, healthcare and Contributors
# See license.txt

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import flt, getdate, nowtime

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import (
	get_income_account,
	get_receivable_account,
)
from healthcare.healthcare.doctype.service_request.service_request import make_observation
from healthcare.tests.utils import HealthcareTestSuite


class TestObservation(HealthcareTestSuite):
	def test_single_observation_from_invoice_without_sample(self):
		self.enable_observation_on_invoice_submit()

		obs_name = "_Test Observation without Sample"
		patient = self.get_test_patient()
		obs_template = frappe.get_doc("Observation Template", obs_name)
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

	def test_single_observation_from_invoice_with_sample(self):
		self.enable_observation_on_invoice_submit()

		patient = self.get_test_patient()
		obs_name = "_Test Observation with Sample"
		obs_template = frappe.get_doc("Observation Template", obs_name)
		sales_invoice = create_sales_invoice(patient, obs_name)

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

	def test_has_component_observation_from_invoice_without_sample(self):
		self.enable_observation_on_invoice_submit()

		patient = self.get_test_patient()
		obs_name = "_Test Observation Grouped without Sample"
		obs_template = frappe.get_doc("Observation Template", obs_name)
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
				"Observation",
				{
					"observation_template": obs_name,
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

	def test_has_component_observation_from_invoice_with_sample(self):
		self.enable_observation_on_invoice_submit()

		patient = self.get_test_patient()
		obs_name = "_Test Observation Grouped with Sample"
		obs_template = frappe.get_doc("Observation Template", obs_name)
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
		observation_template = frappe.get_doc("Observation Template", "_Test Observation without Sample")
		patient = self.get_test_patient()
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

	def test_nested_component_sample_collection_from_encounter(self):
		grouped_template = frappe.get_doc("Observation Template", "_Test Observation Grouped with Sample")
		if frappe.db.exists("Observation Template", "_Test Encounter Nested Package"):
			package = frappe.get_doc("Observation Template", "_Test Encounter Nested Package")
		else:
			package = frappe.get_doc(
				{
					"doctype": "Observation Template",
					"observation": "_Test Encounter Nested Package",
					"item_code": "_Test Encounter Nested Package",
					"observation_category": "Laboratory",
					"item_group": "Services",
					"has_component": 1,
					"rate": 300,
					"is_billable": 1,
					"observation_component": [
						{"observation_template": grouped_template.name},
					],
				}
			).insert(ignore_permissions=True)
		patient = self.get_test_patient()
		encounter = create_patient_encounter(patient, package.name)
		service_request = frappe.db.get_value(
			"Service Request",
			{"patient": patient, "template_dn": package.name, "order_group": encounter.name},
			"name",
		)
		service_request_company = (
			frappe.db.get_value("Service Request", service_request, "company")
			or frappe.db.get_value("Patient Encounter", encounter.name, "company")
			or frappe.defaults.get_user_default("Company")
			or frappe.defaults.get_user_default("company")
			or frappe.db.get_single_value("Global Defaults", "default_company")
		)

		sample_collection, doctype = make_observation(service_request)

		self.assertEqual(doctype, "Sample Collection")
		self.assertTrue(
			frappe.db.exists(
				"Observation Sample Collection",
				{"parent": sample_collection, "observation_template": grouped_template.name},
			)
		)
		observations = frappe.db.get_all(
			"Observation",
			filters={"service_request": service_request},
			fields=["name", "company"],
		)
		self.assertTrue(observations)
		self.assertTrue(all(obs.company == service_request_company for obs in observations))
		component_observation_company = frappe.db.get_value(
			"Observation",
			{
				"parent_observation": observations[0].name,
				"observation_template": grouped_template.name,
			},
			"company",
		)
		self.assertEqual(component_observation_company, service_request_company)

	def test_formula_computes_result(self):
		self.enable_observation_on_invoice_submit()
		patient = self.get_test_patient()

		result = self.run_formula_test_case(
			patient=patient,
			input_value_1=5,
			input_value_2=2,
			operator="+",
		)

		self.assertEqual(flt(result["formula_1_result"]), 7)

	def test_formula_with_invalid_operand_keeps_result_empty(self):
		self.enable_observation_on_invoice_submit()
		patient = self.get_test_patient()

		result = self.run_formula_test_case(
			patient=patient,
			input_value_1="a",
			input_value_2=8,
			operator="*",
			operand_1_db_set=True,
		)

		self.assertIsNone(result["formula_1_result"])

	def test_formula_can_use_patient_custom_field(self):
		self.enable_observation_on_invoice_submit()
		self.ensure_patient_custom_field()

		patient = self.get_test_patient()
		custom_field_value = 10
		frappe.db.set_value("Patient", patient, "test_custom_field", custom_field_value)

		result = self.run_formula_test_case(
			patient=patient,
			input_value_1=5,
			input_value_2=2,
			operator="+",
			custom_formula=f"+{custom_field_value}",
		)

		self.assertEqual(flt(result["formula_1_result"]), 17)

	def test_formula_respects_patient_condition(self):
		self.enable_observation_on_invoice_submit()
		patient = self.get_test_patient()

		result = self.run_formula_test_case(
			patient=patient,
			input_value_1=7,
			input_value_2=5,
			operator="+",
			condition1="gender=='Male'",
			condition2="gender=='Female'",
		)

		self.assertEqual(flt(result["formula_2_result"]), 2)

	def test_sanitize_input_strips_unsafe_html(self):
		observation = frappe.new_doc("Observation")
		observation.result_text = "<p>Normal</p><script>alert('xyz')</script>"
		observation.result_interpretation = "<b>High</b><img src=xyz onerror=alert(1)>"
		observation.note = "<span onclick='steal_data()'>Note</span>"

		observation.sanitize_input()

		self.assertNotIn("<script", observation.result_text)
		self.assertIn("Normal", observation.result_text)
		self.assertNotIn("onerror", observation.result_interpretation)
		self.assertIn("High", observation.result_interpretation)
		self.assertNotIn("onclick", observation.note)
		self.assertIn("Note", observation.note)

	def run_formula_test_case(
		self,
		patient,
		input_value_1,
		input_value_2,
		operator,
		custom_formula="",
		condition1=None,
		condition2=None,
		operand_1_db_set=False,
	):
		obs_name = "_Test Observation Grouped without Sample"
		obs_template = frappe.get_doc("Observation Template", obs_name)

		first_component = obs_template.observation_component[0]
		first_abbr = first_component.abbr
		first_obs_template = first_component.observation_template

		operand_2_template = frappe.get_doc("Observation Template", "_Test Observation Operand 2")
		result_template_1 = frappe.get_doc("Observation Template", "_Test Observation Formula Result 1")

		obs_template.append(
			"observation_component",
			{
				"observation_template": operand_2_template.name,
				"abbr": operand_2_template.abbr,
			},
		)

		obs_template.append(
			"observation_component",
			{
				"observation_template": result_template_1.name,
				"abbr": "TF1",
				"based_on_formula": 1,
				"formula": f"{first_abbr}{operator}{operand_2_template.abbr} {custom_formula}".strip(),
				"condition": condition1,
			},
		)

		result_template_2 = None
		if condition2:
			result_template_2 = frappe.get_doc("Observation Template", "_Test Observation Formula Result 2")
			obs_template.append(
				"observation_component",
				{
					"observation_template": result_template_2.name,
					"abbr": "TF2",
					"based_on_formula": 1,
					"formula": f"{first_abbr}-{operand_2_template.abbr}",
					"condition": condition2,
				},
			)

		obs_template.save()

		create_sales_invoice(patient, obs_template.name)

		child_obs_1 = self.get_latest_observation_name(patient, first_obs_template)
		child_obs_2 = self.get_latest_observation_name(patient, operand_2_template.name)

		if not operand_1_db_set:
			child_obs_1_doc = frappe.get_doc("Observation", child_obs_1)
			child_obs_1_doc.result_data = str(input_value_1)
			child_obs_1_doc.save()
		else:
			frappe.db.set_value("Observation", child_obs_1, "result_data", str(input_value_1))

		child_obs_2_doc = frappe.get_doc("Observation", child_obs_2)
		child_obs_2_doc.result_data = str(input_value_2)
		child_obs_2_doc.save()

		return {
			"formula_1_result": self.get_result_data(patient, result_template_1.name),
			"formula_2_result": self.get_result_data(patient, result_template_2.name)
			if result_template_2
			else None,
		}

	def get_latest_observation_name(self, patient, observation_template):
		rows = frappe.get_all(
			"Observation",
			filters={
				"patient": patient,
				"observation_template": observation_template,
			},
			fields=["name"],
			order_by="creation desc",
			limit=1,
		)

		self.assertTrue(rows, f"No Observation found for template {observation_template}")
		return rows[0].name

	def get_result_data(self, patient, observation_template):
		rows = frappe.get_all(
			"Observation",
			filters={
				"patient": patient,
				"observation_template": observation_template,
			},
			fields=["name", "result_data"],
			order_by="creation desc",
			limit=1,
		)

		self.assertTrue(rows, f"No Observation found for template {observation_template}")
		return rows[0].result_data

	def get_test_patient(self):
		return frappe.get_list("Patient", pluck="name")[0]

	def enable_observation_on_invoice_submit(self):
		frappe.db.set_single_value("Healthcare Settings", "create_observation_on_si_submit", 1)

	def ensure_patient_custom_field(self):
		custom_fields = {
			"Patient": [
				{
					"fieldname": "test_custom_field",
					"label": "Test Calculation",
					"fieldtype": "Int",
				}
			]
		}
		create_custom_fields(custom_fields, update=True)


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
	patient_encounter.company = "_Test Company"
	patient_encounter.practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
	patient_encounter.appointment_type = "_Test Appointment Type"
	patient_encounter.encounter_date = getdate()
	patient_encounter.encounter_time = nowtime()

	patient_encounter.append("lab_test_prescription", {"observation_template": observation_template})

	patient_encounter.submit()
	return patient_encounter
