import json
from datetime import datetime

import frappe
from frappe import _
from frappe.query_builder import Order
from frappe.utils import get_datetime, get_time, getdate

import erpnext

from healthcare.healthcare.doctype.observation.observation import get_observation_reference
from healthcare.healthcare.utils import get_appointment_billing_item_and_rate


@frappe.whitelist()
def get_appointments():
	appointment = frappe.qb.DocType("Patient Appointment")
	encounter = frappe.qb.DocType("Patient Encounter")
	practitioner = frappe.qb.DocType("Healthcare Practitioner")
	patient = frappe.qb.DocType("Patient")
	company = frappe.qb.DocType("Company")

	query = (
		frappe.qb.from_(appointment)
		.left_join(encounter)
		.on((appointment.name == encounter.appointment) & (encounter.docstatus == 1))
		.left_join(practitioner)
		.on(appointment.practitioner == practitioner.name)
		.left_join(patient)
		.on(appointment.patient == patient.name)
		.left_join(company)
		.on(appointment.company == company.name)
		.select(appointment.star)
		.select(encounter.name.as_("encounter"))
		.select(practitioner.image.as_("practitioner_image"))
		.select(patient.image.as_("patient_image"))
		.select(company.default_currency.as_("default_currency"))
		.where(appointment.patient.isin(get_patients_with_relations()))
		.where(appointment.status != "Cancelled")
		.where(appointment.appointment_for == "Practitioner")
		.orderby(appointment.appointment_date, order=Order.desc)
	)

	appointment_details = query.run(as_dict=True)

	return appointment_details


@frappe.whitelist()
def get_logged_in_patient():
	patient = frappe.db.exists("Patient", {"status": "Active", "user_id": frappe.session.user})

	if not patient:
		return None

	return {"value": patient, "label": frappe.get_cached_value("Patient", patient, "patient_name")}


@frappe.whitelist()
def get_departments():
	return frappe.db.get_all(
		"Medical Department",
		filters={"show_in_portal": 1},
		fields=["name", "department", "portal_image"],
		order_by="name ASC",
	)


@frappe.whitelist()
def get_practitioners(department):
	return frappe.db.get_all(
		"Healthcare Practitioner",
		filters={"department": department, "show_in_portal": 1},
		fields=["name", "practitioner_name", "designation", "department", "image"],
	)


@frappe.whitelist()
def get_patients():
	return frappe.db.get_all(
		"Patient",
		filters={"status": "Active", "name": ["in", get_patients_with_relations()]},
		fields=["name as value", "patient_name as label"],
	)


@frappe.whitelist()
def get_settings():
	return frappe.get_single("Healthcare Settings")


@frappe.whitelist()
def get_slots(practitioner, date):
	date = getdate() if date in ["undefined", "", "null"] else getdate(date)
	practitioner = None if practitioner in ["undefined", "", "null"] else practitioner

	if not practitioner:
		return

	current_date = getdate()
	if date < current_date:
		return {"status": "error", "message": "Cannot fetch slots for past dates."}

	practitioner_doc = frappe.get_doc("Healthcare Practitioner", practitioner)
	curr_bookings = frappe.db.get_all(
		"Patient Appointment",
		filters={"practitioner": practitioner_doc.name, "appointment_date": date},
		pluck="appointment_time",
	)
	booked_slots = [(datetime.min + booked_slot).time() for booked_slot in curr_bookings]

	available_slots = full_slots = []
	weekday = date.strftime("%A")

	for schedule_entry in practitioner_doc.practitioner_schedules:
		practitioner_schedule = frappe.get_doc("Practitioner Schedule", schedule_entry.schedule)

		if practitioner_schedule and not practitioner_schedule.disabled:
			available_slots = []
			for time_slot in practitioner_schedule.time_slots:
				if weekday == time_slot.day:
					time = datetime.min + time_slot.from_time
					current_time = get_time(get_datetime())
					time = time.time()
					if date == current_date:
						if time not in booked_slots and time > current_time:
							available_slots.append(time.strftime("%H:%M"))
					else:
						if time not in booked_slots:
							available_slots.append(time.strftime("%H:%M"))
		full_slots.extend(available_slots)

	if len(full_slots) > 0:
		full_slots = list(sorted(full_slots))

	return full_slots if len(full_slots) > 0 else None


