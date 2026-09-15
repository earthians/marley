# -*- coding: utf-8 -*-
# Copyright (c) 2020, earthians and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import json

from six import string_types

import frappe
from frappe import _
from frappe.model.mapper import get_mapped_doc
from frappe.utils import flt, now_datetime, cint

from healthcare.controllers.service_request_controller import ServiceRequestController
from healthcare.healthcare.doctype.observation.observation import add_observation
from healthcare.healthcare.doctype.observation_template.observation_template import (
	get_observation_template_details,
)
from healthcare.healthcare.doctype.sample_collection.sample_collection import (
	set_component_observation_data,
)
from healthcare.healthcare.lab_request_items import (
	apply_discounts_to_specs,
	expand_lab_test_specs,
	parse_lab_request_items,
)
from healthcare.healthcare.care_episode_guard import resolve_inpatient_admission_name


def _get_lab_template_base_rate(template_name, patient_care_type=None):
	template_doc = frappe.get_doc("Lab Test Template", template_name)
	base = None
	if (patient_care_type or "").strip().upper() == "OP":
		op_rate = getattr(template_doc, "op_rate", None)
		if flt(op_rate) > 0:
			base = op_rate
	if base in (None, ""):
		base = (
			getattr(template_doc, "lab_test_rate", None)
			or getattr(template_doc, "rate", None)
			or getattr(template_doc, "amount", None)
		)
	if base:
		return flt(base)

	# Fallback for legacy rows where only service_pricing exists.
	first_pricing = (getattr(template_doc, "service_pricing", None) or [None])[0]
	if first_pricing and getattr(first_pricing, "price", None):
		return flt(first_pricing.price)
	return 0


def _get_patient_category_multiplier(patient_name):
	"""Category multiplier; skipped for insured patients when Apply Multiplier on Insurance is off."""
	from healthcare.controllers.insurance_pricing import get_effective_category_multiplier

	return get_effective_category_multiplier(patient_name)


class ServiceRequest(ServiceRequestController):
	def validate(self):
		super().validate()
		if self.template_dt and self.template_dn and not self.codification_table:
			template_doc = frappe.get_doc(self.template_dt, self.template_dn)
			codification_table = getattr(template_doc, "codification_table", None)
			if codification_table:
				for mcode in codification_table:
					self.append("codification_table", (frappe.copy_doc(mcode)).as_dict())

	def set_title(self):
		if frappe.flags.in_import and self.title:
			return
		self.title = f"{self.patient_name} - {self.template_dn}"

	def before_insert(self):
		self.status = "draft-Request Status"

		if self.amended_from:
			frappe.db.set_value("Service Request", self.amended_from, "status", "revoked-Request Status")

		if self.template_dt == "Observation Template" and self.template_dn:
			self.sample_collection_required = frappe.db.get_value(
				"Observation Template", self.template_dn, "sample_collection_required"
			)

	def set_order_details(self):
		if cint(self.get("legacy")) or getattr(self.flags, "from_legacy_import", False):
			if (
				self.template_dt
				and self.template_dn
				and frappe.db.exists(self.template_dt, self.template_dn)
			):
				template = frappe.get_doc(self.template_dt, self.template_dn)
				self.item_code = template.get("item") or template.get("item_code")
				if not self.patient_care_type and template.get("patient_care_type"):
					self.patient_care_type = template.patient_care_type
				if not self.staff_role and template.get("staff_role"):
					self.staff_role = template.staff_role
			if not self.intent:
				self.intent = frappe.db.get_single_value("Healthcare Settings", "default_intent")
			if not self.priority:
				self.priority = frappe.db.get_single_value("Healthcare Settings", "default_priority")
			return

		if not self.template_dt and not self.template_dn:
			frappe.throw(
				_("Order Template Type and Order Template are mandatory to create Service Request"),
				title=_("Missing Mandatory Fields"),
			)

		template = frappe.get_doc(self.template_dt, self.template_dn)
		# set item code (template may have "item" or "item_code", e.g. Healthcare Service Template)
		self.item_code = template.get("item") or template.get("item_code")

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
	set_service_request_status(service_request, status)


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

	return doc

