# Copyright (c) 2023, healthcare and Contributors
# See license.txt

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, getdate, nowtime

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
	def setUp(self):
		clear_table()

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

	def test_with_formula(self):
		patient = create_patient()
		with_correct_formula(self, patient=patient)
		with_incorrect_operand(self, patient)
		with_custom_field_in_patient(self, patient)
		with_condition_patient(self, patient)


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


def observation_with_formula(**kwargs):
	idx = 1
	obs_name = "Test Observation"
	operator = kwargs.get("operator")
	custom_formula = kwargs.get("custom_formula")
	condition1 = kwargs.get("condition1")
	condition2 = kwargs.get("condition2")
	obs_template = create_grouped_observation_template(obs_name, idx)
	first_abbr = obs_template.observation_component[0].abbr
	first_obs_template = obs_template.observation_component[0].observation_template

	obs_template_component = create_observation_template("Observation Comp ", idx + 2)
	obs_template_component_1 = create_observation_template("Observation Comp ", idx + 3)

	obs_template.append(
		"observation_component",
		{
			"observation_template": obs_template_component.name,
		},
	)

	obs_template.append(
		"observation_component",
		{
			"observation_template": obs_template_component_1.name,
			"based_on_formula": True,
			"formula": f"{first_abbr}{operator}{obs_template_component.abbr} {'+ test_custom_field' if custom_formula else ''}",
			"condition": condition1,
		},
	)

	if condition2:
		obs_template.append(
			"observation_component",
			{
				"observation_template": obs_template_component_1.name,
				"abbr": "TC5",
				"based_on_formula": True,
				"formula": f"{first_abbr}-{obs_template_component.abbr}",
				"condition": condition2,
			},
		)

	obs_template.save()

	create_sales_invoice(kwargs.get("patient"), obs_template.name)
	child_obs_1 = frappe.db.get_value(
		"Observation", {"observation_template": first_obs_template}, "name"
	)
	child_obs_2 = frappe.db.get_value(
		"Observation", {"observation_template": obs_template_component.name}, "name"
	)
	if not kwargs.get("operand_1_db_set"):
		child_obs_1_doc = frappe.get_doc("Observation", child_obs_1)
		child_obs_1_doc.result_data = str(kwargs.get("input_value_1"))
		child_obs_1_doc.save()
	else:
		frappe.db.set_value("Observation", child_obs_2, "result_data", str(kwargs.get("input_value_1")))

	child_obs_2_doc = frappe.get_doc("Observation", child_obs_2)
	child_obs_2_doc.result_data = str(kwargs.get("input_value_2"))
	child_obs_2_doc.save()

	result_value = frappe.db.get_value(
		"Observation",
		{"observation_template": obs_template_component_1.name},
		"result_data",
	)
	if kwargs.get("operand_1_db_set"):
		return obs_template_component_1.name

	return result_value


def with_correct_formula(self, **kwargs):
	clear_table()
	custom_formula = ""
	if kwargs.get("patient_custom_formula"):
		custom_formula = kwargs.get("patient_custom_formula")

	input_value_1 = kwargs.get("value1") if kwargs.get("value1") else 5
	input_value_2 = kwargs.get("value2") if kwargs.get("value2") else 2
	operator = "+"

	result = frappe.safe_eval(str(input_value_1) + operator + str(input_value_2) + custom_formula)
	result_value = observation_with_formula(
		patient=kwargs.get("patient"),
		input_value_1=input_value_1,
		input_value_2=input_value_2,
		operator=operator,
		operand_1_db_set=False,
		custom_formula=custom_formula,
		condition1=kwargs.get("condition1"),
		condition2=kwargs.get("condition2"),
	)

	if kwargs.get("condition2"):
		return result_value

	self.assertEqual(flt(result_value), result)


def with_incorrect_operand(self, patient):
	clear_table()
	input_value_1 = "a"
	input_value_2 = 8
	operator = "*"
	result_observ_temp = observation_with_formula(
		patient=patient,
		input_value_1=input_value_1,
		input_value_2=input_value_2,
		operator=operator,
		operand_1_db_set=True,
	)
	self.assertTrue(
		frappe.db.exists(
			"Observation", {"observation_template": result_observ_temp, "result_data": None}
		)
	)


def with_custom_field_in_patient(self, patient):
	clear_table()
	custom_fields = {
		"Patient": [
			dict(
				fieldname="test_custom_field",
				label="Test Calculation",
				fieldtype="Int",
			),
		]
	}
	create_custom_fields(custom_fields, update=True)
	custom_field_value = 10
	frappe.db.set_value("Patient", patient, "test_custom_field", custom_field_value)

	with_correct_formula(self, patient=patient, patient_custom_formula=f"+{custom_field_value}")


def with_condition_patient(self, patient):
	clear_table()
	condition1 = "gender=='Male'"
	condition2 = "gender=='Female'"
	result = with_correct_formula(
		self, patient=patient, condition1=condition1, condition2=condition2, value1=7, value2=5
	)
	# equation is 7-5 result must be 2 for Female as Patient is Female
	self.assertEqual(flt(result), 2)


def clear_table():
	frappe.db.sql("""delete from `tabObservation Template`""")
	frappe.db.sql("""delete from `tabObservation`""")
	frappe.db.sql("""delete from `tabObservation Component`""")
	frappe.db.sql(
		"""
		delete from `tabItem`
		where
			name like '%Observation%'
			or name like '%CBC%'
			or name like '%Cholesterol%'
	"""
	)
	frappe.db.sql(
		"""
		delete from `tabItem Price`
		where
			item_code like '%Observation%'
			or item_code like '%CBC%'
			or item_code like '%Cholesterol%'
	"""
	)
