from datetime import datetime

import frappe
from frappe.query_builder import Order
from frappe.utils import get_datetime, get_time, getdate

import erpnext

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
		filters={"department": department},
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
def secure_print_pdf(doctype: str, name: str, no_letterhead: int = 0):
	"""
	Return PDF of a document using its default print format,
	bypassing doctype permissions.
	"""

	allowed_doctypes = ["Sales Invoice", "Patient Encounter", "Diagnostic Report"]
	if doctype not in allowed_doctypes:
		frappe.throw("Not allowed to print this document.", frappe.PermissionError)

	# Fetch default print format
	meta = frappe.get_meta(doctype)
	print_format = meta.default_print_format or "Standard"
	frappe.flags.ignore_permissions = True
	pdf = None
	try:
		pdf = frappe.get_print(
			doctype, name, print_format=print_format, no_letterhead=int(no_letterhead), as_pdf=True
		)
	finally:
		frappe.flags.ignore_permissions = False

	if pdf:
		frappe.local.response.filename = f"{name}.pdf"
		frappe.local.response.filecontent = pdf
		frappe.local.response.type = "binary"
		frappe.local.response.headers = [
			("Content-Type", "application/pdf"),
			("Content-Disposition", f'inline; filename="{name}.pdf"'),
		]


def get_patients_with_relations():
	filters = {"status": "Active"}
	if frappe.session.user != "Administrator":
		filters["user_id"] = frappe.session.user

	patients = frappe.db.get_all("Patient", filters=filters, pluck="name")
	relation = frappe.db.get_all(
		"Patient Relation", filters={"parent": ["in", patients]}, pluck="patient"
	)

	return patients + relation
