# -*- coding: utf-8 -*-
# Copyright (c) 2020, earthians and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
import dateutil
import json
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate
from healthcare.healthcare.doctype.patient_insurance_coverage.patient_insurance_coverage import make_insurance_coverage

class ServiceRequest(Document):
	def validate(self):
		self.set_patient_age()
		self.set_order_details()
		self.set_title()

	def set_title(self):
		if frappe.flags.in_import and self.title:
			return
		self.title = f'{self.patient_name} - {self.template_dn}'

	def before_submit(self):
		if self.status not in ['Active', 'On Hold', 'Unknown']:
			self.status = 'Active'

	def before_insert(self):
		self.status = 'Draft'

		if self.amended_from:
			frappe.db.set_value('Service Request', self.amended_from, 'status', 'Replaced')

	def on_submit(self):
		if self.insurance_policy and not self.insurance_coverage:
			self.make_insurance_coverage()

	def on_update_after_submit(self):
		if self.billing_status == 'Pending' and self.insurance_policy and not self.insurance_coverage:
			self.make_insurance_coverage()

	def make_insurance_coverage(self):
		coverage = make_insurance_coverage(
			patient=self.patient,
			policy=self.insurance_policy,
			company=self.company,
			template_dt=self.template_dt,
			template_dn=self.template_dn,
			item_code=self.item_code,
			qty=self.quantity
		)

		if coverage and coverage.get('coverage'):
			self.db_set({'insurance_coverage': coverage.get('coverage'), 'coverage_status': coverage.get('coverage_status')})

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

	def set_order_details(self):
		if not self.template_dt and not self.template_dn:
			frappe.throw(_('Order Template Type and Order Template are mandatory to create Service Request'),
				title=_('Missing Mandatory Fields'))

		template = frappe.get_doc(self.template_dt, self.template_dn)
		# set item code
		self.item_code = template.get('item')

		if not self.patient_care_type and template.get('patient_care_type'):
			self.patient_care_type = template.patient_care_type

		if not self.staff_role and template.get('staff_role'):
			self.staff_role = template.staff_role

		if not self.intent:
			self.intent = 'Original Order'

		if not self.priority:
			self.priority = 'Routine'

	def update_invoice_details(self, qty):
		'''
		updates qty_invoiced and set  billing status
		'''
		qty_invoiced = self.qty_invoiced + qty

		if qty_invoiced == 0:
			status = 'Pending'
		if qty_invoiced < self.quantity:
			status = 'Partly Invoiced'
		else:
			status = 'Invoiced'

		self.db_set({
			'qty_invoiced': qty_invoiced,
			'billing_status': status
		})


def update_service_request_status(service_request, service_dt, service_dn, status=None, qty=1):
	# TODO: fix status updates from linked docs
	set_service_request_status(service_request, 'Scheduled')
	

@frappe.whitelist()
def set_service_request_status(service_request, status):
	frappe.db.set_value('Service Request', service_request, 'status', status)


@frappe.whitelist()
def make_clinical_procedure(service_request):
	if isinstance(service_request, str):
		service_request = json.loads(service_request)
		service_request = frappe._dict(service_request)

	doc = frappe.new_doc('Clinical Procedure')
	doc.procedure_template = service_request.template_dn
	doc.service_request = service_request.name
	doc.company = service_request.company
	doc.patient = service_request.patient
	doc.patient_name = service_request.patient_name
	doc.patient_sex = service_request.patient_gender
	doc.patient_age = service_request.patient_age_data
	doc.inpatient_record = service_request.inpatient_record
	doc.practitioner = service_request.practitioner
	doc.start_date = service_request.occurrence_date
	doc.start_time = service_request.occurrence_time
	doc.medical_department = service_request.medical_department
	doc.medical_code = service_request.medical_code
	doc.insurance_policy = service_request.insurance_policy
	doc.insurance_payor = service_request.insurance_payor
	doc.insurance_coverage = service_request.insurance_coverage
	doc.coverage_status = service_request.coverage_status

	return doc


@frappe.whitelist()
def make_lab_test(service_request):
	if isinstance(service_request, str):
		service_request = json.loads(service_request)
		service_request = frappe._dict(service_request)

	doc = frappe.new_doc('Lab Test')
	doc.template = service_request.template_dn
	doc.service_request = service_request.name
	doc.company = service_request.company
	doc.patient = service_request.patient
	doc.patient_name = service_request.patient_name
	doc.patient_sex = service_request.patient_gender
	doc.patient_age = service_request.patient_age_data
	doc.inpatient_record = service_request.inpatient_record
	doc.email = service_request.patient_email
	doc.mobile = service_request.patient_mobile
	doc.practitioner = service_request.practitioner
	doc.requesting_department = service_request.medical_department
	doc.date = service_request.occurrence_date
	doc.time = service_request.occurrence_time
	doc.invoiced = service_request.invoiced
	doc.medical_code = service_request.medical_code
	doc.insurance_policy = service_request.insurance_policy
	doc.insurance_payor = service_request.insurance_payor
	doc.insurance_coverage = service_request.insurance_coverage
	doc.coverage_status = service_request.coverage_status

	return doc

@frappe.whitelist()
def make_therapy_session(service_request):
	if isinstance(service_request, str):
		service_request = json.loads(service_request)
		service_request = frappe._dict(service_request)

	doc = frappe.new_doc('Therapy Session')
	doc.therapy_type = service_request.template_dn
	doc.service_request = service_request.name
	doc.company = service_request.company
	doc.patient = service_request.patient
	doc.patient_name = service_request.patient_name
	doc.gender = service_request.patient_gender
	doc.patient_age = service_request.patient_age_data
	doc.practitioner = service_request.practitioner
	doc.department = service_request.medical_department
	doc.start_date = service_request.occurrence_date
	doc.start_time = service_request.occurrence_time
	doc.invoiced = service_request.invoiced
	doc.medical_code = service_request.medical_code
	doc.insurance_policy = service_request.insurance_policy
	doc.insurance_payor = service_request.insurance_payor
	doc.insurance_coverage = service_request.insurance_coverage
	doc.coverage_status = service_request.coverage_status

	return doc