# -*- coding: utf-8 -*-
# Copyright (c) 2018, earthians and contributors
# For license information, please see license.txt


import json
import math

import frappe
from frappe import _
from frappe.utils import cstr, flt, get_link_to_form, rounded, time_diff_in_hours
from frappe.utils.formatters import format_value

from erpnext.setup.utils import insert_record

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import (
	get_income_account,
)
from healthcare.healthcare.doctype.lab_test.lab_test import create_multiple
from healthcare.setup import setup_healthcare


@frappe.whitelist()
def get_healthcare_services_to_invoice(patient, company):
	patient = frappe.get_doc("Patient", patient)
	items_to_invoice = []
	if patient:
		validate_customer_created(patient)
		# Customer validated, build a list of billable services
		items_to_invoice += get_appointments_to_invoice(patient, company)
		items_to_invoice += get_encounters_to_invoice(patient, company)
		items_to_invoice += get_lab_tests_to_invoice(patient, company)
		items_to_invoice += get_clinical_procedures_to_invoice(patient, company)
		items_to_invoice += get_inpatient_services_to_invoice(patient, company)
		items_to_invoice += get_therapy_plans_to_invoice(patient, company)
		items_to_invoice += get_therapy_sessions_to_invoice(patient, company)
		items_to_invoice += get_service_requests_to_invoice(patient, company)
		return items_to_invoice


def validate_customer_created(patient):
	if not frappe.db.get_value("Patient", patient.name, "customer"):
		msg = _("Please set a Customer linked to the Patient")
		msg += " <b><a href='/app/Form/Patient/{0}'>{0}</a></b>".format(patient.name)
		frappe.throw(msg, title=_("Customer Not Found"))


def get_appointments_to_invoice(patient, company):
	appointments_to_invoice = []
	patient_appointments = frappe.get_list(
		"Patient Appointment",
		fields="*",
		filters={
			"patient": patient.name,
			"company": company,
			"invoiced": 0,
			"status": ["!=", "Cancelled"],
		},
		order_by="appointment_date",
	)

	for appointment in patient_appointments:
		# Procedure Appointments
		if appointment.procedure_template:
			if frappe.db.get_value(
				"Clinical Procedure Template", appointment.procedure_template, "is_billable"
			):
				appointments_to_invoice.append(
					{
						"reference_type": "Patient Appointment",
						"reference_name": appointment.name,
						"service": appointment.procedure_template,
					}
				)
		# Consultation Appointments, should check fee validity
		else:
			if frappe.db.get_single_value(
				"Healthcare Settings", "enable_free_follow_ups"
			) and frappe.db.exists("Fee Validity Reference", {"appointment": appointment.name}):
				continue  # Skip invoicing, fee validty present
			practitioner_charge = 0
			income_account = None
			service_item = None
			if appointment.practitioner:
				details = get_appointment_billing_item_and_rate(appointment)
				service_item = details.get("service_item")
				practitioner_charge = details.get("practitioner_charge")
				income_account = get_income_account(appointment.practitioner, appointment.company)
			appointments_to_invoice.append(
				{
					"reference_type": "Patient Appointment",
					"reference_name": appointment.name,
					"service": service_item,
					"rate": practitioner_charge,
					"income_account": income_account,
				}
			)

	return appointments_to_invoice


def get_encounters_to_invoice(patient, company):
	if not isinstance(patient, str):
		patient = patient.name
	encounters_to_invoice = []
	encounters = frappe.get_list(
		"Patient Encounter",
		fields=["*"],
		filters={"patient": patient, "company": company, "invoiced": False, "docstatus": 1},
	)
	if encounters:
		for encounter in encounters:
			if not encounter.appointment:
				practitioner_charge = 0
				income_account = None
				service_item = None
				if encounter.practitioner:
					if encounter.inpatient_record and frappe.db.get_single_value(
						"Healthcare Settings", "do_not_bill_inpatient_encounters"
					):
						continue

					details = get_appointment_billing_item_and_rate(encounter)
					service_item = details.get("service_item")
					practitioner_charge = details.get("practitioner_charge")
					income_account = get_income_account(encounter.practitioner, encounter.company)

				encounters_to_invoice.append(
					{
						"reference_type": "Patient Encounter",
						"reference_name": encounter.name,
						"service": service_item,
						"rate": practitioner_charge,
						"income_account": income_account,
					}
				)

	return encounters_to_invoice


