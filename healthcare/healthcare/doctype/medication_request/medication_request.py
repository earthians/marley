# Copyright (c) 2022, healthcare and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe import _
from healthcare.healthcare.doctype.patient_insurance_coverage.patient_insurance_coverage import make_insurance_coverage
from healthcare.controllers.service_request_controller import ServiceRequestController

class MedicationRequest(ServiceRequestController):
	def after_insert(self):
		self.calculate_total_dispensable_quantity()

	def set_title(self):
		if frappe.flags.in_import and self.title:
			return
		self.title = f'{self.patient_name} - {self.medication}'

	def before_insert(self):
		self.status = 'Draft'

		if self.amended_from:
			frappe.db.set_value('Medication Request', self.amended_from, 'status', 'Replaced')

	def make_insurance_coverage(self):
		coverage = make_insurance_coverage(
			patient=self.patient,
			policy=self.insurance_policy,
			company=self.company,
			template_dt='Medication',
			template_dn=self.medication,
			item_code=self.item_code,
			qty=self.quantity
		)

		if coverage and coverage.get('coverage'):
			self.db_set({'insurance_coverage': coverage.get('coverage'), 'coverage_status': coverage.get('coverage_status')})

	def set_order_details(self):
		if not self.medication:
			frappe.throw(_('Medication is mandatory to create Medication Request'),
				title=_('Missing Mandatory Fields'))

		medication = frappe.get_doc('Medication', self.medication)
		# set item code
		self.item_code = medication.get('item')

		if not self.staff_role and medication.get('staff_role'):
			self.staff_role = medication.staff_role

		if not self.intent:
			self.intent = 'Original Order'

		if not self.priority:
			self.priority = 'Routine'

	def calculate_total_dispensable_quantity(self):
		if self.number_of_repeats_allowed:
			self.total_dispensable_quantity = self.quantity + (self.number_of_repeats_allowed * self.quantity)
		else:
			self.total_dispensable_quantity = self.quantity

	def update_invoice_details(self, qty):
		'''
		updates qty_invoiced and set  billing status
		'''
		qty_invoiced = self.qty_invoiced + qty

		if qty_invoiced == 0:
			status = 'Pending'
		if self.number_of_repeats_allowed and self.total_dispensable_quantity:
			if qty_invoiced < self.total_dispensable_quantity:
				status = 'Partly Invoiced'
			else:
				status = 'Invoiced'
		else:
			if qty_invoiced < self.quantity:
				status = 'Partly Invoiced'
			else:
				status = 'Invoiced'

		self.db_set({
			'qty_invoiced': qty_invoiced,
			'billing_status': status
		})


@frappe.whitelist()
def set_medication_request_status(medication_request, status):
	frappe.db.set_value('Medication Request', medication_request, 'status', status)
