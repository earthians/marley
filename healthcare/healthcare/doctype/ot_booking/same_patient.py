# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import format_date, get_datetime

from healthcare.healthcare.doctype.ot_booking.busy import INACTIVE_STATUSES
from healthcare.healthcare.doctype.ot_booking.day_rules import is_placed


def other_cases(patient, day, name=None):
	return frappe.get_list(
		"OT Booking",
		fields=["name", "theatre", "scheduled_start", "scheduled_end"],
		filters={
			"patient": patient,
			"scheduled_date": day,
			"status": ["not in", INACTIVE_STATUSES],
			"name": ["!=", name or ""],
		},
		order_by="scheduled_start",
		limit=0,
	)


def warn_other_cases(booking):
	if booking.status in INACTIVE_STATUSES or not is_placed(booking, booking.get_doc_before_save()):
		return
	cases = other_cases(booking.patient, booking.scheduled_date, booking.name)
	if not cases:
		return
	times = ", ".join(case_text(case) for case in cases)
	frappe.msgprint(
		_("{0} already has a case on {1}: {2}").format(
			booking.patient_name, format_date(booking.scheduled_date), times
		),
		title=_("Patient Has Another Case"),
		indicator="orange",
	)


def add_other_cases(bookings):
	cases = frappe.get_list(
		"OT Booking",
		fields=["name", "patient", "theatre", "scheduled_date", "scheduled_start", "scheduled_end"],
		filters={
			"patient": ["in", list({booking.patient for booking in bookings})],
			"scheduled_date": ["in", list({booking.scheduled_date for booking in bookings})],
			"status": ["not in", INACTIVE_STATUSES],
		},
		order_by="scheduled_start",
		limit=0,
	)
	for booking in bookings:
		booking.other_cases = [
			case_text(case)
			for case in cases
			if (case.patient, case.scheduled_date) == (booking.patient, booking.scheduled_date)
			and case.name != booking.name
		]


def case_text(case):
	return f"{case.theatre} · {time_range(case)}"


def time_range(case):
	return f"{get_datetime(case.scheduled_start):%H:%M}–{get_datetime(case.scheduled_end):%H:%M}"
