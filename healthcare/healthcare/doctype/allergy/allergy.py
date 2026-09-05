# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class Allergy(Document):
	def validate(self):
		self.clear_substance_of_non_medication()
		self.validate_substance()

	def clear_substance_of_non_medication(self):
		"""Only a medication allergen is checked against a prescription"""
		if self.category == "Medication":
			return

		self.substance_type = None
		self.substance = None

	def validate_substance(self):
		"""mandatory_depends_on is enforced in the browser only, and an allergen without a
		substance would silently never match a prescription"""
		if self.category == "Medication" and not self.substance:
			frappe.throw(_("Substance is mandatory for a medication allergen"))
