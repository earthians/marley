# -*- coding: utf-8 -*-
# Copyright (c) 2018, earthians and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import frappe
from frappe import _
import dateutil
from frappe.utils import getdate
from frappe.model.document import Document

class ServiceRequestController(Document):
	def validate(self):
		self.set_patient_age()
		self.set_order_details()
		self.set_title()

	def before_submit(self):
		if self.status not in ['Active', 'On Hold', 'Unknown']:
			self.status = 'Active'

	def on_submit(self):
		if self.insurance_policy and not self.insurance_coverage:
			self.make_insurance_coverage()

	def on_update_after_submit(self):
		if self.billing_status == 'Pending' and self.insurance_policy and not self.insurance_coverage:
			self.make_insurance_coverage()

	def before_cancel(self):
		not_allowed = ['Scheduled', 'In Progress', 'Completed', 'On Hold']
		if self.status in not_allowed:
			frappe.throw(_('You cannot Cancel Service Request in {} status').format(', '.join(not_allowed)),
			title=_('Not Allowed'))

	def on_cancel(self):
		if self.insurance_coverage:
			coverage = frappe.get_doc('Patient Insurance Coverage', self.insurance_coverage)
			coverage.cancel()

		if self.status == 'Active':
			self.db_set('status', 'Cancelled')

	def set_patient_age(self):
		patient = frappe.get_doc('Patient', self.patient)
		self.patient_age_data = patient.get_age()
		self.patient_age = dateutil.relativedelta.relativedelta(getdate(), getdate(patient.dob))


@frappe.whitelist()
def set_request_status(doctype, request, status):
	frappe.db.set_value(doctype, request, 'status', status)