def generate_lab_test_trans_num(format_type="prefixed", prefix="LT-", suffix="", padding=6):
    """
    Generate a sequential Trans Num for Lab Test by finding the largest existing integer.
    More efficient version using SQL.
    
    Args:
        format_type (str): "integer", "padded", "prefixed", or "suffixed"
        prefix (str): Prefix to add to the number (e.g., "LT-")
        suffix (str): Suffix to add to the number (e.g., "-2024")
        padding (int): Number of digits for zero padding (e.g., 6 for "000001")
    
    Returns:
        str: The next sequential Trans Num
    """
    import re
    
    # Escape special regex characters in prefix and suffix
    escaped_prefix = re.escape(prefix) if prefix else ''
    escaped_suffix = re.escape(suffix) if suffix else ''
    
    # Build regex pattern to extract numbers
    # This pattern matches: optional prefix + digits + optional suffix
    if prefix and suffix:
        pattern = f'^{escaped_prefix}(\\d+){escaped_suffix}$'
    elif prefix:
        pattern = f'^{escaped_prefix}(\\d+)$'
    elif suffix:
        pattern = f'^(\\d+){escaped_suffix}$'
    else:
        pattern = '^(\\d+)$'
    
    # Query all trans_num and extract numbers using SQL
    # Using REGEXP in MySQL/MariaDB
    if prefix or suffix:
        # For prefixed/suffixed values, we need to extract in Python
        lab_tests = frappe.db.sql("""
            SELECT trans_num 
            FROM `tabLab Test` 
            WHERE trans_num IS NOT NULL 
            AND trans_num != ''
            AND docstatus != 2
        """, as_dict=True)
        
        max_num = 0
        for test in lab_tests:
            trans_num = test.get("trans_num", "")
            match = re.match(pattern, trans_num)
            if match:
                try:
                    current_num = int(match.group(1))
                    if current_num > max_num:
                        max_num = current_num
                except (ValueError, TypeError):
                    continue
    else:
        # For plain integers, use SQL CAST
        result = frappe.db.sql("""
            SELECT MAX(CAST(trans_num AS UNSIGNED)) as max_num
            FROM `tabLab Test`
            WHERE trans_num IS NOT NULL 
            AND trans_num != ''
            AND trans_num REGEXP '^[0-9]+$'
            AND docstatus != 2
        """, as_dict=True)
        
        max_num = result[0].get("max_num") or 0
    
    # Increment by 1
    next_num = max_num + 1
    
    # Format based on requirements
    if format_type == "padded":
        return str(next_num).zfill(padding)
    elif format_type == "prefixed":
        return f"{prefix}{next_num}"
    elif format_type == "suffixed":
        return f"{next_num}{suffix}"
    else:  # "integer" or default
        return str(next_num)
    
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
	print("TRans number is", generate_lab_test_trans_num(format_type="prefixed", prefix="LT-", padding=6))
	doc = frappe.new_doc("Lab Test")
	doc.template = service_request.template_dn
	doc.service_request = service_request.name
	doc.trans_num = generate_lab_test_trans_num(format_type="prefixed", prefix="LT-", padding=6)  # Example: "LT-000001"
	
	doc.company = service_request.company
	doc.patient = service_request.patient
	doc.patient_name = service_request.patient_name
	doc.patient_sex = service_request.patient_gender
	doc.patient_age = service_request.patient_age_data
	admission = resolve_inpatient_admission_name(
		service_request.inpatient_record or service_request.get("inpatient_admission"),
		service_request.patient,
	)
	doc.inpatient_record = admission
	doc.inpatient_admission = admission
	doc.email = service_request.patient_email
	doc.mobile = service_request.patient_mobile
	doc.practitioner = service_request.practitioner
	doc.requesting_department = service_request.medical_department
	doc.date = service_request.occurrence_date
	doc.time = service_request.occurrence_time
	doc.invoiced = service_request.invoiced
	# Propagate Cost Center from Service Request to Lab Test when available
	if getattr(service_request, "cost_center", None):
		doc.cost_center = service_request.cost_center
	# Pricing: carry over cost/amount if present
	if getattr(service_request, "cost", None) is not None:
		doc.amount = service_request.cost
	elif getattr(service_request, "amount", None) is not None:
		doc.amount = service_request.amount
	if getattr(doc, "amount", None) is not None:
		doc.discount_margin = "Percentage"
		doc.discount = 0
		doc.discount_amount = 0
		doc.grand_total = doc.amount

	return doc


