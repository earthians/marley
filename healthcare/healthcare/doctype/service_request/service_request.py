# -*- coding: utf-8 -*-
# Copyright (c) 2020, earthians and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import datetime

import json

import frappe
from frappe import _
from six import string_types
from frappe.utils import now_datetime, time_diff_in_hours, get_time, getdate, now

from healthcare.healthcare.doctype.observation.observation import add_observation
from healthcare.healthcare.doctype.observation_template.observation_template import get_observation_template_details

from healthcare.controllers.service_request_controller import ServiceRequestController


class ServiceRequest(ServiceRequestController):
	def set_title(self):
		if frappe.flags.in_import and self.title:
			return
		self.title = f"{self.patient_name} - {self.template_dn}"

	def before_insert(self):
		self.status = "Draft"

		if self.amended_from:
			frappe.db.set_value("Service Request", self.amended_from, "status", "Replaced")

		if self.template_dt == "Observation Template" and self.template_dn:
			self.sample_collection_required = frappe.db.get_value(
				"Observation Template", self.template_dn, "sample_collection_required"
			)


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

		if qty_invoiced == 0:
			status = "Pending"
		if qty_invoiced < self.quantity:
			status = "Partly Invoiced"
		else:
			status = "Invoiced"

		self.db_set({"qty_invoiced": qty_invoiced, "billing_status": status})

	def after_insert(self):
		if self.template_dt == "Clinical Procedure Template":
			insert_medication_request(self.template_dn, self.order_group, self.source_doc)


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


@frappe.whitelist()
def make_nursing_task(service_request):
	if isinstance(service_request, string_types):
		service_request = json.loads(service_request)
		service_request = frappe._dict(service_request)

	description, task_doctype = frappe.db.get_value(
		"Healthcare Activity", service_request.template_dn, ["description", "task_doctype"]
	)
	doc = frappe.new_doc("Nursing Task")
	doc.activity = service_request.template_dn
	doc.service_doctype = "Service Request"
	doc.service_name = service_request.name
	doc.medical_department = service_request.medical_department
	doc.company = service_request.company
	doc.patient = service_request.patient
	doc.patient_name = service_request.patient_name
	doc.gender = service_request.patient_gender
	doc.patient_age = service_request.patient_age_data
	doc.practitioner = service_request.practitioner
	doc.requested_start_time = now_datetime()
	doc.description = description
	doc.task_doctype = task_doctype

	return doc


@frappe.whitelist()
def make_observation(service_request):
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

	patient = frappe.get_doc("Patient", service_request.patient)
	template = frappe.get_doc("Observation Template", service_request.template_dn)
	sample_collection = ""
	if template.has_component:
		sample_collection = create_sample_collection(patient, service_request)
		# parent
		observation = create_observation(service_request)
		save_sample_collection = False
		sample_reqd_component_obs, non_sample_reqd_component_obs = get_observation_template_details(service_request.template_dn)
		if len(non_sample_reqd_component_obs)>0:
			for comp in non_sample_reqd_component_obs:
				add_observation(service_request.patient, comp, "", "", "Patient Encounter", service_request.order_group, observation.name)

		if len(sample_reqd_component_obs)>0:
			save_sample_collection = True
			obs_template = frappe.get_doc("Observation Template", service_request.template_dn)
			sample_collection.append("observation_sample_collection",
				{
					"observation_template": service_request.template_dn,
					"sample": obs_template.sample,
					"sample_type": obs_template.sample_type,
					"container_closure_color": frappe.db.get_value("Observation Template", service_request.template_dn, "container_closure_color"),
					"uom": obs_template.uom,
					"sample_qty": obs_template.sample_qty,
					"component_observation_parent": observation.name,
				}
			)

		if save_sample_collection:
			sample_collection.save(ignore_permissions=True)

	else:
		if template.get("sample_collection_required"):
			sample_collection = create_sample_collection(patient, service_request, template)
			sample_collection.save(ignore_permissions=True)
		else:
			observation = create_observation(service_request)

	return sample_collection if sample_collection and not template.has_component else observation


