# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from healthcare.healthcare.doctype.observation.observation import (
	calculate_age,
	get_observation_details,
)


class DiagnosticReport(Document):
	def validate(self):
		self.set_age()
		self.set_invoice_status()
		self.set_title()

	def before_insert(self):
		if self.ref_doctype == "Sales Invoice" and self.docname:
			self.practitioner = frappe.db.get_value(self.ref_doctype, self.docname, "ref_practitioner")

	def set_age(self):
		if not self.age:
			dob = frappe.db.get_value("Patient", self.patient, "dob")
			if dob:
				self.age = calculate_age(dob)

	def set_title(self):
		self.title = f"{self.patient_name} - {self.age or ''} {self.gender}"

	def set_invoice_status(self):
		if self.ref_doctype == "Sales Invoice" and self.docname:
			self.sales_invoice_status = frappe.db.get_value("Sales Invoice", self.docname, "status")


def diagnostic_report_print(diagnostic_report):
	return get_observation_details(diagnostic_report)