@frappe.whitelist()
# def book_lab_and_forward(service_request_name):
# 	"""
# 	Booked Lab: after patient has accepted cost, forward the lab request to the laboratory.
# 	For group templates, creates one Lab Test per child template in the group.
# 	"""
# 	if not service_request_name:
# 		frappe.throw(_("Service Request name is required"))
# 	sr = frappe.get_doc("Service Request", service_request_name)
# 	if sr.template_dt != "Lab Test Template":
# 		frappe.throw(_("Booked Lab is only for Lab Test Template requests."))
# 	if not sr.patient_accepted_cost:
# 		frappe.throw(_("Patient must accept cost before using Booked Lab."))
# 	if sr.booked:
# 		frappe.throw(_("This request has already been forwarded to the laboratory."))

# 	existing = frappe.get_all(
# 		"Lab Test",
# 		filters={"service_request": sr.name, "docstatus": ["!=", 2]},
# 		fields=["name"]
# 	)
# 	if existing:
# 		frappe.throw(_("Lab Test(s) already exist for this request."))

# 	def _build_lab_test(template_dn):
# 		print("nafika hapa")
# 		"""Helper: create (but don't insert) a Lab Test for the given template."""
# 		lt = frappe.new_doc("Lab Test")
# 		lt.template = template_dn
# 		lt.service_request = sr.name
# 		lt.trans_num = generate_lab_test_trans_num(format_type="prefixed", prefix="LT-", padding=6)  # Example: "LT-000001"
# 		lt.company = sr.company
# 		lt.patient = sr.patient
# 		lt.patient_name = sr.patient_name
# 		lt.patient_sex = sr.patient_gender
# 		lt.patient_age = sr.patient_age_data
# 		lt.inpatient_record = sr.inpatient_record
# 		lt.email = sr.patient_email
# 		lt.mobile = sr.patient_mobile
# 		lt.practitioner = sr.practitioner
# 		lt.requesting_department = sr.medical_department
# 		lt.date = sr.occurrence_date
# 		lt.time = sr.occurrence_time
# 		lt.invoiced = sr.get("invoiced") or 0
# 		if getattr(sr, "cost_center", None):
# 			lt.cost_center = sr.cost_center
# 		if getattr(sr, "cost", None) is not None:
# 			lt.amount = sr.cost
# 		elif getattr(sr, "amount", None) is not None:
# 			lt.amount = sr.amount
# 		if getattr(lt, "amount", None) is not None:
# 			lt.discount_margin = "Percentage"
# 			lt.discount = 0
# 			lt.discount_amount = 0
# 			lt.grand_total = lt.amount
# 		lt.lab_test_name = frappe.db.get_value("Lab Test Template", template_dn, "lab_test_name") or template_dn
# 		lt.status = "Requested"
# 		return lt

# 	is_group = frappe.db.get_value("Lab Test Template", sr.template_dn, "is_group")
	
# 	if is_group:
# 		group_rows = frappe.get_all(
# 			"Lab Test Group Template",
# 			filters={
# 				"parent": sr.template_dn,
# 				"parenttype": "Lab Test Template",
# 				"template_or_new_line": "Add Test",
# 			},
# 			fields=["lab_test_template"],
# 			order_by="idx asc",
# 			ignore_permissions=True,
# 		)
# 		created_names = []
# 		for row in group_rows:
# 			if not row.lab_test_template:
# 				continue
# 			lt = _build_lab_test(row.lab_test_template)
# 			lt.insert(ignore_permissions=True)
# 			created_names.append(lt.name)

# 			# Reflect each test on Patient Visit
# 			if sr.order_group and frappe.db.exists("Patient Visit", sr.order_group):
# 				visit = frappe.get_doc("Patient Visit", sr.order_group)
# 				visit.append("lab_tests_charges", {
# 					"test_code": lt.name,
# 					"test_name": lt.lab_test_name or row.lab_test_template,
# 					"amount": sr.amount or 0,
# 					"net_amount": sr.amount or 0,
# 				})
# 				visit.save(ignore_permissions=True)

# 		sr.db_set("booked", 1)
# 		frappe.db.commit()
# 		return {"lab_tests": created_names, "count": len(created_names), "patient_visit": sr.order_group}

