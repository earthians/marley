# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import get_datetime, getdate

from healthcare.healthcare.doctype.ot_booking.busy import INACTIVE_STATUSES, cleaning_of, slot

PUSHABLE_STATUSES = ("Tentative", "Scheduled")


def push_following(booking, reason=None):
	# the last case first, so no pushed case runs into the next one before that one moves
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
