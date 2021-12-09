# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe import _
from frappe.utils import getdate, get_link_to_form
from frappe.model.document import Document

class OverlapError(frappe.ValidationError):
	pass

class HealthcareInsuranceContract(Document):
	def validate(self):
		if self.start_date >= self.end_date:
			frappe.throw(_('Start Date should be before End Date'))

		if self.is_active:
			contract = frappe.db.exists('Healthcare Insurance Contract', {
				'insurance_company': self.insurance_company,
				'start_date': ('<=', self.end_date),
				'end_date': ('>=', self.start_date),
				'is_active': 1,
				'name': ('!=', self.name)
			})

			if contract:
				frappe.throw(_('An active contract for this insurance company already exists: {0}').format(
					get_link_to_form('Healthcare Insurance Contract', contract)), exc=OverlapError)
