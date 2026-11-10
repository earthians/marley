# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Making room on the board. A case dropped among others pushes the cases after it in the same
theatre back, just enough to keep the cleaning time between them, in their order. A gap that
already holds the case ends the push. A Scheduled case is pushed too, with the drop's reason;
a case under way cannot be pushed."""

import frappe
from frappe import _
from frappe.utils import get_datetime, getdate

from healthcare.healthcare.doctype.ot_booking.busy import INACTIVE_STATUSES, cleaning_of, slot

PUSHABLE_STATUSES = ("Tentative", "Scheduled")


def push_following(booking, reason=None):
	"""Moves the cases after `booking` back, the last one first, so none meets another on the way"""
	for case, start in reversed(planned_pushes(booking)):
		pushed = frappe.get_doc("OT Booking", case.name)
		pushed.check_permission("write")
		if pushed.status not in PUSHABLE_STATUSES:
			frappe.throw(
				_("{0}'s case is {1}, so it cannot be pushed back to make room").format(
					frappe.bold(pushed.patient_name), _(pushed.status)
				),
				title=_("No Room"),
			)
		pushed.update(
			{"scheduled_start": start, "change_reason": reason if pushed.status == "Scheduled" else None}
		)
		pushed.save()


def planned_pushes(booking):
	"""(case, new start) for each case after `booking` in its theatre that must move to make room,
	each after the one before it and that one's own cleaning time"""
	start, end = slot(booking)
	cleaning = cleaning_of(booking)
	pushes = []
	for case in later_cases(booking, start):
		case_start = get_datetime(case.scheduled_start)
		new_start = max(case_start, end + cleaning)
		if new_start == case_start:
			break
		pushes.append((case, new_start))
		end = new_start + (get_datetime(case.scheduled_end) - case_start)
		cleaning = cleaning_of(case)
	return pushes


def later_cases(booking, start):
	return frappe.get_all(
		"OT Booking",
		fields=["name", "scheduled_start", "scheduled_end", "cleaning_minutes"],
		filters={
			"theatre": booking.theatre,
			"scheduled_date": getdate(start),
			"status": ["not in", INACTIVE_STATUSES],
			"name": ["!=", booking.name or ""],
			"scheduled_start": [">=", start],
		},
		order_by="scheduled_start asc",
	)