def get_lab_tests_to_invoice(patient, company):
	lab_tests_to_invoice = []
	lab_tests = frappe.get_list(
		"Lab Test",
		fields=["name", "template"],
		filters={
			"patient": patient.name,
			"company": company,
			"invoiced": False,
			"docstatus": 1,
			"service_request": "",
		},
	)
	for lab_test in lab_tests:
		item, is_billable = frappe.get_cached_value(
			"Lab Test Template", lab_test.template, ["item", "is_billable"]
		)
		if is_billable:
			lab_tests_to_invoice.append(
				{"reference_type": "Lab Test", "reference_name": lab_test.name, "service": item}
			)

	return lab_tests_to_invoice


def get_clinical_procedures_to_invoice(patient, company):
	clinical_procedures_to_invoice = []
	procedures = frappe.get_list(
		"Clinical Procedure",
		fields="*",
		filters={
			"patient": patient.name,
			"company": company,
			"invoiced": False,
			"docstatus": 1,
			"service_request": "",
		},
	)
	for procedure in procedures:
		if not procedure.appointment:
			item, is_billable = frappe.get_cached_value(
				"Clinical Procedure Template", procedure.procedure_template, ["item", "is_billable"]
			)
			if procedure.procedure_template and is_billable:
				clinical_procedures_to_invoice.append(
					{"reference_type": "Clinical Procedure", "reference_name": procedure.name, "service": item}
				)

		# consumables
		if (
			procedure.invoice_separately_as_consumables
			and procedure.consume_stock
			and procedure.status == "Completed"
			and not procedure.consumption_invoiced
		):
			service_item = frappe.db.get_single_value(
				"Healthcare Settings", "clinical_procedure_consumable_item"
			)
			if not service_item:
				msg = _("Please Configure Clinical Procedure Consumable Item in {0}").format(
					get_link_to_form("Healthcare Settings", "Healthcare Settings")
				)

				frappe.throw(msg, title=_("Missing Configuration"))

			clinical_procedures_to_invoice.append(
				{
					"reference_type": "Clinical Procedure",
					"reference_name": procedure.name,
					"service": service_item,
					"rate": procedure.consumable_total_amount,
					"description": procedure.consumption_details,
				}
			)

	return clinical_procedures_to_invoice


def get_inpatient_services_to_invoice(patient, company):
	services_to_invoice = []
	inpatient_services = frappe.db.sql(
		"""
			SELECT
				io.*
			FROM
				`tabInpatient Record` ip, `tabInpatient Occupancy` io
			WHERE
				ip.patient=%s
				and ip.company=%s
				and io.parent=ip.name
				and io.left=1
				and io.invoiced=0
		""",
		(patient.name, company),
		as_dict=1,
	)

	for inpatient_occupancy in inpatient_services:
		service_unit_type = frappe.db.get_value(
			"Healthcare Service Unit", inpatient_occupancy.service_unit, "service_unit_type"
		)
		service_unit_type = frappe.get_cached_doc("Healthcare Service Unit Type", service_unit_type)
		if service_unit_type and service_unit_type.is_billable:
			hours_occupied = flt(
				time_diff_in_hours(inpatient_occupancy.check_out, inpatient_occupancy.check_in), 2
			)
			qty = 0.5
			if hours_occupied > 0:
				actual_qty = hours_occupied / service_unit_type.no_of_hours
				floor = math.floor(actual_qty)
				decimal_part = actual_qty - floor
				if decimal_part > 0.5:
					qty = rounded(floor + 1, 1)
				elif decimal_part < 0.5 and decimal_part > 0:
					qty = rounded(floor + 0.5, 1)
				if qty <= 0:
					qty = 0.5
			services_to_invoice.append(
				{
					"reference_type": "Inpatient Occupancy",
					"reference_name": inpatient_occupancy.name,
					"service": service_unit_type.item,
					"qty": qty,
				}
			)

	return services_to_invoice