# 	# Non-group: single lab test
# 	lab_test = _build_lab_test(sr.template_dn)
# 	lab_test.insert(ignore_permissions=True)
# 	sr.db_set("booked", 1)

# 	if sr.order_group and frappe.db.exists("Patient Visit", sr.order_group):
# 		visit = frappe.get_doc("Patient Visit", sr.order_group)
# 		visit.append("lab_tests_charges", {
# 			"test_code": lab_test.name,
# 			"test_name": lab_test.lab_test_name or sr.template_dn,
# 			"amount": sr.amount or 0,
# 			"net_amount": sr.amount or 0,
# 		})
# 		visit.save(ignore_permissions=True)

# 	frappe.db.commit()
# 	return {"lab_test": lab_test.name, "patient_visit": sr.order_group}
# @frappe.whitelist()
# def book_lab_and_forward(service_request_name):
# 	"""
# 	Booked Lab: after patient has accepted cost, forward the lab request to the laboratory.
# 	For group templates, creates one Lab Test per child template in the group.
# 	"""
# 	if not service_request_name:
# 		frappe.throw(_("Service Request name is required"))
# 	sr = frappe.get_doc("Service Request", service_request_name)
# 	if sr.template_dt != "Lab Test Template":
# 		frappe.throw(_("Booked Lab is only for Lab Test Template requests."))
# 	if not sr.patient_accepted_cost:
# 		frappe.throw(_("Patient must accept cost before using Booked Lab."))
# 	if sr.booked:
# 		frappe.throw(_("This request has already been forwarded to the laboratory."))

# 	existing = frappe.get_all(
# 		"Lab Test",
# 		filters={"service_request": sr.name, "docstatus": ["!=", 2]},
# 		fields=["name"]
# 	)
# 	if existing:
# 		frappe.throw(_("Lab Test(s) already exist for this request."))

# 	def _build_lab_test(template_dn, parent_group=None):
# 		"""Helper: create (but don't insert) a Lab Test for the given template."""
# 		lt = frappe.new_doc("Lab Test")
# 		lt.template = template_dn
# 		lt.service_request = sr.name
# 		lt.trans_num = generate_lab_test_trans_num(format_type="prefixed", prefix="LT-", padding=6)
# 		lt.company = sr.company
# 		lt.patient = sr.patient
# 		lt.patient_name = sr.patient_name
# 		lt.patient_sex = sr.patient_gender
# 		lt.patient_age = sr.patient_age_data
# 		lt.inpatient_record = sr.inpatient_record
# 		lt.email = sr.patient_email
# 		lt.mobile = sr.patient_mobile
		
		
		
# 		# If this is a child of a group template, set the lab_group to parent
# 		if parent_group:
# 			if hasattr(lt, 'lab_group'):
# 				lt.lab_group = parent_group
# 				print(f"Set lab_group to {parent_group}")
		
# 		lt.practitioner = sr.practitioner
# 		lt.requesting_department = sr.medical_department
# 		lt.date = sr.occurrence_date
# 		lt.time = sr.occurrence_time
# 		lt.invoiced = sr.get("invoiced") or 0
# 		print("data for tghis", lt.as_dict())
# 		if getattr(sr, "cost_center", None):
# 			lt.cost_center = sr.cost_center
# 		if getattr(sr, "cost", None) is not None:
# 			lt.amount = sr.cost
# 		elif getattr(sr, "amount", None) is not None:
# 			lt.amount = sr.amount
			
# 		if getattr(lt, "amount", None) is not None:
# 			lt.discount_margin = "Percentage"
# 			lt.discount = 0
# 			lt.discount_amount = 0
# 			lt.grand_total = lt.amount
			
# 		lt.lab_test_name = frappe.db.get_value("Lab Test Template", template_dn, "lab_test_name") or template_dn
# 		lt.status = "Requested"
		
# 		print(f"Created Lab Test for template: {template_dn}")
# 		print(f"  lab_group: {getattr(lt, 'lab_group', 'N/A')}")
# 		print(f"  lab_test_group: {getattr(lt, 'lab_test_group', 'N/A')}")
		
# 		return lt

# 	is_group = frappe.db.get_value("Lab Test Template", sr.template_dn, "is_group")
# 	print("Is group template?", sr.template_dn)
	
