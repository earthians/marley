# Copyright (c) 2023, healthcare and Contributors
# See license.txt

import frappe

from healthcare.healthcare.doctype.observation.observation import (
	approve_all_observations,
	get_approvable_observations,
	reject_all_observations,
)
from healthcare.healthcare.doctype.observation.test_observation import create_sales_invoice
from healthcare.tests.utils import HealthcareTestSuite


class TestDiagnosticReport(HealthcareTestSuite):
	def test_approve_all_approves_observations_with_result(self):
		diagnostic_report, observations = self.create_report("_Test Observation without Sample")
		self.set_results(observations)

		summary = approve_all_observations(diagnostic_report)

		self.assertEqual(summary["skipped"], [])
		self.assertEqual(len(summary["approved"]), len(observations))
		for observation in observations:
			self.assertEqual(frappe.db.get_value("Observation", observation, "status"), "Approved")

	def test_approve_all_skips_observations_without_result(self):
		diagnostic_report, observations = self.create_report("_Test Observation without Sample")

		summary = approve_all_observations(diagnostic_report)

		self.assertEqual(summary["approved"], [])
		self.assertEqual(len(summary["skipped"]), len(observations))
		for observation in observations:
			self.assertNotEqual(frappe.db.get_value("Observation", observation, "status"), "Approved")

	def test_approve_all_approves_component_observations(self):
		diagnostic_report, observations = self.create_report("_Test Observation Grouped without Sample")
		components = self.get_component_observations(observations)
		self.assertTrue(components)
		self.set_results(components)

		approve_all_observations(diagnostic_report)

		for observation in observations + components:
			self.assertEqual(frappe.db.get_value("Observation", observation, "status"), "Approved")

	def test_approve_all_approves_ready_components_of_an_incomplete_panel(self):
		template = self.create_two_component_panel_template()
		diagnostic_report, observations = self.create_report(template)
		components = self.get_component_observations(observations)
		self.assertEqual(len(components), 2)
		self.set_results(components[:1])

		summary = approve_all_observations(diagnostic_report)

		self.assertEqual(summary["approved"], [components[0]])
		self.assertEqual(frappe.db.get_value("Observation", components[0], "status"), "Approved")
		self.assertNotEqual(frappe.db.get_value("Observation", components[1], "status"), "Approved")
		for observation in observations:
			self.assertNotEqual(frappe.db.get_value("Observation", observation, "status"), "Approved")

	def test_approvable_observations_match_what_approve_all_submits(self):
		template = self.create_two_component_panel_template()
		_diagnostic_report, observations = self.create_report(template)
		components = self.get_component_observations(observations)
		self.assertEqual(len(components), 2)
		self.set_results(components[:1])

		approvable = []
		for observation in observations:
			approvable.extend(get_approvable_observations(observation))

		self.assertEqual(approvable, [components[0]])

	def test_reject_all_rejects_approved_components_of_an_incomplete_panel(self):
		template = self.create_two_component_panel_template()
		diagnostic_report, observations = self.create_report(template)
		components = self.get_component_observations(observations)
		self.assertEqual(len(components), 2)
		self.set_results(components[:1])
		approve_all_observations(diagnostic_report)

		summary = reject_all_observations(diagnostic_report, "Sample contaminated")

		self.assertEqual(summary["rejected"], [components[0]])
		self.assertEqual(frappe.db.get_value("Observation", components[0], "status"), "Rejected")
		self.assertEqual(frappe.db.get_value("Observation", components[0], "docstatus"), 2)
		self.assertNotEqual(frappe.db.get_value("Observation", components[1], "status"), "Rejected")

	def test_approvable_observations_excludes_a_panel_with_an_incomplete_sub_panel(self):
		template = self.create_three_level_panel_template()
		_diagnostic_report, observations = self.create_report(template)
		sub_panel = self.get_component_observations(observations)[0]
		leaves = self.get_component_observations([sub_panel])
		self.assertEqual(len(leaves), 2)
		self.set_results(leaves[:1])

		approvable = get_approvable_observations(observations[0])

		self.assertEqual(approvable, [leaves[0]])

	def test_rejecting_a_panel_later_does_not_choke_on_an_earlier_rejected_component(self):
		template = self.create_two_component_panel_template()
		diagnostic_report, observations = self.create_report(template)
		components = self.get_component_observations(observations)
		self.assertEqual(len(components), 2)
		self.set_results(components[:1])
		approve_all_observations(diagnostic_report)
		reject_all_observations(diagnostic_report, "Sample contaminated")
		replacement = frappe.get_all(
			"Observation",
			filters={"parent_observation": observations[0], "docstatus": 0},
			pluck="name",
		)
		self.set_results(replacement + components[1:2])
		approve_all_observations(diagnostic_report)
		self.assertEqual(frappe.db.get_value("Observation", observations[0], "status"), "Approved")

		summary = reject_all_observations(diagnostic_report, "Reprocessing panel")

		self.assertEqual(summary["rejected"], [observations[0]])
		self.assertEqual(frappe.db.get_value("Observation", observations[0], "status"), "Rejected")

	def test_approve_all_approved_observations_are_left_untouched(self):
		diagnostic_report, observations = self.create_report("_Test Observation without Sample")
		self.set_results(observations)
		approve_all_observations(diagnostic_report)

		summary = approve_all_observations(diagnostic_report)

		self.assertEqual(summary["approved"], [])
		self.assertEqual(summary["skipped"], [])

	def test_reject_all_rejects_approved_observations(self):
		diagnostic_report, observations = self.create_report("_Test Observation without Sample")
		self.set_results(observations)
		approve_all_observations(diagnostic_report)

		summary = reject_all_observations(diagnostic_report, "Sample contaminated")

		self.assertEqual(summary["skipped"], [])
		self.assertEqual(len(summary["rejected"]), len(observations))
		for observation in observations:
			self.assertEqual(frappe.db.get_value("Observation", observation, "status"), "Rejected")
			self.assertEqual(frappe.db.get_value("Observation", observation, "docstatus"), 2)
			self.assertEqual(
				frappe.db.get_value("Observation", observation, "disapproval_reason"),
				"Sample contaminated",
			)

	def test_reject_all_leaves_unapproved_observations_untouched(self):
		diagnostic_report, observations = self.create_report("_Test Observation without Sample")
		self.set_results(observations)

		summary = reject_all_observations(diagnostic_report, "Sample contaminated")

		self.assertEqual(summary["rejected"], [])
		self.assertEqual(len(summary["skipped"]), len(observations))
		for observation in observations:
			self.assertNotEqual(frappe.db.get_value("Observation", observation, "status"), "Rejected")

	def test_reject_all_requires_a_reason(self):
		diagnostic_report, observations = self.create_report("_Test Observation without Sample")
		self.set_results(observations)
		approve_all_observations(diagnostic_report)

		self.assertRaises(frappe.ValidationError, reject_all_observations, diagnostic_report, "")

	def create_two_component_panel_template(self):
		name = "_Test Observation Grouped Two Components"
		if not frappe.db.exists("Observation Template", name):
			frappe.get_doc(
				{
					"doctype": "Observation Template",
					"observation": name,
					"abbr": "OGTC",
					"item_code": name,
					"has_component": 1,
					"observation_category": "Laboratory",
					"permitted_data_type": "Quantity",
					"permitted_unit": "mg / dl",
					"item_group": "Services",
					"sample_collection_required": 0,
					"is_billable": 1,
					"rate": 300,
					"observation_component": [
						{"observation_template": "_Test Observation without Sample", "abbr": "OWOS"},
						{"observation_template": "_Test Observation Operand 2", "abbr": "OWOS2"},
					],
				}
			).insert()
		return name

	def create_three_level_panel_template(self):
		sub_name = "_Test Observation Grouped Sub Panel"
		if not frappe.db.exists("Observation Template", sub_name):
			frappe.get_doc(
				{
					"doctype": "Observation Template",
					"observation": sub_name,
					"abbr": "OGSP",
					"item_code": sub_name,
					"has_component": 1,
					"observation_category": "Laboratory",
					"permitted_data_type": "Quantity",
					"permitted_unit": "mg / dl",
					"item_group": "Services",
					"sample_collection_required": 0,
					"is_billable": 1,
					"rate": 300,
					"observation_component": [
						{"observation_template": "_Test Observation without Sample", "abbr": "OWOS"},
						{"observation_template": "_Test Observation Operand 2", "abbr": "OWOS2"},
					],
				}
			).insert()

		outer_name = "_Test Observation Grouped Outer Panel"
		if not frappe.db.exists("Observation Template", outer_name):
			frappe.get_doc(
				{
					"doctype": "Observation Template",
					"observation": outer_name,
					"abbr": "OGOP",
					"item_code": outer_name,
					"has_component": 1,
					"observation_category": "Laboratory",
					"permitted_data_type": "Quantity",
					"permitted_unit": "mg / dl",
					"item_group": "Services",
					"sample_collection_required": 0,
					"is_billable": 1,
					"rate": 300,
					"observation_component": [{"observation_template": sub_name, "abbr": "OGSP"}],
				}
			).insert()
		return outer_name

	def create_report(self, observation_template):
		frappe.db.set_single_value("Healthcare Settings", "create_observation_on_si_submit", 1)
		patient = frappe.get_list("Patient", pluck="name")[0]
		sales_invoice = create_sales_invoice(patient, observation_template)

		diagnostic_report = frappe.db.get_value(
			"Diagnostic Report", {"ref_doctype": "Sales Invoice", "docname": sales_invoice.name}
		)
		self.assertTrue(diagnostic_report)

		observations = frappe.get_all(
			"Observation",
			filters={"sales_invoice": sales_invoice.name, "parent_observation": ""},
			pluck="name",
		)
		self.assertTrue(observations)
		return diagnostic_report, observations

	def get_component_observations(self, observations):
		return frappe.get_all(
			"Observation", filters={"parent_observation": ["in", observations]}, pluck="name"
		)

	def set_results(self, observations):
		for observation in observations:
			observation_doc = frappe.get_doc("Observation", observation)
			observation_doc.result = "5"
			observation_doc.save()
