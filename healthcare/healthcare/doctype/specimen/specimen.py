# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Specimen(Document):
	def before_insert(self):
		patient_doc = frappe.get_doc("Patient", self.patient)
		if patient_doc.dob:
			self.patient_age = patient_doc.calculate_age().get("age_in_string")

	def after_insert(self):
		self.db_set("barcode", self.name)