def get_therapy_plans_to_invoice(patient, company):
	therapy_plans_to_invoice = []
	therapy_plans = frappe.get_list(
		"Therapy Plan",
		fields=["therapy_plan_template", "name"],
		filters={
			"patient": patient.name,
			"invoiced": 0,
			"company": company,
			"therapy_plan_template": ("!=", ""),
			"docstatus": 1,
		},
	)
	for plan in therapy_plans:
		therapy_plans_to_invoice.append(
			{
				"reference_type": "Therapy Plan",
				"reference_name": plan.name,
				"service": frappe.db.get_value(
					"Therapy Plan Template", plan.therapy_plan_template, "linked_item"
				),
			}
		)

	return therapy_plans_to_invoice


def get_therapy_sessions_to_invoice(patient, company):
	therapy_sessions_to_invoice = []
	therapy_plans = frappe.db.get_all("Therapy Plan", {"therapy_plan_template": ("!=", "")})
	therapy_plans_created_from_template = []
	for entry in therapy_plans:
		therapy_plans_created_from_template.append(entry.name)

	therapy_sessions = frappe.get_list(
		"Therapy Session",
		fields="*",
		filters={
			"patient": patient.name,
			"invoiced": 0,
			"company": company,
			"therapy_plan": ("not in", therapy_plans_created_from_template),
			"docstatus": 1,
			"service_request": "",
		},
	)
	for therapy in therapy_sessions:
		if not therapy.appointment:
			if therapy.therapy_type and frappe.db.get_value(
				"Therapy Type", therapy.therapy_type, "is_billable"
			):
				therapy_sessions_to_invoice.append(
					{
						"reference_type": "Therapy Session",
						"reference_name": therapy.name,
						"service": frappe.db.get_value("Therapy Type", therapy.therapy_type, "item"),
					}
				)

	return therapy_sessions_to_invoice


def get_service_requests_to_invoice(patient, company):
	orders_to_invoice = []
	service_requests = frappe.get_list(
		"Service Request",
		fields=["*"],
		filters={
			"patient": patient.name,
			"company": company,
			"billing_status": ["!=", ["Invoiced"]],
			"docstatus": 1,
		},
	)
	for service_request in service_requests:
		item, is_billable = frappe.get_cached_value(
			service_request.template_dt, service_request.template_dn, ["item", "is_billable"]
		)
		price_list, price_list_currency = frappe.db.get_values(
			"Price List", {"selling": 1}, ["name", "currency"]
		)[0]
		args = {
			"doctype": "Sales Invoice",
			"item_code": item,
			"company": service_request.get("company"),
			"customer": frappe.db.get_value("Patient", service_request.get("patient"), "customer"),
			"plc_conversion_rate": 1.0,
			"conversion_rate": 1.0,
		}
		if is_billable:
			orders_to_invoice.append(
				{
					"reference_type": "Service Request",
					"reference_name": service_request.name,
					"service": item,
					"qty": service_request.quantity if service_request.quantity else 1,
				}
			)
	return orders_to_invoice


@frappe.whitelist()
def get_appointment_billing_item_and_rate(doc):
	if isinstance(doc, str):
		doc = json.loads(doc)
		doc = frappe.get_doc(doc)

	service_item = None
	practitioner_charge = None
	department = doc.medical_department if doc.doctype == "Patient Encounter" else doc.department
	service_unit = doc.service_unit if doc.doctype == "Patient Appointment" else None

	is_inpatient = doc.inpatient_record

	if doc.get("practitioner"):
		service_item, practitioner_charge = get_practitioner_billing_details(
			doc.practitioner, is_inpatient
		)

	if not service_item and doc.get("appointment_type"):
		service_item, appointment_charge = get_appointment_type_billing_details(
			doc.appointment_type, department if department else service_unit, is_inpatient
		)
		if not practitioner_charge:
			practitioner_charge = appointment_charge

	if not service_item:
		service_item = get_healthcare_service_item(is_inpatient)

	if not service_item:
		throw_config_service_item(is_inpatient)

	if not practitioner_charge and doc.get("practitioner"):
		throw_config_practitioner_charge(is_inpatient, doc.practitioner)

	if not practitioner_charge and not doc.get("practitioner"):
		throw_config_appointment_type_charge(is_inpatient, doc.appointment_type)

	return {"service_item": service_item, "practitioner_charge": practitioner_charge}


