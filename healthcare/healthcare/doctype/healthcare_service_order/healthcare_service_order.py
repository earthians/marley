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
from six import string_types
from erpnext.healthcare.doctype.healthcare_insurance_claim.healthcare_insurance_claim import make_insurance_claim

class HealthcareServiceOrder(Document):
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
			frappe.db.set_value('Healthcare Service Order', self.amended_from, 'status', 'Replaced')

	def on_submit(self):
		if self.insurance_subscription and not self.insurance_claim:
			self.make_insurance_claim()

	def make_insurance_claim(self):
		claim = make_insurance_claim(
			patient=self.patient,
			policy=self.insurance_subscription,
			company=self.company,
			template_dt=self.template_dt,
			template_dn=self.template_dn,
			item_code=self.item_code,
			qty=self.quantity
		)

		if claim and claim.get('claim'):
			self.db_set({'insurance_claim': claim.get('claim'), 'claim_status': claim.get('claim_status')})

	def before_cancel(self):
		not_allowed = ['Scheduled', 'In Progress', 'Completed', 'On Hold']
		if self.status in not_allowed:
			frappe.throw(_('You cannot Cancel Service Order in {} status').format(', '.join(not_allowed)),
			title=_('Not Allowed'))

	def on_cancel(self):
		if self.insurance_claim:
			claim = frappe.get_doc('Healthcare Insurance Claim', self.insurance_claim)
			claim.cancel()

		if self.status == 'Active':
			self.db_set('status', 'Cancelled')

	def set_patient_age(self):
		patient = frappe.get_doc('Patient', self.patient)
		self.patient_age_data = patient.get_age()
		self.patient_age = dateutil.relativedelta.relativedelta(getdate(), getdate(patient.dob))

	def set_order_details(self):
		if not self.template_dt and not self.template_dn:
			frappe.throw(_('Order Template Type and Order Template are mandatory to create Healthcare Service Order'),
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


def update_service_order_status(service_order, service_dt, service_dn, status=None, qty=1):
	# TODO: fix status updates from linked docs
	set_service_order_status(service_order, 'Scheduled')
	

@frappe.whitelist()
def set_service_order_status(service_order, status):
	frappe.db.set_value('Healthcare Service Order', service_order, 'status', status)


@frappe.whitelist()
def make_clinical_procedure(service_order):
	if isinstance(service_order, string_types):
		service_order = json.loads(service_order)
		service_order = frappe._dict(service_order)

	doc = frappe.new_doc('Clinical Procedure')
	doc.procedure_template = service_order.template_dn
	doc.service_order = service_order.name
	doc.company = service_order.company
	doc.patient = service_order.patient
	doc.patient_name = service_order.patient_name
	doc.patient_sex = service_order.patient_gender
	doc.patient_age = service_order.patient_age_data
	doc.inpatient_record = service_order.inpatient_record
	doc.practitioner = service_order.practitioner
	doc.start_date = service_order.occurrence_date
	doc.start_time = service_order.occurrence_time
	doc.medical_department = service_order.medical_department
	doc.medical_code = service_order.medical_code
	doc.insurance_subscription = service_order.insurance_subscription
	doc.insurance_company = service_order.insurance_company
	doc.insurance_claim = service_order.insurance_claim
	doc.claim_status = service_order.claim_status

	return doc


@frappe.whitelist()
def make_lab_test(service_order):
	if isinstance(service_order, string_types):
		service_order = json.loads(service_order)
		service_order = frappe._dict(service_order)

	doc = frappe.new_doc('Lab Test')
	doc.template = service_order.template_dn
	doc.service_order = service_order.name
	doc.company = service_order.company
	doc.patient = service_order.patient
	doc.patient_name = service_order.patient_name
	doc.patient_sex = service_order.patient_gender
	doc.patient_age = service_order.patient_age_data
	doc.inpatient_record = service_order.inpatient_record
	doc.email = service_order.patient_email
	doc.mobile = service_order.patient_mobile
	doc.practitioner = service_order.practitioner
	doc.requesting_department = service_order.medical_department
	doc.date = service_order.occurrence_date
	doc.time = service_order.occurrence_time
	doc.invoiced = service_order.invoiced
	doc.medical_code = service_order.medical_code
	doc.insurance_subscription = service_order.insurance_subscription
	doc.insurance_company = service_order.insurance_company
	doc.insurance_claim = service_order.insurance_claim
	doc.claim_status = service_order.claim_status

	return doc

@frappe.whitelist()
def make_therapy_session(service_order):
	if isinstance(service_order, string_types):
		service_order = json.loads(service_order)
		service_order = frappe._dict(service_order)

	doc = frappe.new_doc('Therapy Session')
	doc.therapy_type = service_order.template_dn
	doc.service_order = service_order.name
	doc.company = service_order.company
	doc.patient = service_order.patient
	doc.patient_name = service_order.patient_name
	doc.gender = service_order.patient_gender
	doc.patient_age = service_order.patient_age_data
	doc.practitioner = service_order.practitioner
	doc.department = service_order.medical_department
	doc.start_date = service_order.occurrence_date
	doc.start_time = service_order.occurrence_time
	doc.invoiced = service_order.invoiced
	doc.medical_code = service_order.medical_code
	doc.insurance_subscription = service_order.insurance_subscription
	doc.insurance_company = service_order.insurance_company
	doc.insurance_claim = service_order.insurance_claim
	doc.claim_status = service_order.claim_status

	return doc