@frappe.whitelist()
def make_appointment(practitioner, patient, date, slot):
	doc = frappe.new_doc("Patient Appointment")
	doc.appointment_type = frappe.db.get_single_value(
		"Healthcare Settings", "default_appointment_type"
	)
	doc.appointment_for = frappe.db.get_value(
		"Appointment Type", doc.appointment_type, "allow_booking_for"
	)
	company = frappe.defaults.get_user_default("company")
	if not company:
		company = frappe.db.get_single_value("Global Defaults", "default_company")
	doc.company = company

	doc.patient = patient
	practitioner = frappe.get_doc("Healthcare Practitioner", practitioner)
	doc.practitioner = practitioner.name
	doc.practitioner_name = practitioner.practitioner_name
	doc.department = practitioner.department
	doc.appointment_date = getdate(date)
	doc.appointment_time = slot

	weekday = getdate(date).strftime("%A")

	for schedule_entry in practitioner.practitioner_schedules:
		# validate_practitioner_schedules(schedule_entry, practitioner)
		practitioner_schedule = frappe.get_doc("Practitioner Schedule", schedule_entry.schedule)
		service_unit = frappe.db.get_value(
			"Healthcare Service Unit", schedule_entry.service_unit, "name"
		)

		if practitioner_schedule and not practitioner_schedule.disabled:
			available_slots = []
			for time_slot in practitioner_schedule.time_slots:
				if weekday == time_slot.day:
					# convert timedelta object to datetime object using a fixed base
					time = datetime.min + time_slot.from_time
					# extracting just the time out of the datetime object
					time = time.time()
					available_slots.append(time.strftime("%H:%M"))

		if frappe.form_dict.get("slot") in available_slots:
			break

	doc.service_unit = service_unit

	practitioner_service = get_appointment_billing_item_and_rate(doc)
	doc.billing_item = practitioner_service["service_item"]
	doc.paid_amount = practitioner_service["practitioner_charge"]
	doc.insert(ignore_permissions=True)

	return doc.name


@frappe.whitelist()
def get_fees(practitioner=None, date=None):
	if not (practitioner or date):
		return

	default_currency = erpnext.get_default_currency()
	default_company = frappe.db.get_single_value("Global Defaults", "default_company")

	doc = frappe._dict(
		{
			"department": frappe.get_cached_value("Healthcare Practitioner", practitioner, "department"),
			"service_unit": "",
			"doctype": "Patient Appointment",
			"inpatient_record": "",
			"practitioner": practitioner,
			"appointment_type": frappe.get_single_value("Healthcare Settings", "default_appointment_type"),
		}
	)

	details = get_appointment_billing_item_and_rate(doc)

	return {
		"details": details,
		"default_currency": default_currency,
		"default_company": default_company,
	}


@frappe.whitelist()
def get_print_format(doctype: str, name: str):
	allowed_doctypes = ["Sales Invoice", "Patient Encounter", "Diagnostic Report"]
	if doctype not in allowed_doctypes:
		frappe.throw(_("Not allowed to print this document."), frappe.PermissionError)

	meta = frappe.get_meta(doctype)

	print_format = (
		"Diagnostic Report"
		if doctype == "Diagnostic Report"
		else meta.default_print_format or "Standard"
	)

	letter_head = None
	if meta.has_field("letter_head"):
		letter_head = frappe.db.get_value(doctype, name, "letter_head")

	if not letter_head:
		letter_head = frappe.db.exists("Letter Head", {"is_default": 1})

	return {"letter_head": letter_head, "print_format": print_format}