def get_appointment_type_billing_details(appointment_type, dep_su, is_inpatient):
	from healthcare.healthcare.doctype.appointment_type.appointment_type import get_billing_details

	if not dep_su:
		return None, None

	item_list = get_billing_details(appointment_type, dep_su)
	service_item = None
	practitioner_charge = None

	if item_list:
		if is_inpatient:
			service_item = item_list.get("inpatient_visit_charge_item")
			practitioner_charge = item_list.get("inpatient_visit_charge")
		else:
			service_item = item_list.get("op_consulting_charge_item")
			practitioner_charge = item_list.get("op_consulting_charge")

	return service_item, practitioner_charge


def throw_config_service_item(is_inpatient):
	service_item_label = (
		_("Inpatient Visit Charge Item") if is_inpatient else _("Out Patient Consulting Charge Item")
	)

	msg = _(
		("Please Configure {0} in ").format(service_item_label)
		+ """<b><a href='/app/Form/Healthcare Settings'>Healthcare Settings</a></b>"""
	)
	frappe.throw(msg, title=_("Missing Configuration"))


def throw_config_practitioner_charge(is_inpatient, practitioner):
	charge_name = _("Inpatient Visit Charge") if is_inpatient else _("OP Consulting Charge")

	msg = _(
		("Please Configure {0} for Healthcare Practitioner").format(charge_name)
		+ """ <b><a href='/app/Form/Healthcare Practitioner/{0}'>{0}</a></b>""".format(practitioner)
	)
	frappe.throw(msg, title=_("Missing Configuration"))


def throw_config_appointment_type_charge(is_inpatient, appointment_type):
	charge_name = _("Inpatient Visit Charge") if is_inpatient else _("OP Consulting Charge")

	msg = _(
		("Please Configure {0} for Appointment Type").format(charge_name)
		+ """ <b><a href='/app/Form/Appointment type/{0}'>{0}</a></b>""".format(appointment_type)
	)
	frappe.throw(msg, title=_("Missing Configuration"))


def get_practitioner_billing_details(practitioner, is_inpatient):
	service_item = None
	practitioner_charge = None

	if is_inpatient:
		fields = ["inpatient_visit_charge_item", "inpatient_visit_charge"]
	else:
		fields = ["op_consulting_charge_item", "op_consulting_charge"]

	if practitioner:
		service_item, practitioner_charge = frappe.db.get_value(
			"Healthcare Practitioner", practitioner, fields
		)

	return service_item, practitioner_charge


def get_healthcare_service_item(is_inpatient):
	service_item = None

	if is_inpatient:
		service_item = frappe.db.get_single_value("Healthcare Settings", "inpatient_visit_charge_item")
	else:
		service_item = frappe.db.get_single_value("Healthcare Settings", "op_consulting_charge_item")

	return service_item


def manage_invoice_validate(doc, method):
	if doc.service_unit and len(doc.items):
		for item in doc.items:
			if not item.service_unit:
				item.service_unit = doc.service_unit


