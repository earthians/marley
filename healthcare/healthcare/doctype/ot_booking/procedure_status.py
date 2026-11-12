# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, get_datetime, get_time, getdate

from healthcare.healthcare.doctype.ot_booking.busy import INACTIVE_STATUSES
from healthcare.healthcare.doctype.ot_booking.fasting import sync_fasting_task

STATUS_ORDER = ("Tentative", "Scheduled", "In Progress", "Completed")


def procedures_of(booking):
	procedures = frappe.get_all(
		"Clinical Procedure",
		fields=[
			"name",
			"ot_booking_row",
			"docstatus",
			"status",
			"procedure_template",
			"service_request",
			"service_unit",
			"start_date",
			"start_time",
			"planned_end_datetime",
			"practitioner",
		],
		filters={"ot_booking": booking.name, "ot_booking_row": ["is", "set"], "docstatus": ["<", 2]},
	)
	return {procedure.ot_booking_row: procedure for procedure in procedures}


def validate_against_booking(procedure):
	if not (procedure.ot_booking and procedure.ot_booking_row):
		return
	booking = frappe.get_doc("OT Booking", procedure.ot_booking)
	row = next((row for row in booking.procedures if row.name == procedure.ot_booking_row), None)
	validate_same_work(procedure, booking, row)
	keep_booked_place(procedure, booking, row)


def validate_same_work(procedure, booking, row):
	if not row:
		refuse_change(booking, _("Its procedure is no longer on OT Booking {0}"))
	if procedure.patient != booking.patient or procedure.procedure_template != row.procedure_template:
		refuse_change(booking, _("Its patient and procedure come from OT Booking {0}, so they cannot change"))


def keep_booked_place(procedure, booking, row):
	planned = row_schedule(booking, row.name)
	if in_place(procedure, planned):
		return
	if procedure.is_new():
		return procedure.update(planned)
	refuse_change(booking, _("Its theatre, times and surgeon come from OT Booking {0}, so change them there"))


def refuse_change(booking, message):
	frappe.throw(message.format(frappe.bold(booking.name)), title=_("Booked Procedure"))


def row_schedule(booking, row_name):
	for row, start in rows_with_start(booking):
		if row.name == row_name:
			return schedule(booking, row, start)


def schedule(booking, row, start):
	surgeon = primary_surgeon(booking)
	return {
		"service_unit": booking.theatre,
		"warehouse": theatre_warehouse(booking),
		"start_date": getdate(start),
		"start_time": get_time(start),
		"planned_end_datetime": add_to_date(start, seconds=cint(row.duration)),
		"practitioner": surgeon,
		"practitioner_name": surgeon
		and frappe.db.get_value("Healthcare Practitioner", surgeon, "practitioner_name", cache=True),
	}


def theatre_warehouse(booking):
	return frappe.db.get_value("Healthcare Service Unit", booking.theatre, "warehouse") or (
		frappe.db.get_value("Company", booking.company, "default_warehouse")
	)


def in_place(procedure, planned):
	return place_of(procedure) == place_of(frappe._dict(planned))


def place_of(procedure):
	start = get_datetime(f"{procedure.start_date} {procedure.start_time}")
	end = get_datetime(procedure.planned_end_datetime)
	return procedure.service_unit or None, start, end, procedure.practitioner or None


def rows_with_start(booking):
	start = get_datetime(booking.scheduled_start)
	for row in booking.procedures:
		yield row, start
		start = add_to_date(start, seconds=cint(row.duration))


def primary_surgeon(booking):
	return next((member.practitioner for member in booking.team if member.is_primary), None)


def follow_procedure(procedure):
	if not procedure.ot_booking:
		return
	booking = frappe.get_doc("OT Booking", procedure.ot_booking)
	status = status_from(booking)
	if status and booking.status not in INACTIVE_STATUSES and is_ahead(status, booking.status):
		booking.db_set("status", status)
		sync_fasting_task(booking)
		booking.notify_update()


def status_from(booking):
	statuses = [procedure.status for procedure in procedures_of(booking).values()]
	every_row_has_one = len(statuses) == len(booking.procedures)
	if statuses and every_row_has_one and all(status == "Completed" for status in statuses):
		return "Completed"
	if any(status in ("In Progress", "Completed") for status in statuses):
		return "In Progress"
	return None


def is_ahead(status, current):
	return STATUS_ORDER.index(status) > STATUS_ORDER.index(current)