def get_patients_with_relations():
	filters = {"status": "Active"}
	if frappe.session.user != "Administrator":
		filters["user_id"] = frappe.session.user

	patients = frappe.db.get_all("Patient", filters=filters, pluck="name")
	relation = frappe.db.get_all(
		"Patient Relation", filters={"parent": ["in", patients]}, pluck="patient"
	)

	return patients + relation


@frappe.whitelist()
def get_orders():
	patients = get_patients_with_relations()

	# Get all tests via service requests for the patients
	tests_via_service_requests = get_data_from_service_requests(patients)
	service_request_map = build_order_map(tests_via_service_requests)

	# Get all tests via sale invoice for the patients
	tests_via_invoices = get_data_from_invoices(patients)
	invoice_map = build_order_map(tests_via_invoices, True)

	all_tests = {**service_request_map, **invoice_map}

	# sort by date descending
	sorted_tests = sorted(all_tests.items(), key=lambda x: x[0][1], reverse=True)

	return list(dict(sorted_tests).values())


def build_order_map(orders, from_invoice=False):
	orders_map = {}
	for row in orders:
		patient_doc = frappe.get_doc("Patient", row.patient)
		row["days"] = patient_doc.calculate_age().get("age_in_days") or 0
		key = (row.order_name, row.order_date)
		if key not in orders_map:
			billing_status = (
				"Paid"
				if row.billing_status in ["Invoiced", "Paid"]
				else "Partly Paid"
				if row.billing_status in ["Partly Invoiced", "Partly Paid"]
				else "Unpaid"
			)

			orders_map[key] = {
				"order_name": row.order_name,
				"patient": row.patient,
				"patient_name": row.patient_name,
				"ref_practitioner": row.ref_practitioner_name,
				"order_date": row.order_date,
				"diagnostic_report": row.diagnostic_report,
				"diagnostic_report_status": row.diagnostic_report_status,
				"billing_status": billing_status,
				"collection_point": row.collection_point,
				"invoice": [],
				"patient_image": row.patient_image,
				"tests": [],
			}

		invoice = None
		if row.billing_status in ["Invoiced", "Partly Invoiced", "Paid", "Partly Paid"]:
			if from_invoice:
				invoice = row.order_name
			else:
				invoice = frappe.db.get_value(
					"Sales Invoice Item", {"reference_dn": row.service_request, "docstatus": 1}, "parent"
				)

		if invoice and not invoice in orders_map[key]["invoice"]:
			orders_map[key]["invoice"].append(invoice)

		orders_map[key]["tests"].append(build_template_dict(row))

	return orders_map


def build_template_dict(row):
	test_dict = {
		"observation_template": row.observation_template,
		"service_request": row.get("service_request"),
		"observation": row.observation,
		"reference": get_observation_reference(row) if row.observation else None,
		"result": get_observation_result(row) if row.observation else None,
		"uom": row.permitted_unit,
		"observation_status": "Approved" if row.observation else "Pending",
		"sample_collection_required": row.sample_collection_required,
		"sample_collection": row.sample_collection,
		"observation_sample_collection": row.observation_sample_collection,
		"sample_collection_status": row.sample_collection_status,
		"collection_date_time": row.collection_date_time,
		"has_component": row.has_component,
		"children": [],
	}

	if row.has_component:
		test_dict["children"] = get_child_observations(row)

	return test_dict