def manage_invoice_submit_cancel(doc, method):
	if not doc.patient:
		return

	if doc.items:
		for item in doc.items:
			if item.get("reference_dt") and item.get("reference_dn"):
				# TODO check
				# if frappe.get_meta(item.reference_dt).has_field("invoiced"):
				set_invoiced(item, method, doc.name)

	if method == "on_submit":
		if frappe.db.get_single_value("Healthcare Settings", "create_lab_test_on_si_submit"):
			create_multiple("Sales Invoice", doc.name)

		if (
			not frappe.db.get_single_value("Healthcare Settings", "show_payment_popup")
			and frappe.db.get_single_value("Healthcare Settings", "enable_free_follow_ups")
			and doc.items
		):
			for item in doc.items:
				if item.reference_dt == "Patient Appointment":
					fee_validity = frappe.db.exists("Fee Validity", {"patient_appointment": item.reference_dn})
					if fee_validity:
						frappe.db.set_value("Fee Validity", fee_validity, "sales_invoice_ref", doc.name)


def set_invoiced(item, method, ref_invoice=None):
	invoiced = False
	if method == "on_submit":
		validate_invoiced_on_submit(item)
		invoiced = True

	if item.reference_dt == "Clinical Procedure":
		service_item = frappe.db.get_single_value(
			"Healthcare Settings", "clinical_procedure_consumable_item"
		)
		if service_item == item.item_code:
			frappe.db.set_value(item.reference_dt, item.reference_dn, "consumption_invoiced", invoiced)
		else:
			frappe.db.set_value(item.reference_dt, item.reference_dn, "invoiced", invoiced)
	else:
		if item.reference_dt not in ["Service Request", "Medication Request"]:
			frappe.db.set_value(item.reference_dt, item.reference_dn, "invoiced", invoiced)

	if item.reference_dt == "Patient Appointment":
		if frappe.db.get_value("Patient Appointment", item.reference_dn, "procedure_template"):
			dt_from_appointment = "Clinical Procedure"
		else:
			dt_from_appointment = "Patient Encounter"
		manage_doc_for_appointment(dt_from_appointment, item.reference_dn, invoiced)

	elif item.reference_dt == "Lab Prescription":
		manage_prescriptions(
			invoiced, item.reference_dt, item.reference_dn, "Lab Test", "lab_test_created"
		)

	elif item.reference_dt == "Procedure Prescription":
		manage_prescriptions(
			invoiced, item.reference_dt, item.reference_dn, "Clinical Procedure", "procedure_created"
		)
	elif item.reference_dt in ["Service Request", "Medication Request"]:
		# if order is invoiced, set both order and service transaction as invoiced
		hso = frappe.get_doc(item.reference_dt, item.reference_dn)
		if invoiced:
			hso.update_invoice_details(item.qty)
		else:
			hso.update_invoice_details(item.qty * -1)

		# service transaction linking to HSO
		if item.reference_dt == "Service Request":
			template_map = {
				"Clinical Procedure Template": "Clinical Procedure",
				"Therapy Type": "Therapy Session",
				"Lab Test Template": "Lab Test"
				# 'Healthcare Service Unit': 'Inpatient Occupancy'
			}


def validate_invoiced_on_submit(item):
	if (
		item.reference_dt == "Clinical Procedure"
		and frappe.db.get_single_value("Healthcare Settings", "clinical_procedure_consumable_item")
		== item.item_code
	):
		is_invoiced = frappe.db.get_value(item.reference_dt, item.reference_dn, "consumption_invoiced")

	elif item.reference_dt in ["Service Request", "Medication Request"]:
		billing_status = frappe.db.get_value(item.reference_dt, item.reference_dn, "billing_status")
		is_invoiced = True if billing_status == "Invoiced" else False

	else:
		is_invoiced = frappe.db.get_value(item.reference_dt, item.reference_dn, "invoiced")
	if is_invoiced:
		frappe.throw(
			_("The item referenced by {0} - {1} is already invoiced").format(
				item.reference_dt, item.reference_dn
			)
		)


def manage_prescriptions(invoiced, ref_dt, ref_dn, dt, created_check_field):
	created = frappe.db.get_value(ref_dt, ref_dn, created_check_field)
	if created:
		# Fetch the doc created for the prescription
		doc_created = frappe.db.get_value(dt, {"prescription": ref_dn})
		frappe.db.set_value(dt, doc_created, "invoiced", invoiced)


