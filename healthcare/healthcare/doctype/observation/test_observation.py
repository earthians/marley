# Copyright (c) 2023, healthcare and Contributors
# See license.txt

import json

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import flt, getdate, nowtime

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import (
	get_income_account,
	get_receivable_account,
)
from healthcare.healthcare.doctype.observation.observation import add_note
from healthcare.healthcare.doctype.observation_template.test_observation_template import (
	create_multi_level_template,
	create_observation_template,
)
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

	def test_has_component_observation_from_invoice_does_not_duplicate_a_sub_panel_row(self):
		# A sub-panel reached while recursing into the invoiced template's own
		# components (e.g. a Lipid Profile under Package 1) must not also get
		# its own, separate Sample Collection row - it's already represented
		# inside the top-level template's row via its nested
		# component_observations tree.
		self.enable_observation_on_invoice_submit()

		package, sub_panel, _leaf = create_multi_level_template()
		patient = self.get_test_patient()
		sales_invoice = create_sales_invoice(patient, package.name)

		sample_docname = frappe.db.exists("Sample Collection", {"patient": patient})
		self.assertTrue(sample_docname)

		rows = frappe.get_all(
			"Observation Sample Collection",
			filters={"parent": sample_docname},
			pluck="observation_template",
		)
		self.assertEqual(rows, [package.name])
		self.assertNotIn(sub_panel.name, rows)

		# Only one Observation for the sub-panel itself should exist at all -
		# the one set_component_observation_data()/create_component_observations()
		# chain correctly under the package's own Observation once the row is
		# saved, not a second, orphaned one from the invoice-side recursion.
		sub_panel_observations = frappe.get_all(
			"Observation", filters={"observation_template": sub_panel.name, "patient": patient}
		)
		self.assertEqual(len(sub_panel_observations), 1)

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
		observation.permitted_data_type = "Text"
		observation.result = "<p>Normal</p><script>alert('xyz')</script>"
		observation.result_interpretation = "<b>High</b><img src=xyz onerror=alert(1)>"
		observation.note = "<span onclick='steal_data()'>Note</span>"

		observation.sanitize_input()

		self.assertNotIn("<script", observation.result)
		self.assertIn("Normal", observation.result)
		self.assertNotIn("onerror", observation.result_interpretation)
		self.assertIn("High", observation.result_interpretation)
		self.assertNotIn("onclick", observation.note)
		self.assertIn("Note", observation.note)

	def test_add_note_sanitizes_unsafe_html(self):
		observation = frappe.get_doc(
			{
				"doctype": "Observation",
				"observation_template": "_Test Observation without Sample",
				"patient": self.get_test_patient(),
				"company": "_Test Company",
				"observation_category": "Laboratory",
			}
		).insert()

		add_note(
			note='<p onclick="steal_data()">Note</p><script>alert(1)</script>',
			observation=observation.name,
		)

		observation.reload()
		self.assertNotIn("<script", observation.note)
		self.assertNotIn("onclick", observation.note)
		self.assertIn("Note", observation.note)

	def test_result_flag_matches_band_with_indicator_enabled(self):
		template = create_observation_template("_Test Reference Range Template", sample_required=False)
		template.set("observation_reference_range", [])
		template.append(
			"observation_reference_range",
			{
				"applies_to": "All",
				"age": "All",
				"reference_to": "200",
				"short_interpretation": "Desirable",
				# show_indicator_on_report left unchecked: Normal is informational only.
			},
		)
		template.append(
			"observation_reference_range",
			{
				"applies_to": "All",
				"age": "All",
				"reference_from": "200",
				"reference_to": "239",
				"short_interpretation": "Borderline High",
				"show_indicator_on_report": 1,
				"indicator_color": "#f2994a",
			},
		)
		template.append(
			"observation_reference_range",
			{
				"applies_to": "All",
				"age": "All",
				"reference_from": "239",
				"short_interpretation": "High",
				"show_indicator_on_report": 1,
				"indicator_color": "#e24c4c",
			},
		)
		template.save()

		patient = self.get_test_patient()

		normal = self.create_lab_observation(patient, template.name, "150")
		self.assertEqual(normal.result_flag, "")
		self.assertEqual(normal.result_flag_color, "")

		borderline = self.create_lab_observation(patient, template.name, "220")
		self.assertEqual(borderline.result_flag, "Borderline High")
		self.assertEqual(borderline.result_flag_color, "#f2994a")

		high = self.create_lab_observation(patient, template.name, "275")
		self.assertEqual(high.result_flag, "High")
		self.assertEqual(high.result_flag_color, "#e24c4c")

	def test_result_flag_falls_back_to_reference_type_display(self):
		code_value = self.create_test_reference_type_code_value("High")

		template = create_observation_template(
			"_Test Reference Type Fallback Template", sample_required=False
		)
		template.set("observation_reference_range", [])
		template.append(
			"observation_reference_range",
			{
				"applies_to": "All",
				"age": "All",
				"reference_from": "239",
				"reference_type": code_value,
				"show_indicator_on_report": 1,
				"indicator_color": "#e24c4c",
			},
		)
		template.save()
		# fetch_if_empty copies the Code Value's display into short_interpretation
		# on save; blank it again so this test exercises the Python fallback.
		frappe.db.set_value(
			"Observation Reference Range",
			template.observation_reference_range[0].name,
			"short_interpretation",
			"",
		)

		patient = self.get_test_patient()
		observation = self.create_lab_observation(patient, template.name, "275")

		self.assertEqual(observation.result_flag, "High")
		self.assertEqual(observation.result_flag_color, "#e24c4c")

	def create_test_reference_type_code_value(self, display):
		code_system = "_Test Reference Type Codes"
		if not frappe.db.exists("Code System", code_system):
			frappe.get_doc(
				{"doctype": "Code System", "code_system": code_system, "uri": "urn:test:reference-type-codes"}
			).insert()

		code_value = display.lower()
		existing = frappe.db.exists("Code Value", {"code_system": code_system, "code_value": code_value})
		if existing:
			return existing

		return (
			frappe.get_doc(
				{
					"doctype": "Code Value",
					"code_system": code_system,
					"code_value": code_value,
					"display": display,
				}
			)
			.insert()
			.name
		)

	def test_result_flag_empty_without_reference_ranges(self):
		template = create_observation_template("_Test No Reference Range Template", sample_required=False)
		patient = self.get_test_patient()

		observation = self.create_lab_observation(patient, template.name, "100")

		self.assertEqual(observation.result_flag, "")
		self.assertEqual(observation.result_flag_color, "")

	def test_period_result_stores_as_json_pair(self):
		template = create_observation_template("_Test Period Template", sample_required=False)
		template.permitted_data_type = "Period"
		template.save()

		patient = self.get_test_patient()
		observation = frappe.get_doc(
			{
				"doctype": "Observation",
				"observation_template": template.name,
				"patient": patient,
				"company": "_Test Company",
				"observation_category": "Laboratory",
				"permitted_data_type": "Period",
			}
		).insert()
		observation.result = json.dumps({"from": "2026-01-01 08:00:00", "to": "2026-01-05 08:00:00"})
		observation.save()
		observation.reload()

		parsed = json.loads(observation.result)
		self.assertEqual(parsed["from"], "2026-01-01 08:00:00")
		self.assertEqual(parsed["to"], "2026-01-05 08:00:00")

	def test_new_permitted_data_types_accept_results(self):
		patient = self.get_test_patient()
		for data_type, value in (
			("Duration", "3600"),
			("Percent", "87.5"),
		):
			template = create_observation_template(f"_Test {data_type} Template", sample_required=False)
			template.permitted_data_type = data_type
			template.abbr = f"T{data_type[:3]}"
			template.save()

			observation = self.create_lab_observation(patient, template.name, value, data_type)

			self.assertEqual(observation.result, value)

	def create_lab_observation(self, patient, observation_template, result, data_type="Quantity"):
		observation = frappe.get_doc(
			{
				"doctype": "Observation",
				"observation_template": observation_template,
				"patient": patient,
				"company": "_Test Company",
				"observation_category": "Laboratory",
				"permitted_data_type": data_type,
			}
		).insert()
		observation.result = result
		observation.save()
		observation.reload()
		return observation

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
			child_obs_1_doc.result = str(input_value_1)
			child_obs_1_doc.save()
		else:
			frappe.db.set_value("Observation", child_obs_1, "result", str(input_value_1))

		child_obs_2_doc = frappe.get_doc("Observation", child_obs_2)
		child_obs_2_doc.result = str(input_value_2)
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
			fields=["name", "result"],
			order_by="creation desc",
			limit=1,
		)

		self.assertTrue(rows, f"No Observation found for template {observation_template}")
		return rows[0].result

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
	patient_encounter.practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
	patient_encounter.appointment_type = "_Test Appointment Type"
	patient_encounter.encounter_date = getdate()
	patient_encounter.encounter_time = nowtime()

	patient_encounter.append("lab_test_prescription", {"observation_template": observation_template})

	patient_encounter.submit()
	return patient_encounter
