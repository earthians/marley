# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from healthcare.healthcare.doctype.observation.observation import calculate_age


class DiagnosticReport(Document):
	def validate(self):
		self.set_age()

	def set_age(self):
		if not self.age:
			dob = frappe.db.get_value("Patient", self.patient, "dob")
			if dob:
				self.age = calculate_age(dob)