# 	if is_group:
# 		# Find all child lab test templates where lab_group equals the parent template
# 		child_templates = frappe.get_all(
# 			"Lab Test Template",
# 			filters={
# 				"lab_group": sr.template_dn,
# 				"disabled": 0
# 			},
# 			fields=["name", "lab_test_name"],
# 			order_by="lab_test_name asc",
# 			ignore_permissions=True,
# 		)
		
# 		print("Child templates:", child_templates)
		
# 		if not child_templates:
# 			frappe.throw(_("No child templates found for this group template."))
		
# 		created_names = []
# 		errors = []
		
# 		for child in child_templates:
# 			if not child.name:
# 				continue
			
# 			# Pass the parent group name to link child tests to this group
# 			lt = _build_lab_test(child.name, parent_group=sr.template_dn)
			
# 			try:
# 				lt.insert(ignore_permissions=True)
# 				created_names.append(lt.name)
# 				print(f"Successfully created Lab Test: {lt.name}")
# 			except Exception as e:
# 				error_msg = f"Failed to create Lab Test for {child.name}: {str(e)}"
# 				print(error_msg)
# 				errors.append(error_msg)
# 				frappe.log_error(
# 					f"Lab Test Creation Error for {child.name}:\n"
# 					f"Error: {str(e)}\n"
# 					f"Lab Test data: {lt.as_dict()}",
# 					"Lab Test Creation Error"
# 				)
# 				# Don't continue, show the actual error
# 				frappe.throw(_("Failed to create lab test for {0}: {1}").format(child.name, str(e)))

# 			# Reflect each test on Patient Visit
# 			if sr.order_group and frappe.db.exists("Patient Visit", sr.order_group):
# 				visit = frappe.get_doc("Patient Visit", sr.order_group)
# 				visit.append("lab_tests_charges", {
# 					"test_code": lt.name,
# 					"test_name": lt.lab_test_name or child.lab_test_name or child.name,
# 					"amount": sr.amount or 0,
# 					"net_amount": sr.amount or 0,
# 				})
# 				visit.save(ignore_permissions=True)

# 		if not created_names:
# 			frappe.throw(_("Failed to create any lab tests for this group. Errors: {0}").format(", ".join(errors)))
			
# 		sr.db_set("booked", 1)
# 		frappe.db.commit()
# 		return {"lab_tests": created_names, "count": len(created_names), "patient_visit": sr.order_group}

# 	# Non-group: single lab test
# 	lab_test = _build_lab_test(sr.template_dn, parent_group=None)
# 	lab_test.insert(ignore_permissions=True)
# 	sr.db_set("booked", 1)

# 	if sr.order_group and frappe.db.exists("Patient Visit", sr.order_group):
# 		visit = frappe.get_doc("Patient Visit", sr.order_group)
# 		visit.append("lab_tests_charges", {
# 			"test_code": lab_test.name,
# 			"test_name": lab_test.lab_test_name or sr.template_dn,
# 			"amount": sr.amount or 0,
# 			"net_amount": sr.amount or 0,
# 		})
# 		visit.save(ignore_permissions=True)

