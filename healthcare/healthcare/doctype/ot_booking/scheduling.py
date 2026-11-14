# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import nowdate

from healthcare.healthcare.doctype.ot_booking.board import add_case_details, add_patient_details
from healthcare.healthcare.doctype.ot_booking.ot_booking import ACTIVE_REQUEST_STATUS, make_ot_booking
from healthcare.healthcare.doctype.ot_booking.priority import add_priority
from healthcare.healthcare.doctype.ot_booking.push import push_following
from healthcare.healthcare.doctype.ot_booking.refusal import refusal_text

MOVABLE_STATUSES = ("Tentative", "Scheduled", "Postponed")


@frappe.whitelist()
def get_open_requests(company: str | None = None, department: str | None = None) -> list:
	frappe.has_permission("OT Booking", "read", throw=True)
	templates = surgical_templates()
	if not templates:
		return []
	requests = frappe.get_list(
		"Service Request",
		fields=[
			"name",
			"patient",
			"patient_name",
			"practitioner_name",
			"template_dn as procedure",
			"medical_department",
			"priority",
			"order_date",
			"expected_date",
		],
		filters=company_filter(
			company,
			{
				"docstatus": 1,
				"status": ACTIVE_REQUEST_STATUS,
				"template_dt": "Clinical Procedure Template",
				"template_dn": ["in", list(templates)],
			},
		),
		order_by="order_date asc, order_time asc",
		limit=0,
	)
	waiting = unbooked_in_department(requests, templates, department)
	waiting.sort(key=lambda request: (not request.expected_date, request.expected_date or ""))
	for request in waiting:
		request.duration = templates[request.procedure].default_duration
		request.theatre_type = templates[request.procedure].required_theatre_type
	add_priority(waiting)
	if waiting:
		add_patient_details(waiting, nowdate())
	return waiting


@frappe.whitelist()
def get_postponed(company: str | None = None, department: str | None = None) -> list:
	frappe.has_permission("OT Booking", "read", throw=True)
	bookings = frappe.get_list(
		"OT Booking",
		fields=[
			"name",
			"patient",
			"patient_name",
			"status",
			"priority",
			"scheduled_start",
			"scheduled_end",
			"cleaning_minutes",
		],
		filters=company_filter(company, {"status": "Postponed"}),
		order_by="scheduled_start asc",
		limit=0,
	)
	if not bookings:
		return []
	add_case_details(bookings)
	add_theatre_types(bookings)
	add_expected_dates(bookings)
	add_patient_details(bookings, nowdate())
	if not department:
		return bookings
	departments = template_departments({name for booking in bookings for name in booking.procedures})
	return [
		booking
		for booking in bookings
		if department in {departments.get(name) for name in booking.procedures}
	]


@frappe.whitelist(methods=["POST"])
def book_request(service_request: str, theatre: str, start: str, reason: str | None = None) -> str:
	booking = make_ot_booking(service_request)
	booking.update({"theatre": theatre, "scheduled_start": start, "change_reason": reason})
	make_room(booking, reason)
	return booking.insert().name


@frappe.whitelist(methods=["POST"])
def move_booking(name: str, theatre: str, start: str, reason: str | None = None) -> str:
	booking = frappe.get_doc("OT Booking", name)
	booking.check_permission("write")
	if booking.status not in MOVABLE_STATUSES:
		frappe.throw(_("A {0} case cannot be moved").format(_(booking.status)), title=_("Not Movable"))
	booking.update({"theatre": theatre, "scheduled_start": start, "change_reason": reason})
	if booking.status == "Postponed":
		booking.status = "Tentative"
	make_room(booking, reason)
	return booking.save().name


@frappe.whitelist(methods=["POST"])
def set_status(name: str, status: str, reason: str | None = None) -> str:
	booking = frappe.get_doc("OT Booking", name)
	booking.check_permission("write")
	booking.update({"status": status, "change_reason": reason})
	return booking.save().name


@frappe.whitelist(methods=["POST"])
def create_procedures(name: str) -> list:
	return frappe.get_doc("OT Booking", name).create_clinical_procedures()


