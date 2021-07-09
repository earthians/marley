# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe import _
from frappe.model.document import Document
from erpnext.healthcare.doctype.healthcare_insurance_company.healthcare_insurance_company import has_active_contract

class HealthcareInsuranceCoveragePlan(Document):
	def validate(self):
		if not has_active_contract(self.insurance_company):
			frappe.throw(_('No active contracts found for Insurance Company {0}')
				.format(self.insurance_company))