def manage_doc_for_appointment(dt_from_appointment, appointment, invoiced):
	dn_from_appointment = frappe.db.get_value(
		dt_from_appointment, filters={"appointment": appointment}
	)
	if dn_from_appointment:
		frappe.db.set_value(dt_from_appointment, dn_from_appointment, "invoiced", invoiced)


@frappe.whitelist()
def get_drugs_to_invoice(encounter):
	encounter = frappe.get_doc("Patient Encounter", encounter)
	if encounter:
		patient = frappe.get_doc("Patient", encounter.patient)
		if patient:
			if patient.customer:
				orders_to_invoice = []
				medication_requests = frappe.get_list(
					"Medication Request",
					fields=["*"],
					filters={
						"patient": patient.name,
						"order_group": encounter.name,
						"billing_status": ["in", ["Pending", "Partly Invoiced"]],
						"docstatus": 1,
					},
				)
				for medication_request in medication_requests:
					is_billable = frappe.get_cached_value(
						"Medication", medication_request.medication, ["is_billable"]
					)

					description = ""
					if medication_request.dosage and medication_request.period:
						description = _("{0} for {1}").format(medication_request.dosage, medication_request.period)

					if medication_request.medicaiton_item and is_billable:
						billable_order_qty = medication_request.get("quantity", 1) - medication_request.get(
							"qty_invoiced", 0
						)
						if medication_request.number_of_repeats_allowed:
							if (
								medication_request.total_dispensable_quantity
								>= medication_request.quantity + medication_request.qty_invoiced
							):
								billable_order_qty = medication_request.get("quantity", 1)
							else:
								billable_order_qty = (
									medication_request.total_dispensable_quantity - medication_request.get("qty_invoiced", 0)
								)

						orders_to_invoice.append(
							{
								"reference_type": "Medication Request",
								"reference_name": medication_request.name,
								"drug_code": medication_request.medicaiton_item,
								"quantity": billable_order_qty,
								"description": description,
							}
						)
				return orders_to_invoice


@frappe.whitelist()
def get_children(doctype, parent=None, company=None, is_root=False):
	parent_fieldname = "parent_" + doctype.lower().replace(" ", "_")
	fields = ["name as value", "is_group as expandable", "lft", "rgt"]

	filters = [["ifnull(`{0}`,'')".format(parent_fieldname), "=", "" if is_root else parent]]

	if is_root:
		fields += ["service_unit_type"] if doctype == "Healthcare Service Unit" else []
		filters.append(["company", "=", company])
	else:
		fields += (
			["service_unit_type", "allow_appointments", "inpatient_occupancy", "occupancy_status"]
			if doctype == "Healthcare Service Unit"
			else []
		)
		fields += [parent_fieldname + " as parent"]

	service_units = frappe.get_list(doctype, fields=fields, filters=filters)
	for each in service_units:
		if each["expandable"] != 1 or each["value"].startswith("All Healthcare Service Units"):
			continue

		available_count = frappe.db.count(
			"Healthcare Service Unit",
			filters={"parent_healthcare_service_unit": each["value"], "inpatient_occupancy": 1},
		)

		if available_count > 0:
			occupied_count = frappe.db.count(
				"Healthcare Service Unit",
				filters={
					"parent_healthcare_service_unit": each["value"],
					"inpatient_occupancy": 1,
					"occupancy_status": "Occupied",
				},
			)
			# set occupancy status of group node
			each["occupied_of_available"] = f"{str(occupied_count)} Occupied of {str(available_count)}"

	return service_units


@frappe.whitelist()
def get_patient_vitals(patient, from_date=None, to_date=None):
	if not patient:
		return

	vitals = frappe.db.get_all(
		"Vital Signs",
		filters={"docstatus": 1, "patient": patient},
		order_by="signs_date, signs_time",
		fields=["*"],
	)

	if len(vitals):
		return vitals
	return False


@frappe.whitelist()
def render_docs_as_html(docs):
	# docs key value pair {doctype: docname}
	docs_html = "<div class='col-md-12 col-sm-12 text-muted'>"
	for doc in docs:
		docs_html += render_doc_as_html(doc["doctype"], doc["docname"])["html"] + "<br/>"
		return {"html": docs_html}


