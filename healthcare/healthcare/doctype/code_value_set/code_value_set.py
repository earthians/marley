# Copyright (c) 2023, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class CodeValueSet(Document):
	def autoname(self):
		self.name = f"{self.value_set}-{self.code_system}"
