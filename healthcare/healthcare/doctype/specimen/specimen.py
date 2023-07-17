# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Specimen(Document):
	def before_insert(self):
		self.patient_age = frappe.get_doc("Patient", self.patient).calculate_age()

	def after_insert(self):
		self.db_set("barcode", self.name)
