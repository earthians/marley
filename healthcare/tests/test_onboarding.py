# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import json

import frappe

from healthcare.tests.utils import HealthcareTestSuite

WORKSPACE_ONBOARDINGS = {
	"Healthcare": "Healthcare Setup Onboarding",
	"Setup": "Healthcare Setup Onboarding",
	"Outpatient": "Outpatient Onboarding",
	"Diagnostics": "Diagnostics Onboarding",
	"Inpatient": "Inpatient Onboarding",
	"Rehabilitation": "Rehabilitation Onboarding",
	"Insurance": "Insurance Onboarding",
	"Emergency": "Emergency Onboarding",
}


class TestHealthcareOnboarding(HealthcareTestSuite):
	def test_every_workspace_shows_its_onboarding(self):
		for workspace, onboarding in WORKSPACE_ONBOARDINGS.items():
			self.assertIn(onboarding, self.onboarding_blocks(workspace), workspace)

	def test_every_step_opens_an_existing_doctype(self):
		for onboarding in set(WORKSPACE_ONBOARDINGS.values()):
			steps = frappe.get_doc("Module Onboarding", onboarding).get_steps()
			self.assertTrue(steps, onboarding)
			for step in steps:
				self.assertTrue(frappe.db.exists("DocType", step.reference_document), step.name)

	def test_legacy_onboarding_is_removed(self):
		self.assertFalse(frappe.db.exists("Module Onboarding", "Healthcare"))
		self.assertFalse(frappe.db.exists("Onboarding Step", "Explore Healthcare Settings"))

	def onboarding_blocks(self, workspace):
		content = json.loads(frappe.db.get_value("Workspace", workspace, "content"))
		return [block["data"]["onboarding_name"] for block in content if block["type"] == "onboarding"]