@frappe.whitelist()
def render_doc_as_html(doctype, docname, exclude_fields=None):
	"""
	Render document as HTML
	"""
	exclude_fields = exclude_fields or []
	doc = frappe.get_doc(doctype, docname)
	meta = frappe.get_meta(doctype)
	doc_html = section_html = section_label = html = ""
	sec_on = has_data = False
	col_on = 0

	for df in meta.fields:
		# on section break append previous section and html to doc html
		if df.fieldtype == "Section Break":
			if has_data and col_on and sec_on:
				doc_html += section_html + html + "</div>"

			elif has_data and not col_on and sec_on:
				doc_html += """
					<br>
					<div class='row'>
						<div class='col-md-12 col-sm-12'>
							<b>{0}</b>
						</div>
					</div>
					<div class='row'>
						<div class='col-md-12 col-sm-12'>
							{1} {2}
						</div>
					</div>
				""".format(
					section_label, section_html, html
				)

			# close divs for columns
			while col_on:
				doc_html += "</div>"
				col_on -= 1

			sec_on = True
			has_data = False
			col_on = 0
			section_html = html = ""

			if df.label:
				section_label = df.label
			continue

		# on column break append html to section html or doc html
		if df.fieldtype == "Column Break":
			if sec_on and not col_on and has_data:
				section_html += """
					<br>
					<div class='row'>
						<div class='col-md-12 col-sm-12'>
							<b>{0}</b>
						</div>
					</div>
					<div class='row'>
						<div class='col-md-4 col-sm-4'>
							{1}
						</div>
				""".format(
					section_label, html
				)
			elif col_on == 1 and has_data:
				section_html += "<div class='col-md-4 col-sm-4'>" + html + "</div>"
			elif col_on > 1 and has_data:
				doc_html += "<div class='col-md-4 col-sm-4'>" + html + "</div>"
			else:
				doc_html += """
					<div class='row'>
						<div class='col-md-12 col-sm-12'>
							{0}
						</div>
					</div>
				""".format(
					html
				)

			html = ""
			col_on += 1

			if df.label:
				html += "<br>" + df.label
			continue

		# on table iterate through items and create table
		# based on the in_list_view property
		# append to section html or doc html
		if df.fieldtype == "Table":
			items = doc.get(df.fieldname)
			if not items:
				continue
			child_meta = frappe.get_meta(df.options)

			if not has_data:
				has_data = True
			table_head = table_row = ""
			create_head = True

			for item in items:
				table_row += "<tr>"
				for cdf in child_meta.fields:
					if cdf.in_list_view:
						if create_head:
							table_head += "<th class='text-muted'>" + cdf.label + "</th>"
						if item.get(cdf.fieldname):
							table_row += "<td>" + cstr(item.get(cdf.fieldname)) + "</td>"
						else:
							table_row += "<td></td>"

				create_head = False
				table_row += "</tr>"

			if sec_on:
				section_html += """
					<table class='table table-condensed bordered'>
						{0} {1}
					</table>
				""".format(
					table_head, table_row
				)
			else:
				html += """
					<table class='table table-condensed table-bordered'>
						{0} {1}
					</table>
				""".format(
					table_head, table_row
				)
			continue

		# on any other field type add label and value to html
		if (
			not df.hidden
			and not df.print_hide
			and doc.get(df.fieldname)
			and df.fieldname not in exclude_fields
		):
			formatted_value = format_value(doc.get(df.fieldname), meta.get_field(df.fieldname), doc)
			html += "<br>{0} : {1}".format(df.label or df.fieldname, formatted_value)

			if not has_data:
				has_data = True

	if sec_on and col_on and has_data:
		doc_html += section_html + html + "</div></div>"
	elif sec_on and not col_on and has_data:
		doc_html += """
			<div class='col-md-12 col-sm-12'>
				<div class='col-md-12 col-sm-12'>
					{0} {1}
				</div>
			</div>
		""".format(
			section_html, html
		)

	return {"html": doc_html}