@frappe.whitelist()
def create_healthcare_activity_for_repeating_orders():
	service_requests = frappe.db.get_all(
		"Service Request",
		filters={"docstatus": 1, "template_dt": "Healthcare Activity", "status": "Active"},
		fields=["name", "task_done_at", "repeat_in_every"],
	)
	if service_requests:
		for service_request in service_requests:
			if not service_request.get("repeat_in_every"):
				return
			time_diff = time_diff_in_hours(now_datetime(), service_request.get("task_done_at"))
			if time_diff >= (service_request.get("repeat_in_every")/3600):
				nursing_task = make_nursing_task(frappe.get_doc("Service Request", service_request.get("name")))
				nursing_task.save()

def insert_medication_request(template_dn, order_group, source):
	procedure_template_doc = frappe.get_doc("Clinical Procedure Template", template_dn)

	source_doc = frappe.get_doc(source, order_group)
	if procedure_template_doc.medications:
		for drug in procedure_template_doc.medications:
			if drug.medication and not drug.medication_request:
				medication = frappe.get_doc("Medication", drug.medication)
				order = frappe.get_doc(
					{
						"doctype": "Medication Request",
						"order_date": getdate(now()),
						"order_time": get_time(now()),
						"company": source_doc.company,
						"status": "Draft",
						"patient": source_doc.get("patient"),
						"practitioner": source_doc.get("practitioner"),
						"sequence": drug.get("sequence"),
						"patient_care_type": medication.get("patient_care_type"),
						"intent": drug.get("intent"),
						"priority": drug.get("priority"),
						"quantity": drug.get_quantity(),
						"dosage": drug.get("dosage"),
						"dosage_form": drug.get("dosage_form"),
						"period": drug.get("period"),
						"expected_date": drug.get("expected_date"),
						"as_needed": drug.get("as_needed"),
						"staff_role": medication.get("staff_role"),
						"note": drug.get("note"),
						"patient_instruction": drug.get("patient_instruction"),
						"medical_code": medication.get("medical_code"),
						"medical_code_standard": medication.get("medical_code_standard"),
						"medication": medication.name,
						"number_of_repeats_allowed": drug.get("number_of_repeats_allowed"),
						"medication_item": drug.get("drug_code") if drug.get("drug_code") else "",
						"source_dt": "Clinical Procedure Template",
						"order_group": template_dn
					}
				)

				if not drug.get("description"):
					description = medication.get("description")
				else:
					description = drug.get("description")

				order.update({"order_description": description})
				order.insert(ignore_permissions=True, ignore_mandatory=True)
				order.submit()

def create_sample_collection(patient, service_request, template=None):
	sample_collection = frappe.new_doc("Sample Collection")
	sample_collection.patient = patient.name
	sample_collection.patient_age = patient.get_age()
	sample_collection.patient_sex = patient.sex
	sample_collection.company = service_request.company
	sample_collection.service_request = service_request.name
	if template:
		sample_collection.append("observation_sample_collection",
			{
				"observation_template": service_request.template_dn,
				"sample": template.sample,
				"sample_type": template.sample_type,
				"container_closure_color": frappe.db.get_value("Observation Template", service_request.template_dn, "container_closure_color"),
				"uom": template.uom,
				"sample_qty": template.sample_qty
			}
		)
		sample_collection.save(ignore_permissions=True)
	return sample_collection

def create_observation(service_request):
	doc = frappe.new_doc("Observation")
	doc.posting_datetime = now_datetime()
	doc.patient = service_request.patient
	doc.observation_template = service_request.template_dn
	doc.reference_doctype = "Patient Encounter"
	doc.reference_docname  = service_request.order_group
	doc.service_request = service_request.name
	doc.insert()
	return doc
