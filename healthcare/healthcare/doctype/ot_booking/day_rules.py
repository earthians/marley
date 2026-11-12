# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, get_datetime, getdate, now_datetime, today

from healthcare.healthcare.doctype.ot_booking.busy import INACTIVE_STATUSES
from healthcare.healthcare.doctype.ot_booking.priority import is_emergency

# a case dropped on the current 15-minute grid step still starts "now", not in the past
NOW_GRACE_MINUTES = 15


def validate_day_rules(booking):
	before = booking.get_doc_before_save()
	validate_not_in_the_past(booking, before)
	if is_added_to_surgery_day(booking, before):
		validate_same_day_addition(booking)
	if before and needs_change_reason(before) and is_published_change(booking, before):
		validate_reason_given(booking)


def validate_not_in_the_past(booking, before):
	if booking.status in INACTIVE_STATUSES:
		return
	if before and before.status not in INACTIVE_STATUSES and has_passed(before):
		validate_passed_case_kept(booking, before)
	elif is_placed(booking, before) and has_passed(booking):
		frappe.throw(_("A case cannot be placed at a time that has passed"), title=_("Time Has Passed"))


def validate_passed_case_kept(booking, before):
	if cint(booking.cleaning_minutes) != cint(before.cleaning_minutes):
		frappe.throw(
			_("This case's time has passed, so its cleaning time cannot change"), title=_("Case Already Due")
		)
	if is_moved(booking, before):
		frappe.throw(
			_("This case's time has passed, so it cannot be moved or change length. Reschedule it instead."),
			title=_("Case Already Due"),
		)


def is_placed(booking, before):
	return not before or before.status in INACTIVE_STATUSES or is_moved(booking, before)


def has_passed(booking):
	start = get_datetime(booking.scheduled_start)
	return start < add_to_date(now_datetime(), minutes=-NOW_GRACE_MINUTES)


def is_added_to_surgery_day(booking, before):
	if not before or not is_surgery_day(before):
		return True
	return before.status in INACTIVE_STATUSES and booking.status not in INACTIVE_STATUSES


def is_published_change(booking, before):
	return is_stopped(booking, before) or is_moved(booking, before) or booking.status == "Tentative"


def needs_change_reason(booking):
	return booking.status in ("Scheduled", "In Progress")


def validate_same_day_addition(booking):
	if not is_surgery_day(booking) or is_emergency(booking.priority):
		return
	if "OT Manager" not in frappe.get_roles():
		frappe.throw(
			_("Only an emergency case can be added on the day of surgery"), title=_("Day Already Planned")
		)


def is_moved(booking, before):
	return booking.theatre != before.theatre or any(
		get_datetime(booking.get(field)) != get_datetime(before.get(field))
		for field in ("scheduled_start", "scheduled_end")
	)


def is_stopped(booking, before):
	return booking.status in INACTIVE_STATUSES and before.status not in INACTIVE_STATUSES


def validate_reason_given(booking):
	if not (booking.change_reason or "").strip():
		frappe.throw(_("Give a Change Reason for this change"), title=_("Reason Required"))


def log_change_reason(booking):
	if not booking.change_reason:
		return
	booking.add_comment("Info", _("Change reason: {0}").format(booking.change_reason))
	booking.db_set("change_reason", None, update_modified=False)


def is_surgery_day(booking):
	return getdate(booking.scheduled_start) == getdate(today())
