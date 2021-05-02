# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import frappe
from frappe.model.document import Document
from frappe.utils import nowdate


class HealthcareInsuranceCoveragePlan(Document):
	def validate(self):
		self.validate_insurance_company()

	def validate_insurance_company(self):
		contract = frappe.db.exists(
			"Healthcare Insurance Contract",
			{
				"insurance_company": self.insurance_company,
				"end_date": (">=", nowdate()),
				"is_active": 1,
				"docstatus": 1,
			},
		)
		if not contract:
			frappe.throw(
				frappe._("No valid contract found with the Insurance Company {0}").format(
					self.insurance_company
				)
			)
