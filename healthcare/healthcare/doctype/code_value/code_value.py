# -*- coding: utf-8 -*-
# Copyright (c) 2017, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


from frappe.model.document import Document


class CodeValue(Document):
	def autoname(self):
		self.name = f"{self.code_value}-{self.code_system}"
