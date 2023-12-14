# -*- coding: utf-8 -*-
# Copyright (c) 2020, earthians and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import json

from six import string_types

import frappe
from frappe import _
from frappe.utils import now_datetime

from healthcare.controllers.service_request_controller import ServiceRequestController
from healthcare.healthcare.doctype.observation.observation import add_observation
from healthcare.healthcare.doctype.observation_template.observation_template import (
	get_observation_template_details,
)
from healthcare.healthcare.doctype.sample_collection.sample_collection import (
	set_component_observation_data,
)


class ServiceRequest(ServiceRequestController):
	def validate(self):
		super().validate()
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
			self.intent = frappe.db.get_single_value("Healthcare Settings", "default_intent")

		if not self.priority:
			self.priority = frappe.db.get_single_value("Healthcare Settings", "default_priority")

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
		elif self.template_dt == "Observation Template":
			dt = "Observation"
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
	name_ref_in_child = check_observation_sample_exist(service_request)

	if name_ref_in_child:
		return name_ref_in_child[0], name_ref_in_child[1], "New"
	else:
		exist_sample_collection = frappe.db.exists(
			"Sample Collection",
			{
				"reference_name": service_request.order_group,
				"docstatus": 0,
				"patient": service_request.patient,
			},
		)

	if template.has_component:
		if exist_sample_collection:
			sample_collection = frappe.get_doc("Sample Collection", exist_sample_collection)
		else:
			sample_collection = create_sample_collection(patient, service_request)

		# parent
		observation = create_observation(service_request)

		save_sample_collection = False
		(
			sample_reqd_component_obs,
			non_sample_reqd_component_obs,
		) = get_observation_template_details(service_request.template_dn)
		if len(non_sample_reqd_component_obs) > 0:
			for comp in non_sample_reqd_component_obs:
				add_observation(
					patient=service_request.patient,
					template=comp,
					doc="Patient Encounter",
					docname=service_request.order_group,
					parent=observation.name,
				)

		if len(sample_reqd_component_obs) > 0:
			save_sample_collection = True
			obs_template = frappe.get_doc("Observation Template", service_request.template_dn)
			data = set_component_observation_data(service_request.template_dn)
			# append parent template
			sample_collection.append(
				"observation_sample_collection",
				{
					"observation_template": service_request.template_dn,
					"sample": obs_template.sample,
					"sample_type": obs_template.sample_type,
					"container_closure_color": frappe.db.get_value(
						"Observation Template",
						service_request.template_dn,
						"container_closure_color",
					),
					"component_observations": json.dumps(data),
					"uom": obs_template.uom,
					"status": "Open",
					"sample_qty": obs_template.sample_qty,
					"component_observation_parent": observation.name,
					"service_request": service_request.name,
				},
			)

		if save_sample_collection:
			sample_collection.save(ignore_permissions=True)

	else:
		if template.get("sample_collection_required"):
			if exist_sample_collection:
				sample_collection = frappe.get_doc("Sample Collection", exist_sample_collection)
				sample_collection.append(
					"observation_sample_collection",
					{
						"observation_template": service_request.template_dn,
						"sample": template.sample,
						"sample_type": template.sample_type,
						"container_closure_color": frappe.db.get_value(
							"Observation Template",
							service_request.template_dn,
							"container_closure_color",
						),
						"uom": template.uom,
						"status": "Open",
						"sample_qty": template.sample_qty,
						"service_request": service_request.name,
					},
				)
				sample_collection.save(ignore_permissions=True)
			else:
				sample_collection = create_sample_collection(patient, service_request, template)
				sample_collection.save(ignore_permissions=True)
		else:
			observation = create_observation(service_request)

	diagnostic_report = frappe.db.exists(
		"Diagnostic Report", {"reference_name": service_request.order_group}
	)
	if not diagnostic_report:
		insert_diagnostic_report(service_request, sample_collection)

	if sample_collection:
		return sample_collection.name, "Sample Collection"
	elif observation:
		return observation.name, "Observation"


def create_sample_collection(patient, service_request, template=None):
	sample_collection = frappe.new_doc("Sample Collection")
	sample_collection.patient = patient.name
	sample_collection.patient_age = patient.get_age()
	sample_collection.patient_sex = patient.sex
	sample_collection.company = service_request.company
	sample_collection.reference_doc = service_request.source_doc
	sample_collection.reference_name = service_request.order_group
	if template:
		sample_collection.append(
			"observation_sample_collection",
			{
				"observation_template": service_request.template_dn,
				"sample": template.sample,
				"sample_type": template.sample_type,
				"container_closure_color": frappe.db.get_value(
					"Observation Template", service_request.template_dn, "container_closure_color"
				),
				"uom": template.uom,
				"sample_qty": template.sample_qty,
				"service_request": service_request.name,
			},
		)
		sample_collection.save(ignore_permissions=True)
	return sample_collection


def create_observation(service_request):
	doc = frappe.new_doc("Observation")
	doc.posting_datetime = now_datetime()
	doc.patient = service_request.patient
	doc.observation_template = service_request.template_dn
	doc.reference_doctype = "Patient Encounter"
	doc.reference_docname = service_request.order_group
	doc.service_request = service_request.name
	doc.insert()
	return doc


def insert_diagnostic_report(doc, sample_collection=None):
	diagnostic_report = frappe.new_doc("Diagnostic Report")
	diagnostic_report.company = doc.company
	diagnostic_report.patient = doc.patient
	diagnostic_report.ref_doctype = doc.source_doc
	diagnostic_report.docname = doc.order_group
	diagnostic_report.practitioner = doc.practitioner
	diagnostic_report.sample_collection = sample_collection
	diagnostic_report.save(ignore_permissions=True)


def check_observation_sample_exist(service_request):
	name_ref_in_child = frappe.db.get_value(
		"Observation Sample Collection",
		{"service_request": service_request.name, "parenttype": "Sample Collection"},
		"parent",
	)
	if name_ref_in_child:
		return name_ref_in_child, "Sample Collection"
	else:
		exist_observation = frappe.db.exists(
			"Observation",
			{
				"service_request": service_request.name,
				"parent_observation": "",
			},
		)
		if exist_observation:
			return exist_observation, "Observation"