@frappe.whitelist(methods=["POST"])
def check_drop(method: str, params: str | dict) -> str | None:
	drops = {"book_request": book_request, "move_booking": move_booking, "set_status": set_status}
	params = frappe.parse_json(params)
	# any reason will do, so a dry run is not refused only for having none
	params["reason"] = params.get("reason") or _("Checking the drop")
	messages = len(frappe.local.message_log)
	frappe.db.savepoint("check_drop")
	try:
		drops[method](**params)
	except frappe.ValidationError as error:
		return refusal_text(error, messages)
	finally:
		frappe.db.rollback(save_point="check_drop")
	frappe.local.message_log = frappe.local.message_log[:messages]
	return None


def make_room(booking, reason):
	booking.set_schedule()
	if booking.is_new():
		return push_following(booking, reason)
	# the push reads the theatre's cases from the database, so the moving case is written there at
	# its new place for the push, then put back for its own save to check and write
	fields = ("theatre", "scheduled_start", "scheduled_end", "scheduled_date")
	leaving = frappe.db.get_value("OT Booking", booking.name, fields, as_dict=True)
	update = {field: booking.get(field) for field in fields}
	frappe.db.set_value("OT Booking", booking.name, update, update_modified=False)
	push_following(booking, reason)
	frappe.db.set_value("OT Booking", booking.name, leaving, update_modified=False)


def unbooked_in_department(requests, templates, department):
	booked = booked_requests([request.name for request in requests])
	return [
		request
		for request in requests
		if request.name not in booked
		and in_department(
			request.medical_department or templates[request.procedure].medical_department, department
		)
	]


def company_filter(company, filters):
	company = company or frappe.defaults.get_user_default("Company")
	return {**filters, "company": company} if company else filters


def surgical_templates():
	templates = frappe.get_all(
		"Clinical Procedure Template",
		fields=["name", "default_duration", "medical_department", "required_theatre_type"],
		filters={"requires_ot": 1},
	)
	return {template.name: template for template in templates}


def add_theatre_types(bookings):
	names = list({name for booking in bookings for name in booking.procedures})
	types = dict(
		frappe.get_all(
			"Clinical Procedure Template",
			fields=["name", "required_theatre_type"],
			filters={"name": ["in", names]},
			as_list=True,
		)
	)
	for booking in bookings:
		booking.theatre_type = ", ".join(sorted({types.get(name) for name in booking.procedures} - {None}))


def add_expected_dates(bookings):
	rows = frappe.get_all(
		"OT Booking Procedure",
		fields=["parent", "service_request"],
		filters={"parent": ["in", [booking.name for booking in bookings]], "service_request": ["is", "set"]},
	)
	expected = dict(
		frappe.get_all(
			"Service Request",
			fields=["name", "expected_date"],
			filters={
				"name": ["in", [row.service_request for row in rows] or [""]],
				"expected_date": ["is", "set"],
			},
			as_list=True,
		)
	)
	for booking in bookings:
		dates = [
			expected[row.service_request]
			for row in rows
			if row.parent == booking.name and row.service_request in expected
		]
		booking.expected_date = min(dates, default=None)


def template_departments(names):
	return dict(
		frappe.get_all(
			"Clinical Procedure Template",
			fields=["name", "medical_department"],
			filters={"name": ["in", list(names)]},
			as_list=True,
		)
	)


def in_department(own_department, department):
	return not department or own_department == department


def booked_requests(requests):
	if not requests:
		return set()
	rows = frappe.get_all(
		"OT Booking Procedure",
		fields=["service_request", "parent"],
		filters={"parenttype": "OT Booking", "service_request": ["in", requests]},
	)
	if not rows:
		return set()
	active = set(
		frappe.get_all(
			"OT Booking",
			filters={"name": ["in", [row.parent for row in rows]], "status": ["!=", "Cancelled"]},
			pluck="name",
		)
	)
	return {row.service_request for row in rows if row.parent in active}
