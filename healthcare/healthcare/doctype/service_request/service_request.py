# -*- coding: utf-8 -*-
# Copyright (c) 2020, earthians and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import json

from six import string_types

import frappe
from frappe import _

from healthcare.controllers.service_request_controller import ServiceRequestController


class ServiceRequest(ServiceRequestController):
	def validate(self):
		if self.template_dt and self.template_dn and not self.codification_table:
			template_doc = frappe.get_doc(self.template_dt, self.template_dn)
			for mcode in template_doc.codification_table:
				self.append("codification_table", (frappe.copy_doc(mcode)).as_dict())

	def set_title(self):
		if frappe.flags.in_import and self.title:
			return
		self.title = f"{self.patient_name} - {self.template_dn}"

	def before_insert(self):
		self.status = "Draft"

		if self.amended_from:
			frappe.db.set_value("Service Request", self.amended_from, "status", "Replaced")

	def set_order_details(self):
		if not self.template_dt and not self.template_dn:
			frappe.throw(
				_("Order Template Type and Order Template are mandatory to create Service Request"),
				title=_("Missing Mandatory Fields"),
			)

		template = frappe.get_doc(self.template_dt, self.template_dn)
		# set item code
		self.item_code = template.get("item")

		if not self.patient_care_type and template.get("patient_care_type"):
			self.patient_care_type = template.patient_care_type

		if not self.staff_role and template.get("staff_role"):
			self.staff_role = template.staff_role

		if not self.intent:
			self.intent = "Original Order"

		if not self.priority:
			self.priority = "Routine"

	def update_invoice_details(self, qty):
		"""
		updates qty_invoiced and set  billing status
		"""
		qty_invoiced = self.qty_invoiced + qty
		invoiced = 0
		if qty_invoiced == 0:
			status = "Pending"
		if qty_invoiced < self.quantity:
			status = "Partly Invoiced"
		else:
			invoiced = 1
			status = "Invoiced"

		self.db_set({"qty_invoiced": qty_invoiced, "billing_status": status})
		if self.template_dt == "Lab Test Template":
			dt = "Lab Test"
		elif self.template_dt == "Clinical Procedure Template":
			dt = "Clinical Procedure"
		elif self.template_dt == "Therapy Type":
			dt = "Therapy Session"
		dt_name = frappe.db.get_value(dt, {"service_request": self.name})
		frappe.db.set_value(dt, dt_name, "invoiced", invoiced)


def update_service_request_status(service_request, service_dt, service_dn, status=None, qty=1):
	# TODO: fix status updates from linked docs
	set_service_request_status(service_request, "Scheduled")


@frappe.whitelist()
def set_service_request_status(service_request, status):
	frappe.db.set_value("Service Request", service_request, "status", status)


@frappe.whitelist()
def make_clinical_procedure(service_request):
	if isinstance(service_request, string_types):
		service_request = json.loads(service_request)
		service_request = frappe._dict(service_request)

	if (
		frappe.db.get_single_value("Healthcare Settings", "process_service_request_only_if_paid")
		and service_request.billing_status != "Invoiced"
	):
		frappe.throw(
			_("Service Request need to be invoiced before proceeding"),
			title=_("Payment Required"),
		)

	doc = frappe.new_doc("Clinical Procedure")
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

	return doc


@frappe.whitelist()
def make_lab_test(service_request):
	if isinstance(service_request, string_types):
		service_request = json.loads(service_request)
		service_request = frappe._dict(service_request)

	if (
		frappe.db.get_single_value("Healthcare Settings", "process_service_request_only_if_paid")
		and service_request.billing_status != "Invoiced"
	):
		frappe.throw(
			_("Service Request need to be invoiced before proceeding"),
			title=_("Payment Required"),
		)

	doc = frappe.new_doc("Lab Test")
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

	return doc


@frappe.whitelist()
def make_therapy_session(service_request):
	if isinstance(service_request, string_types):
		service_request = json.loads(service_request)
		service_request = frappe._dict(service_request)

	if (
		frappe.db.get_single_value("Healthcare Settings", "process_service_request_only_if_paid")
		and service_request.billing_status != "Invoiced"
	):
		frappe.throw(
			_("Service Request need to be invoiced before proceeding"),
			title=_("Payment Required"),
		)

	doc = frappe.new_doc("Therapy Session")
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

	return doc