def get_child_observations(row):
	if not row.has_component:
		return []

	child_templates = frappe.db.get_all(
		"Observation Component",
		filters={
			"parent": row.observation_template,
			"parentfield": "observation_component",
			"parenttype": "Observation Template",
		},
		pluck="observation_template",
	)

	components = []
	if row.component_observations and isinstance(row.component_observations, str):
		components = json.loads(row.component_observations)

	child_observations = []

	if row.observation:
		child_observations = frappe.get_all(
			"Observation",
			filters={"parent_observation": row.observation, "docstatus": 1, "status": "Approved"},
			fields=["*"],
		)

	results = []
	for obs in child_observations:
		sample_details = next(
			(item for item in components if item.get("observation_template") == obs.observation_template),
			None,
		)
		results.append(
			{
				"observation_template": obs.observation_template,
				"service_request": obs.get("service_request"),
				"observation": obs.name,
				"observation_status": "Approved" if obs.get("docstatus") == 1 else "Pending",
				"reference": get_observation_reference(obs),
				"result": get_observation_result(obs) if obs.get("docstatus") == 1 else None,
				"uom": obs.get("permitted_unit"),
				"sample_collection_required": obs.sample_collection_required,
				"sample_collection": row.sample_collection,
				"observation_sample_collection": row.observation_sample_collection,
				"sample_collection_status": sample_details.get("status"),
				"collection_date_time": sample_details.get("collection_date_time"),
				"has_component": obs.get("has_component"),
			}
		)
		child_templates.remove(obs.observation_template)

	if child_templates:
		for child in child_templates:
			sample_details = next(
				(item for item in components if item["observation_template"] == child), None
			)
			obs = frappe._dict(
				{
					"observation_template": child,
					"gender": row.gender,
					"days": row.days,
				}
			)
			template_doc = frappe.db.get_value(
				"Observation Template", child, ["permitted_unit", "sample_collection_required"], as_dict=True
			)

			results.append(
				{
					"observation_template": child,
					"service_request": row.get("service_request"),
					"observation": None,
					"reference": get_observation_reference(obs) if obs else None,
					"result": None,
					"uom": template_doc.permitted_unit,
					"observation_status": None,
					"sample_collection_required": template_doc.sample_collection_required,
					"sample_collection": row.sample_collection,
					"observation_sample_collection": row.observation_sample_collection,
					"sample_collection_status": sample_details.get("status"),
					"has_component": template_doc.has_component,
				}
			)

	return results


def get_data_from_service_requests(patients):
	service_request = frappe.qb.DocType("Service Request")
	observation = frappe.qb.DocType("Observation")
	observation_template = frappe.qb.DocType("Observation Template")
	sample_collection = frappe.qb.DocType("Sample Collection")
	sample_collection_item = frappe.qb.DocType("Observation Sample Collection")
	diagnostic_report = frappe.qb.DocType("Diagnostic Report")
	patient = frappe.qb.DocType("Patient")

	rows = (
		frappe.qb.from_(service_request)
		.left_join(observation)
		.on(
			(service_request.name == observation.service_request)
			& (observation.docstatus == 1)
			& (observation.status == "Approved")
		)
		.left_join(observation_template)
		.on(service_request.template_dn == observation_template.name)
		.left_join(sample_collection_item)
		.on(service_request.name == sample_collection_item.service_request)
		.left_join(sample_collection)
		.on(sample_collection_item.parent == sample_collection.name)
		.left_join(diagnostic_report)
		.on(service_request.order_group == diagnostic_report.docname)
		.left_join(patient)
		.on(service_request.patient == patient.name)
		.select(
			service_request.name.as_("service_request"),
			service_request.order_group.as_("order_name"),
			service_request.patient,
			service_request.patient_name,
			service_request.practitioner.as_("ref_practitioner"),
			service_request.practitioner_name.as_("ref_practitioner_name"),
			service_request.order_date,
			service_request.billing_status,
			service_request.template_dn.as_("observation_template"),
		)
		.select(
			observation.name.as_("observation"),
			observation.result_data,
			observation.result_text,
			observation.result_select,
		)
		.select(
			observation_template.permitted_unit,
			observation_template.permitted_data_type,
			observation_template.sample_collection_required,
			observation_template.has_component,
		)
		.select(
			sample_collection_item.name.as_("observation_sample_collection"),
			sample_collection_item.parent.as_("sample_collection"),
			sample_collection_item.collection_date_time,
			sample_collection_item.component_observations.as_("component_observations"),
		)
		.select(
			sample_collection.status.as_("sample_collection_status"),
			sample_collection.collection_point,
		)
		.select(
			diagnostic_report.name.as_("diagnostic_report"),
			diagnostic_report.status.as_("diagnostic_report_status"),
		)
		.select(
			patient.sex.as_("gender"),
			patient.image.as_("patient_image"),
		)
		.where(service_request.patient.isin(patients))
		.where(service_request.status != "revoked-Request Status")
		.where(service_request.docstatus != 2)
		.where(service_request.template_dt == "Observation Template")
		.orderby(service_request.order_date, order=Order.desc)
	)

	return rows.run(as_dict=True)


