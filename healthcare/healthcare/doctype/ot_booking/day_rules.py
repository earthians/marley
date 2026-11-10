# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Rules for a committed list. Adding a case never needs a reason, but on the day of surgery
only an emergency, or an OT Manager, can add one or move one in from another day. Once a case
is published (Scheduled), moving it, rescheduling it, cancelling it or returning it to
Tentative needs a reason; a Tentative case changes freely. The reason is for that one change:
once saved it goes to the timeline and the field is emptied for the next one.

The past is fixed: a case whose start has passed is not moved, only rescheduled (to the To
schedule pane), cancelled or moved on in status, and no case is placed at a time already gone.
A start up to one grid step (15 minutes) ago still counts as now, for a case dropped on the
current time."""

import frappe
from frappe import _
from frappe.utils import add_to_date, get_datetime, getdate, now_datetime, today

from healthcare.healthcare.doctype.ot_booking.busy import INACTIVE_STATUSES
from healthcare.healthcare.doctype.ot_booking.priority import is_emergency


def validate_day_rules(booking):
	"""A move onto the day of surgery is both an addition to that day and, for a published case,
	a change that needs its reason"""
	before = booking.get_doc_before_save()
	validate_not_in_the_past(booking, before)
	if is_added_to_surgery_day(booking, before):
		validate_same_day_addition(booking)
	if before and needs_change_reason(before) and is_published_change(booking, before):
		validate_reason_given(booking)


def validate_not_in_the_past(booking, before):
	"""Only a case that is placed, by being added, moved or restored, is checked"""
	if booking.status in INACTIVE_STATUSES:
		return
	restored = before and before.status in INACTIVE_STATUSES
	if before and not restored and not is_moved(booking, before):
		return
	if before and not restored and has_passed(before):
		frappe.throw(
			_("This case's time has passed, so it cannot be moved. Reschedule it instead."),
			title=_("Case Already Due"),
		)
	if has_passed(booking):
		frappe.throw(_("A case cannot be placed at a time that has passed"), title=_("Time Has Passed"))


def has_passed(booking):
	return get_datetime(booking.scheduled_start) < add_to_date(now_datetime(), minutes=-15)


def is_added_to_surgery_day(booking, before):
	"""A new case, one moved in from another day, or one restored from Postponed or Cancelled"""
	if not before or not is_surgery_day(before):
		return True
	return before.status in INACTIVE_STATUSES and booking.status not in INACTIVE_STATUSES


def is_published_change(booking, before):
	"""Moving, stopping or unpublishing (back to Tentative) a case changes the published list"""
	return is_stopped(booking, before) or is_moved(booking, before) or booking.status == "Tentative"


def needs_change_reason(booking):
	"""Whether moving or stopping the case needs a reason: only once its day's list is published,
	which a started case was"""
	return booking.status in ("Scheduled", "In Progress")


def validate_same_day_addition(booking):
	if not is_surgery_day(booking) or is_emergency(booking.priority):
		return
	if "OT Manager" not in frappe.get_roles():
		frappe.throw(
			_("Only an emergency case can be added on the day of surgery"), title=_("Day Already Planned")
		)


def is_moved(booking, before):
	return booking.theatre != before.theatre or get_datetime(booking.scheduled_start) != get_datetime(
		before.scheduled_start
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