# 	frappe.db.commit()
# 	return {"lab_test": lab_test.name, "patient_visit": sr.order_group}
@frappe.whitelist()
def book_lab_and_forward(service_request_name):
	"""
	Booked Lab: after patient has accepted cost, forward the lab request to the laboratory.
	For group templates, creates one Lab Test per child template in the group.
	"""
	if not service_request_name:
		frappe.throw(_("Service Request name is required"))
	sr = frappe.get_doc("Service Request", service_request_name)
	if sr.template_dt != "Lab Test Template":
		frappe.throw(_("Booked Lab is only for Lab Test Template requests."))
	if not sr.patient_accepted_cost:
		frappe.throw(_("Patient must accept cost before using Booked Lab."))
	if sr.booked:
		if sr.docstatus == 0:
			sr.flags.ignore_permissions = True
			sr.submit()
			frappe.db.commit()
			return {
				"ok": True,
				"already_booked": True,
				"submitted": True,
				"service_request": sr.name,
			}
		frappe.throw(_("This request has already been forwarded to the laboratory."))

	existing = frappe.get_all(
		"Lab Test",
		filters={"service_request": sr.name, "docstatus": ["!=", 2]},
		fields=["name"]
	)
	if existing:
		frappe.throw(_("Lab Test(s) already exist for this request."))

	request_items = parse_lab_request_items(sr)
	if not request_items:
		frappe.throw(_("No lab tests are configured on this service request."))

	patient_care_type = (
		"OP" if sr.patient_visit else "IP" if sr.inpatient_record else None
	)
	specs = expand_lab_test_specs(
		request_items, sr.patient, patient_care_type=patient_care_type
	)
	specs = apply_discounts_to_specs(specs, request_items)
	if not specs:
		frappe.throw(_("No lab tests are selected on this service request."))

	admission = resolve_inpatient_admission_name(
		sr.inpatient_record or sr.get("inpatient_admission"),
		sr.patient,
	)

	def _build_lab_test(template_dn, amount=None, parent_group=None, spec=None):
		"""Helper: create (but don't insert) a Lab Test for the given template."""
		spec = spec or {}
		lt = frappe.new_doc("Lab Test")
		lt.template = template_dn
		lt.service_request = sr.name
		lt.trans_num = generate_lab_test_trans_num(format_type="prefixed", prefix="LT-", padding=6)
		lt.company = sr.company
		lt.patient = sr.patient
		lt.patient_name = sr.patient_name
		lt.patient_sex = sr.patient_gender
		lt.patient_age = sr.patient_age_data
		lt.patient_visit = sr.patient_visit
		# inpatient_record and inpatient_admission are the same Inpatient Admission.
		lt.inpatient_record = admission
		lt.inpatient_admission = admission
		lt.email = sr.patient_email
		lt.mobile = sr.patient_mobile
		
		# If this is a child of a group template, set the lab_group to parent
		if parent_group:
			lt.lab_test_group = parent_group
			lt.is_group_lab_test = 1
		
		lt.practitioner = sr.practitioner
		if getattr(sr, "assigned_healthcare_practioner", None) and lt.meta.has_field(
			"assigned_healthcare_practioner"
		):
			lt.assigned_healthcare_practioner = sr.assigned_healthcare_practioner
		# lt.requesting_department = sr.medical_department
		lt.date = sr.occurrence_date
		lt.time = sr.occurrence_time
		lt.invoiced = sr.get("invoiced") or 0
		
		if getattr(sr, "cost_center", None):
			lt.cost_center = sr.cost_center
		
		# Use the passed amount (individual price) instead of the group total
		if amount is not None:
			lt.amount = amount
		elif getattr(sr, "cost", None) is not None:
			lt.amount = sr.cost
		elif getattr(sr, "amount", None) is not None:
			lt.amount = sr.amount
			
		if getattr(lt, "amount", None) is not None:
			disc_type = (spec.get("discount_type") or "Percentage").strip()
			disc_rate = flt(spec.get("discount_rate") or 0)
			disc_amt = flt(spec.get("discount") or 0)
			applied = flt(spec.get("discount_applied") or 0)
			net = flt(spec.get("net_amount") if spec.get("net_amount") is not None else lt.amount)

			lt.discount_margin = disc_type
			if disc_type == "Percentage":
				lt.discount = disc_rate
				lt.discount_amount = applied
			else:
				lt.discount = 0
				lt.discount_amount = disc_amt
			lt.grand_total = net
			
		lt.lab_test_name = frappe.db.get_value("Lab Test Template", template_dn, "lab_test_name") or template_dn
		lt.status = "Requested"
		
		return lt

	created_names = []
	errors = []

	for spec in specs:
		# Parent group rate line — billed on SO, no Lab Test document.
		if cint(spec.get("billing_only")):
			continue
		tpl = spec["template"]
		amount = spec.get("amount")
		parent_group = spec.get("parent_group")
		net = spec.get("net_amount") if spec.get("net_amount") is not None else amount
		disc_type = (spec.get("discount_type") or "Percentage").strip()
		try:
			lt = _build_lab_test(tpl, amount=amount, parent_group=parent_group, spec=spec)
			lt.insert(ignore_permissions=True)
			created_names.append(lt.name)

			patient_visit = sr.patient_visit or sr.order_group
			if patient_visit and frappe.db.exists("Patient Visit", patient_visit):
				visit = frappe.get_doc("Patient Visit", patient_visit)
				visit.append(
					"lab_tests_charges",
					{
						"test_code": lt.name,
						"test_name": lt.lab_test_name or tpl,
						"lab_test_template": tpl,
						"lab_test_group": parent_group,
						"amount": amount or 0,
						"discount_type": disc_type,
						"discount_rate": flt(spec.get("discount_rate") or 0) if disc_type == "Percentage" else 0,
						"discount": flt(spec.get("discount") or 0) if disc_type == "Amount" else 0,
						"net_amount": net or 0,
					},
				)
				visit.save(ignore_permissions=True)
		except Exception as e:
			errors.append(f"{tpl}: {e}")
			frappe.log_error(
				title="Lab Test Creation Error",
				message=f"Service Request {sr.name}\nTemplate {tpl}\n{frappe.get_traceback()}",
			)
			frappe.throw(_("Failed to create lab test for {0}: {1}").format(tpl, str(e)))

	if not created_names:
		frappe.throw(_("Failed to create any lab tests. Errors: {0}").format(", ".join(errors)))

	sr.reload()
	sr.booked = 1
	if sr.docstatus == 0:
		sr.flags.ignore_permissions = True
		sr.submit()
	else:
		sr.save(ignore_permissions=True)

	frappe.db.commit()
	if len(created_names) == 1:
		return {
			"lab_test": created_names[0],
			"lab_tests": created_names,
			"count": 1,
			"patient_visit": sr.patient_visit or sr.order_group,
			"inpatient_record": sr.inpatient_record,
		}
	return {
		"lab_tests": created_names,
		"count": len(created_names),
		"patient_visit": sr.patient_visit or sr.order_group,
		"inpatient_record": sr.inpatient_record,
	}


