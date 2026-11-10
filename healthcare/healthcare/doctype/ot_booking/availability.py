# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Whether a case's time is free. A clash with another case is always refused: the theatre, with
its cleaning time after each case; a team member in another theatre, where one allowed to
overlap theatres may be in two at once, never three; or the patient. A theatre holiday, an
Unavailable block of the theatre or a team member, and a team member's leave refuse an elective
case and are only warned about for an emergency. A half-day leave is only warned about."""

import frappe
from frappe import _
from frappe.utils import format_date, format_datetime, format_time

from erpnext.setup.doctype.holiday_list.holiday_list import is_holiday

from healthcare.healthcare.doctype.healthcare_practitioner.practitioner_leave import (
	find_leaves,
	leave_message,
)
from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import ot_setting
from healthcare.healthcare.doctype.ot_booking.busy import (
	INACTIVE_STATUSES,
	cases_between,
	cleaning_time,
	overlaps,
	slot,
)
from healthcare.healthcare.doctype.ot_booking.priority import is_emergency
from healthcare.healthcare.doctype.practitioner_availability.practitioner_availability import (
	find_unavailable_blocks,
)

MAX_OVERLAPPING_THEATRES = 2


def validate_availability(booking):
	if booking.status in INACTIVE_STATUSES:
		return
	clashes = clash_messages(booking)
	if clashes:
		frappe.throw(clashes, title=_("Booking Conflict"), as_list=True)
	leaves = find_leaves(team_of(booking), *slot(booking))
	refusals = holiday_messages(booking) + blocked_messages(booking)
	refusals += [leave_message(leave) for leave in leaves if not leave.is_half_day]
	warnings = [leave_message(leave) for leave in leaves if leave.is_half_day]
	if is_emergency(booking.priority):
		warnings = refusals + warnings
	elif refusals:
		frappe.throw(refusals, title=_("Not Available"), as_list=True)
	if warnings:
		frappe.msgprint(warnings, title=_("Not Available"), indicator="orange", as_list=True)


def clash_messages(booking):
	"""The theatre's cases within the cleaning time either side, and the team's and the patient's
	cases at the same time"""
	start, end = slot(booking)
	cleaning = cleaning_time()
	cases = cases_between(start - cleaning, end + cleaning, exclude=booking.name)
	running = [case for case in cases if overlaps(case, start, end)]
	return (
		theatre_clashes(booking, cases, cleaning)
		+ team_clashes(booking, running, start, end)
		+ patient_clashes(booking, running)
	)


def theatre_clashes(booking, cases, cleaning):
	message = _(
		"Theatre {0} is booked from {1} to {2} for {3}, and needs {4} minutes of cleaning after each case"
	)
	return [
		message.format(frappe.bold(booking.theatre), *times(case), case.patient_name, cleaning.seconds // 60)
		for case in cases
		if case.theatre == booking.theatre
	]


def team_clashes(booking, running, start, end):
	practitioners = team_of(booking)
	may_overlap = allowed_to_overlap(practitioners)
	messages = []
	for practitioner in practitioners:
		theirs = [case for case in running if practitioner in team_of(case)]
		if practitioner in may_overlap and most_at_once(theirs, start, end) < MAX_OVERLAPPING_THEATRES:
			continue
		messages += [team_clash(practitioner, case) for case in theirs]
	return messages


def team_clash(practitioner, case):
	name = next(member.practitioner_name for member in case.team if member.practitioner == practitioner)
	return _("{0} is in theatre {1} from {2} to {3}, with {4}").format(
		frappe.bold(name or practitioner), case.theatre, *times(case), case.patient_name
	)


def most_at_once(cases, start, end):
	"""The most of `cases` running at one moment within `start` to `end`; one ending as another
	starts is not an overlap"""
	moments = sorted(
		(moment, step)
		for case in cases
		for moment, step in ((max(slot(case)[0], start), 1), (min(slot(case)[1], end), -1))
	)
	running = most = 0
	for _moment, step in moments:
		running += step
		most = max(most, running)
	return most


def patient_clashes(booking, running):
	return [
		_("Patient {0} already has a booking from {1} to {2} in {3}").format(
			frappe.bold(booking.patient_name or booking.patient), *times(case), case.theatre
		)
		for case in running
		if case.patient == booking.patient
	]


def allowed_to_overlap(practitioners):
	filters = {"name": ["in", practitioners], "allow_overlapping_theatres": 1}
	return set(frappe.get_all("Healthcare Practitioner", filters=filters, pluck="name"))


def holiday_messages(booking):
	"""A half-day holiday can still be booked; only a full one closes the theatres"""
	if not is_holiday(theatre_holiday_list(booking.company), booking.scheduled_date):
		return []
	return [_("{0} is a theatre holiday").format(frappe.bold(format_date(booking.scheduled_date)))]


def theatre_holiday_list(company):
	return ot_setting("ot_holiday_list") or frappe.get_cached_value(
		"Company", company, "default_holiday_list"
	)


def blocked_messages(booking):
	scopes = [*team_of(booking), booking.theatre]
	return [blocked_message(block) for block in find_unavailable_blocks(scopes, *slot(booking))]


def blocked_message(block):
	"""Who is away, by name, and why if the block says"""
	who = frappe.db.get_value("Healthcare Practitioner", block.scope, "practitioner_name", cache=True)
	message = _("{0} is unavailable from {1} to {2} on {3}").format(
		frappe.bold(who or block.scope),
		format_time(block.start_time),
		format_time(block.end_time),
		format_date(block.start_date),
	)
	return f"{message} ({_(block.reason)})" if block.reason else message


def team_of(booking):
	return [member.practitioner for member in booking.team]


def times(case):
	return format_datetime(case.scheduled_start), format_datetime(case.scheduled_end)
