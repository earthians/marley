# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""A case's procedures as the case reads them, and the case following them: In Progress once
one starts, Completed once every row's is, never backwards. Clinical Procedure calls this, so it
never imports Clinical Procedure itself."""

import frappe

from healthcare.healthcare.doctype.ot_booking.busy import INACTIVE_STATUSES
from healthcare.healthcare.doctype.ot_booking.fasting import sync_fasting_task

STATUS_ORDER = ("Tentative", "Scheduled", "In Progress", "Completed")


def procedures_of(booking):
	"""Row name → its procedure, leaving out cancelled ones. An amendment keeps its booking and
	row, so it takes the cancelled one's place; a duplicate keeps neither."""
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


def follow_procedure(procedure):
	"""After a procedure starts or completes, its case moves forward to match, never back"""
	if not procedure.ot_booking:
		return
	booking = frappe.get_doc("OT Booking", procedure.ot_booking)
	status = status_from(booking)
	if status and booking.status not in INACTIVE_STATUSES and is_ahead(status, booking.status):
		booking.db_set("status", status)
		sync_fasting_task(booking)  # a case under way needs no fasting task any more
		booking.notify_update()


def status_from(booking):
	held = procedures_of(booking)
	statuses = [procedure.status for procedure in held.values()]
	if len(held) == len(booking.procedures) and statuses and all(s == "Completed" for s in statuses):
		return "Completed"
	if any(status in ("In Progress", "Completed") for status in statuses):
		return "In Progress"
	return None


def is_ahead(status, current):
	return STATUS_ORDER.index(status) > STATUS_ORDER.index(current)