def create_missing_lab_tests_for_booked_request(service_request_name):
	"""
	When editing a booked lab Service Request, create Lab Tests for templates
	that were newly added to lab_request_items (existing templates are left alone).
	"""
	if not service_request_name:
		return []
	sr = frappe.get_doc("Service Request", service_request_name)
	if sr.template_dt != "Lab Test Template" or not cint(sr.booked):
		return []

	request_items = parse_lab_request_items(sr)
	if not request_items:
		return []

	patient_care_type = (
		"OP" if sr.patient_visit else "IP" if sr.inpatient_record else None
	)
	specs = expand_lab_test_specs(
		request_items, sr.patient, patient_care_type=patient_care_type
	)
	specs = apply_discounts_to_specs(specs, request_items)

	existing_templates = set(
		frappe.get_all(
			"Lab Test",
			filters={"service_request": sr.name, "docstatus": ["!=", 2]},
			pluck="template",
		)
	)

	admission = resolve_inpatient_admission_name(
		sr.inpatient_record or sr.get("inpatient_admission"),
		sr.patient,
	)

	created_names = []
	for spec in specs:
		if cint(spec.get("billing_only")):
			continue
		tpl = spec.get("template")
		if not tpl or tpl in existing_templates:
			continue

		amount = spec.get("amount")
		parent_group = spec.get("parent_group")
		net = spec.get("net_amount") if spec.get("net_amount") is not None else amount
		disc_type = (spec.get("discount_type") or "Percentage").strip()

		lt = frappe.new_doc("Lab Test")
		lt.template = tpl
		lt.service_request = sr.name
		lt.trans_num = generate_lab_test_trans_num(format_type="prefixed", prefix="LT-", padding=6)
		lt.company = sr.company
		lt.patient = sr.patient
		lt.patient_name = sr.patient_name
		lt.patient_sex = sr.patient_gender
		lt.patient_age = sr.patient_age_data
		lt.patient_visit = sr.patient_visit
		lt.inpatient_record = admission
		lt.inpatient_admission = admission
		lt.email = sr.patient_email
		lt.mobile = sr.patient_mobile
		if parent_group:
			lt.lab_test_group = parent_group
			lt.is_group_lab_test = 1
		lt.practitioner = sr.practitioner
		if getattr(sr, "assigned_healthcare_practioner", None) and lt.meta.has_field(
			"assigned_healthcare_practioner"
		):
			lt.assigned_healthcare_practioner = sr.assigned_healthcare_practioner
		lt.date = sr.occurrence_date
		lt.time = sr.occurrence_time
		lt.invoiced = sr.get("invoiced") or 0
		if getattr(sr, "cost_center", None):
			lt.cost_center = sr.cost_center
		if amount is not None:
			lt.amount = amount
		elif getattr(sr, "cost", None) is not None:
			lt.amount = sr.cost
		elif getattr(sr, "amount", None) is not None:
			lt.amount = sr.amount
		if getattr(lt, "amount", None) is not None:
			disc_rate = flt(spec.get("discount_rate") or 0)
			disc_amt = flt(spec.get("discount") or 0)
			applied = flt(spec.get("discount_applied") or 0)
			lt.discount_margin = disc_type
			if disc_type == "Percentage":
				lt.discount = disc_rate
				lt.discount_amount = applied
			else:
				lt.discount = 0
				lt.discount_amount = disc_amt
			lt.grand_total = flt(net)
		lt.lab_test_name = frappe.db.get_value("Lab Test Template", tpl, "lab_test_name") or tpl
		lt.status = "Requested"
		try:
			lt.insert(ignore_permissions=True)
		except Exception as e:
			frappe.log_error(
				title="Lab Test Creation Error (edit add)",
				message=f"Service Request {sr.name}\nTemplate {tpl}\n{frappe.get_traceback()}",
			)
			frappe.throw(_("Failed to create lab test for {0}: {1}").format(tpl, str(e)))

		created_names.append(lt.name)
		existing_templates.add(tpl)

		patient_visit = sr.patient_visit or sr.order_group
		if patient_visit and frappe.db.exists("Patient Visit", patient_visit):
			visit = frappe.get_doc("Patient Visit", patient_visit)
			visit.append(
				"lab_tests_charges",
				{
					"test_code": lt.name,
					"test_name": lt.lab_test_name or tpl,
					"lab_test_template": tpl,
					"lab_test_group": parent_group,
					"amount": amount or 0,
					"discount_type": disc_type,
					"discount_rate": flt(spec.get("discount_rate") or 0) if disc_type == "Percentage" else 0,
					"discount": flt(spec.get("discount") or 0) if disc_type == "Amount" else 0,
					"net_amount": net or 0,
				},
			)
			visit.save(ignore_permissions=True)

	return created_names


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
					doc="Patient Visit",
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
		"Diagnostic Report", {"docname": service_request.order_group}
	)
	if not diagnostic_report:
		insert_diagnostic_report(service_request, sample_collection.name if sample_collection else None)

	if sample_collection:
		if diagnostic_report and not frappe.db.get_value(
			"Diagnostic Report", diagnostic_report, "sample_collection"
		):
			frappe.db.set_value(
				"Diagnostic Report", diagnostic_report, "sample_collection", sample_collection.name
			)
		return sample_collection.name, "Sample Collection"
	elif observation:
		return observation.name, "Observation"


