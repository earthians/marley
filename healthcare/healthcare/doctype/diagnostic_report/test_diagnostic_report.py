# Copyright (c) 2023, healthcare and Contributors
# See license.txt

import frappe

from healthcare.healthcare.doctype.observation.observation import (
	approve_all_observations,
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
			observation_doc.result_data = "5"
			observation_doc.save()
