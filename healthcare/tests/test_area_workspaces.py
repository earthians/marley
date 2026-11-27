# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import json

import frappe
from frappe.desk.doctype.number_card.number_card import get_result
from frappe.model.document import Document

from healthcare.tests.factories.encounters import create_emergency_record
from healthcare.tests.utils import HealthcareTestSuite

AREA_WORKSPACES = [
	"Healthcare",
	"Outpatient",
	"Inpatient",
	"Rehabilitation",
	"Diagnostics",
	"Insurance",
	"Emergency",
]
WORKSPACES_WITH_PATIENT_HISTORY = ["Healthcare", "Outpatient", "Inpatient", "Rehabilitation", "Diagnostics"]
EMERGENCY_CARDS = {
	"Total ED Arrivals": "Registered",
	"Awaiting Triage": "Registered",
	"In Treatment": "In Treatment",
	"Awaiting Disposition": "Awaiting Disposition",
}
CLINICAL_SHORTCUTS = ["Encounter", "Observation", "Service Request", "Medication Request"]
FILTERED_SHORTCUTS = {
	"Emergency": ("emergency_record", [*CLINICAL_SHORTCUTS, "Vitals"]),
	"Inpatient": ("inpatient_record", CLINICAL_SHORTCUTS),
}
NURSE = "nurse@marleyhealth.io"
OTHER_COMPANY = "_Test Company 2"
COMPANY_EXPRESSION = 'frappe.defaults.get_user_default("Company")'
REHAB_SHORTCUTS = [
	"Patient Assessment",
	"Patient Progress",
	"Therapy Type",
	"Exercise Type",
	"Therapy Plan Template",
]


class TestAreaWorkspaces(HealthcareTestSuite):
	def test_each_area_workspace_shows_number_cards(self):
		for workspace in AREA_WORKSPACES:
			document = frappe.get_doc("Workspace", workspace)
			labels = [row.label for row in document.number_cards]
			self.assertTrue(labels, workspace)
			self.assertCountEqual(self.layout_of(document, "number_card"), labels, workspace)

	def test_emergency_cards_belong_to_the_emergency_module(self):
		for card in EMERGENCY_CARDS:
			self.assertEqual(frappe.db.get_value("Number Card", card, "module"), "Emergency", card)

	def test_emergency_cards_count_records_in_their_status(self):
		with self.set_user(NURSE):
			for card, status in EMERGENCY_CARDS.items():
				before = self.card_value(card)
				create_emergency_record("_Test Patient", status=status)
				self.assertEqual(self.card_value(card), before + 1, card)

	def test_emergency_cards_count_only_the_users_company(self):
		with self.set_user(NURSE):
			for card, status in EMERGENCY_CARDS.items():
				before = self.card_value(card)
				create_emergency_record("_Test Patient", status=status, company=OTHER_COMPANY)
				self.assertEqual(self.card_value(card), before, card)

	def test_total_ed_arrivals_skips_cancelled_records(self):
		with self.set_user(NURSE):
			before = self.card_value("Total ED Arrivals")
			create_emergency_record("_Test Patient", status="Cancelled")
			self.assertEqual(self.card_value("Total ED Arrivals"), before)

	def test_clinical_shortcuts_show_only_their_area_records(self):
		for workspace, (field, labels) in FILTERED_SHORTCUTS.items():
			shortcuts = self.shortcuts_of(workspace)
			for label in labels:
				self.assertIn(
					[shortcuts[label].link_to, field, "is", "set"], self.filters_of(shortcuts[label])
				)

	def test_vitals_shortcut_shows_only_vital_sign_observations(self):
		vitals = self.shortcuts_of("Emergency")["Vitals"]
		self.assertIn(["Observation", "observation_category", "=", "Vital Signs"], self.filters_of(vitals))

	def test_rehabilitation_shows_its_rehab_shortcuts(self):
		shortcuts = self.shortcuts_of("Rehabilitation")
		for label in REHAB_SHORTCUTS:
			self.assertIn(label, shortcuts)

	def test_shortcuts_are_all_laid_out(self):
		for workspace in [*FILTERED_SHORTCUTS, "Rehabilitation"]:
			document = frappe.get_doc("Workspace", workspace)
			labels = [row.label for row in document.shortcuts]
			self.assertCountEqual(self.layout_of(document, "shortcut"), labels, workspace)

	def test_patient_history_is_the_last_shortcut(self):
		for workspace in WORKSPACES_WITH_PATIENT_HISTORY:
			document = frappe.get_doc("Workspace", workspace)
			self.assertEqual(self.layout_of(document, "shortcut")[-1], "Patient History", workspace)

	def shortcuts_of(self, workspace: str) -> dict:
		return {row.label: row for row in frappe.get_doc("Workspace", workspace).shortcuts}

	def filters_of(self, shortcut) -> list:
		return json.loads(shortcut.stats_filter)

	def card_value(self, card: str) -> float:
		document = frappe.get_doc("Number Card", card)
		filters = json.loads(document.filters_json) + self.company_filters(document)
		return get_result(document.as_dict(), filters)

	def company_filters(self, card: Document) -> list:
		filters = json.loads(card.dynamic_filters_json)
		self.assertEqual([value for *_, value in filters], [COMPANY_EXPRESSION], card.name)
		company = frappe.defaults.get_user_default("Company")
		self.assertTrue(company, frappe.session.user)
		return [[*condition, company] for *condition, _ in filters]

	def layout_of(self, workspace, block_type: str) -> list[str]:
		key = f"{block_type}_name"
		return [block["data"][key] for block in json.loads(workspace.content) if block["type"] == block_type]