def get_data_from_invoices(patients):
	diagnostic_report = frappe.qb.DocType("Diagnostic Report")
	si_item = frappe.qb.DocType("Sales Invoice Item")
	si = frappe.qb.DocType("Sales Invoice")
	observation = frappe.qb.DocType("Observation")
	observation_template = frappe.qb.DocType("Observation Template")
	sample_collection = frappe.qb.DocType("Sample Collection")
	sample_collection_item = frappe.qb.DocType("Observation Sample Collection")
	patient = frappe.qb.DocType("Patient")

	rows = (
		frappe.qb.from_(diagnostic_report)
		.left_join(si_item)
		.on((diagnostic_report.docname == si_item.parent) & (si_item.reference_dn.isnull()))
		.left_join(si)
		.on(si.name == si_item.parent)
		.left_join(observation_template)
		.on(si_item.item_code == observation_template.item)
		.left_join(sample_collection)
		.on(diagnostic_report.docname == sample_collection.reference_name)
		.left_join(sample_collection_item)
		.on(
			(sample_collection.name == sample_collection_item.parent)
			& (observation_template.name == sample_collection_item.observation_template)
		)
		.left_join(observation)
		.on(
			(
				(diagnostic_report.docname == observation.sales_invoice)
				| (sample_collection.name == observation.reference_docname)
			)
			& (observation.docstatus == 1)
			& (observation.status == "Approved")
			& (observation_template.name == observation.observation_template)
		)
		.left_join(patient)
		.on(diagnostic_report.patient == patient.name)
		.select(
			diagnostic_report.docname.as_("order_name"),
			diagnostic_report.patient,
			diagnostic_report.patient_name,
			diagnostic_report.practitioner.as_("ref_practitioner"),
			diagnostic_report.practitioner_name.as_("ref_practitioner_name"),
			diagnostic_report.reference_posting_date.as_("order_date"),
			diagnostic_report.name.as_("diagnostic_report"),
			diagnostic_report.status.as_("diagnostic_report_status"),
		)
		.select(
			si.status.as_("billing_status"),
		)
		.select(
			observation_template.name.as_("observation_template"),
			observation_template.permitted_unit,
			observation_template.permitted_data_type,
			observation_template.sample_collection_required,
			observation_template.has_component,
		)
		.select(
			observation.name.as_("observation"),
			observation.result_data,
			observation.result_text,
			observation.result_select,
		)
		.select(
			sample_collection_item.name.as_("observation_sample_collection"),
			sample_collection_item.parent.as_("sample_collection"),
			sample_collection_item.collection_date_time,
			sample_collection_item.component_observations.as_("component_observations"),
		)
		.select(
			sample_collection.status.as_("sample_collection_status"),
			sample_collection.collection_point,
		)
		.select(
			patient.sex.as_("gender"),
			patient.image.as_("patient_image"),
		)
		.where(diagnostic_report.patient.isin(patients))
		.where(observation_template.name.isnotnull())
		.where(si.docstatus == 1)
		.orderby(diagnostic_report.reference_posting_date, order=Order.desc)
		.orderby(si_item.idx, order=Order.asc)
	)

	return rows.run(as_dict=True)


def get_observation_result(obs_data):
	result = None
	template_doc = frappe.get_doc("Observation Template", obs_data.observation_template)
	if template_doc.permitted_data_type in ["Range", "Ratio", "Quantity", "Numeric"]:
		result = obs_data.result_data
	elif obs_data.permitted_data_type == "Text":
		result = obs_data.result_text
	elif obs_data.permitted_data_type == "Select":
		result = obs_data.result_select

	return result
