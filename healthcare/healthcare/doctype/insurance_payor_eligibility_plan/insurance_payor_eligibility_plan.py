# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe import _
from frappe.model.document import Document
from healthcare.healthcare.doctype.insurance_payor.insurance_payor import has_active_contract

class InsurancePayorEligibilityPlan(Document):
	def validate(self):
		if not has_active_contract(self.insurance_payor):
			frappe.throw(_('No active contracts found for Insurance Payor {0}')
				.format(self.insurance_payor))
