# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import json

import frappe
from frappe.desk.doctype.number_card.number_card import get_result
from frappe.model.document import Document

from healthcare.tests.factories.encounters import create_emergency_record
from healthcare.tests.utils import HealthcareTestSuite

AREA_WORKSPACES = ["Healthcare", "Outpatient", "Inpatient", "Rehabilitation", "Diagnostics", "Insurance"]
EMERGENCY_CARDS = {
	"Total ED Arrivals": "Registered",
	"Awaiting Triage": "Registered",
	"In Treatment": "In Treatment",
	"Awaiting Disposition": "Awaiting Disposition",
}
NURSE = "nurse@marleyhealth.io"
OTHER_COMPANY = "_Test Company 2"
COMPANY_EXPRESSION = 'frappe.defaults.get_user_default("Company")'


class TestAreaNumberCards(HealthcareTestSuite):
	def test_each_area_workspace_shows_number_cards(self):
		for workspace in [*AREA_WORKSPACES, "Emergency"]:
			document = frappe.get_doc("Workspace", workspace)
			labels = [row.label for row in document.number_cards]
			self.assertTrue(labels, workspace)
			self.assertCountEqual(self.cards_in_layout(document), labels, workspace)

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

	def cards_in_layout(self, workspace) -> list[str]:
		blocks = json.loads(workspace.content)
		return [block["data"]["number_card_name"] for block in blocks if block["type"] == "number_card"]
