# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_link_to_form


class MedicationInteraction(Document):
	def validate(self):
		self.validate_distinct_interactants()
		self.validate_duplicate()
		self.set_title()

	def validate_distinct_interactants(self):
		if self.interactant_a_type == self.interactant_b_type and self.interactant_a == self.interactant_b:
			frappe.throw(_("An interaction needs two different interactants"))

	def validate_duplicate(self):
		first = (self.interactant_a_type, self.interactant_a)
		second = (self.interactant_b_type, self.interactant_b)

		for a, b in ((first, second), (second, first)):
			existing = self.get_rule_for(a, b)
			if existing:
				frappe.throw(
					_("This interaction is already recorded in {0}").format(
						get_link_to_form("Medication Interaction", existing)
					),
					title=_("Duplicate Interaction"),
				)

	def get_rule_for(self, a, b):
		return frappe.db.exists(
			"Medication Interaction",
			{
				"interactant_a_type": a[0],
				"interactant_a": a[1],
				"interactant_b_type": b[0],
				"interactant_b": b[1],
				"name": ("!=", self.name),
			},
		)

	def set_title(self):
		self.title = _("{0} with {1}").format(self.interactant_a, self.interactant_b)
