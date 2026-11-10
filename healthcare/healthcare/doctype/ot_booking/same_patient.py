# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""A patient with more than one case on a day. It is allowed, as long as the cases do not
overlap (availability.py refuses that), but it is worth knowing: placing such a case warns, and
the board marks it."""

import frappe
from frappe import _
from frappe.utils import format_date, get_datetime

from healthcare.healthcare.doctype.ot_booking.busy import INACTIVE_STATUSES
from healthcare.healthcare.doctype.ot_booking.day_rules import is_moved


def other_cases(patient, day, name=None):
	"""The patient's other active cases of the day that the user may read, earliest first"""
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
	"""Once the case is placed on a day (added, moved or restored) where the patient has another"""
	if booking.status in INACTIVE_STATUSES or not is_placed(booking):
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


def is_placed(booking):
	"""New, moved, or restored from Postponed or Cancelled"""
	before = booking.get_doc_before_save()
	return not before or before.status in INACTIVE_STATUSES or is_moved(booking, before)


def add_other_cases(bookings):
	"""Each case's `other_cases`: the patient's other cases of its day, in any theatre, as text;
	only those the user may read, as a case the user may not read shows nothing of itself"""
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