def create_sample_collection(patient, service_request, template=None):
	sample_collection = frappe.new_doc("Sample Collection")
	sample_collection.patient = patient.name
	sample_collection.patient_age = patient.get_age()
	sample_collection.patient_sex = patient.sex
	sample_collection.inpatient_record = resolve_inpatient_admission_name(
		service_request.inpatient_record or service_request.get("inpatient_admission"),
		patient.name,
	)
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
	doc.reference_doctype = "Patient Visit"
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
		{
			"service_request": service_request.name,
			"parenttype": "Sample Collection",
			"docstatus": ["!=", 2],
		},
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
				"docstatus": ["!=", 2],
			},
		)
		if exist_observation:
			return exist_observation, "Observation"


@frappe.whitelist()
def make_appointment(source_name, target_doc=None, ignore_permissions=False):
	def postprocess(source, target):
		set_missing_values(source, target)

	def set_missing_values(source, target):
		target.department = frappe.db.get_value(
			"Healthcare Practitioner", source.referred_to_practitioner, "department"
		)

	doclist = get_mapped_doc(
		"Service Request",
		source_name,
		{
			"Service Request": {
				"doctype": "Patient Appointment",
				"field_map": {
					"name": "service_request",
					"referred_to_practitioner": "practitioner",
					"template_dn": "appointment_type",
					"source_doc": "reference_doctype",
					"order_group": "reference_docname",
				},
				"field_no_map": ["naming_series", "status"],
			},
		},
		target_doc,
		postprocess,
		ignore_permissions=ignore_permissions,
	)

	return doclist