def update_address_links(address, method):
	"""
	Hook validate Address
	If Patient is linked in Address, also link the associated Customer
	"""
	if "Healthcare" not in frappe.get_active_domains():
		return

	patient_links = list(filter(lambda link: link.get("link_doctype") == "Patient", address.links))

	for link in patient_links:
		customer = frappe.db.get_value("Patient", link.get("link_name"), "customer")
		if customer and not address.has_link("Customer", customer):
			address.append("links", dict(link_doctype="Customer", link_name=customer))


def update_patient_email_and_phone_numbers(contact, method):
	"""
	Hook validate Contact
	Update linked Patients' primary mobile and phone numbers
	"""
	if "Healthcare" not in frappe.get_active_domains() or contact.flags.skip_patient_update:
		return

	if contact.is_primary_contact and (contact.email_id or contact.mobile_no or contact.phone):
		patient_links = list(filter(lambda link: link.get("link_doctype") == "Patient", contact.links))

		for link in patient_links:
			contact_details = frappe.db.get_value(
				"Patient", link.get("link_name"), ["email", "mobile", "phone"], as_dict=1
			)
			if contact.email_id and contact.email_id != contact_details.get("email"):
				frappe.db.set_value("Patient", link.get("link_name"), "email", contact.email_id)
			if contact.mobile_no and contact.mobile_no != contact_details.get("mobile"):
				frappe.db.set_value("Patient", link.get("link_name"), "mobile", contact.mobile_no)
			if contact.phone and contact.phone != contact_details.get("phone"):
				frappe.db.set_value("Patient", link.get("link_name"), "phone", contact.phone)


def before_tests():
	# complete setup if missing
	from frappe.desk.page.setup_wizard.setup_wizard import setup_complete

	current_year = frappe.utils.now_datetime().year

	if not frappe.get_list("Company"):
		setup_complete(
			{
				"currency": "INR",
				"full_name": "Test User",
				"company_name": "Frappe Care LLC",
				"timezone": "America/New_York",
				"company_abbr": "WP",
				"industry": "Healthcare",
				"country": "United States",
				"fy_start_date": f"{current_year}-01-01",
				"fy_end_date": f"{current_year}-12-31",
				"language": "english",
				"company_tagline": "Testing",
				"email": "test@erpnext.com",
				"password": "test",
				"chart_of_accounts": "Standard",
				"domains": ["Healthcare"],
			}
		)

		setup_healthcare()


def create_healthcare_service_unit_tree_root(doc, method=None):
	record = [
		{
			"doctype": "Healthcare Service Unit",
			"healthcare_service_unit_name": "All Healthcare Service Units",
			"is_group": 1,
			"company": doc.name,
		}
	]
	insert_record(record)


def validate_nursing_tasks(document):
	if not frappe.db.get_single_value("Healthcare Settings", "validate_nursing_checklists"):
		return True

	filters = {
		"reference_name": document.name,
		"mandatory": 1,
		"status": ["not in", ["Completed", "Cancelled"]],
	}
	tasks = frappe.get_all("Nursing Task", filters=filters)
	if not tasks:
		return True

	frappe.throw(
		_("Please complete linked Nursing Tasks before submission: {}").format(
			", ".join(get_link_to_form("Nursing Task", task.name) for task in tasks)
		)
	)


@frappe.whitelist()
def get_medical_codes(template_dt, template_dn, code_standard=None):
	"""returns codification table from templates"""
	filters = {"parent": template_dn, "parenttype": template_dt}

	if code_standard:
		filters["medical_code_standard"] = code_standard

	return frappe.db.get_all(
		"Codification Table",
		filters=filters,
		fields=[
			"medical_code",
			"code",
			"system",
			"description",
			"medical_code_standard",
		],
	)


def company_on_trash(doc, method):
	for su in frappe.get_all("Healthcare Service Unit", {"company": doc.name}):
		service_unit_doc = frappe.get_doc("Healthcare Service Unit", su.get("name"))
		service_unit_doc.flags.on_trash_company = True
		service_unit_doc.delete()
