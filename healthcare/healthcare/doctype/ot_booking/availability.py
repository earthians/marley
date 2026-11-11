# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Whether a case's time is free. A clash with another case is always refused: the theatre, with
its cleaning time after each case; a team member in another theatre, where one allowed to
overlap theatres may be in two at once, never three; or the patient. A theatre holiday, an
Unavailable block of the theatre or a team member, and a team member's leave refuse an elective
case and are only warned about for an emergency, as is a clinic appointment of the patient or a
team member. A half-day leave is only warned about. The other way round, a clinic appointment
cannot fall during its practitioner's or patient's case."""

from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import flt, format_date, format_datetime, format_time, get_datetime, getdate

from erpnext.setup.doctype.holiday_list.holiday_list import is_holiday

from healthcare.healthcare.doctype.healthcare_practitioner.practitioner_leave import (
	find_leaves,
	leave_message,
)
from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import ot_setting
from healthcare.healthcare.doctype.ot_booking.busy import (
	INACTIVE_STATUSES,
	cases_between,
	cleaning_of,
	overlaps,
	slot,
	theatre_clash,
)
from healthcare.healthcare.doctype.ot_booking.priority import is_emergency
from healthcare.healthcare.doctype.practitioner_availability.practitioner_availability import (
	find_unavailable_blocks,
)

MAX_OVERLAPPING_THEATRES = 2
# appointments that no longer hold their time, as Patient Appointment's own overlap check counts them
FINISHED_APPOINTMENT_STATUSES = ("Closed", "Cancelled")


def validate_availability(booking):
	if booking.status in INACTIVE_STATUSES:
		return
	clashes = clash_messages(booking)
	if clashes:
		frappe.throw(clashes, title=_("Booking Conflict"), as_list=True)
	leaves = find_leaves(team_of(booking), *slot(booking))
	refusals = holiday_messages(booking) + blocked_messages(booking) + appointment_messages(booking)
	refusals += [leave_message(leave) for leave in leaves if not leave.is_half_day]
	warnings = [leave_message(leave) for leave in leaves if leave.is_half_day]
	if is_emergency(booking.priority):
		warnings = refusals + warnings
	elif refusals:
		frappe.throw(refusals, title=_("Not Available"), as_list=True)
	if warnings:
		frappe.msgprint(warnings, title=_("Not Available"), indicator="orange", as_list=True)


def clash_messages(booking):
	"""The theatre's cases too close for each one's cleaning time, and the team's and the patient's
	cases at the same time. A case is shorter than a day, so a day back finds every earlier one."""
	start, end = slot(booking)
	cleaning = cleaning_of(booking)
	cases = cases_between(start - timedelta(days=1), end + cleaning, exclude=booking.name)
	running = [case for case in cases if overlaps(case, start, end)]
	return (
		theatre_clashes(booking, cases, start, end, cleaning)
		+ team_clashes(booking, running, start, end)
		+ patient_clashes(booking, running)
	)


def theatre_clashes(booking, cases, start, end, cleaning):
	message = _(
		"Theatre {0} is booked from {1} to {2} for {3}, and each case needs its minutes of cleaning after it"
	)
	return [
		message.format(frappe.bold(booking.theatre), *times(case), patient_shown(case))
		for case in cases
		if case.theatre == booking.theatre and theatre_clash(case, start, end, cleaning)
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
		frappe.bold(name or practitioner), case.theatre, *times(case), patient_shown(case)
	)


def patient_shown(case):
	"""Every case counts in the clash checks, but only one the user may read is named"""
	if frappe.has_permission("OT Booking", "read", case.name):
		return case.patient_name
	return _("another patient")


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


def appointment_messages(booking):
	"""The clinic appointments of the case's patient and team during the case"""
	start, end = slot(booking)
	return [
		appointment_message(appointment, booking)
		for appointment in appointments_between(team_of(booking), booking.patient, start, end)
	]


def appointments_between(practitioners, patient, start, end):
	appointments = frappe.get_all(
		"Patient Appointment",
		fields=[
			"patient",
			"practitioner",
			"practitioner_name",
			"appointment_date",
			"appointment_time",
			"duration",
		],
		filters={
			"status": ["not in", FINISHED_APPOINTMENT_STATUSES],
			"appointment_date": ["between", [getdate(start), getdate(end)]],
		},
		or_filters=[["practitioner", "in", practitioners], ["patient", "=", patient]],
	)
	return [appointment for appointment in appointments if visit_overlaps(appointment, start, end)]


def visit_overlaps(appointment, start, end):
	visit_start = get_datetime(f"{appointment.appointment_date} {appointment.appointment_time or '00:00:00'}")
	appointment.start, appointment.end = (
		visit_start,
		visit_start + timedelta(minutes=flt(appointment.duration)),
	)
	return appointment.start < end and start < appointment.end


def appointment_message(appointment, booking):
	"""Named by the case's patient, or else by the practitioner, never by another patient"""
	own = appointment.patient == booking.patient
	who = booking.patient_name if own else appointment.practitioner_name or appointment.practitioner
	return _("{0} has a clinic appointment from {1} to {2}").format(
		frappe.bold(who), format_datetime(appointment.start), format_datetime(appointment.end)
	)


def theatre_case_messages(practitioner, patient, start, end):
	"""For a clinic appointment: the theatre cases of its practitioner or patient at the same time,
	named by the appointment's own patient or practitioner, never by another patient"""
	messages = []
	for case in cases_between(start, end):
		member = next((member for member in case.team if member.practitioner == practitioner), None)
		if case.patient != patient and not member:
			continue
		who = case.patient_name if case.patient == patient else member.practitioner_name or practitioner
		messages.append(
			_("{0} is in theatre {1} from {2} to {3}").format(frappe.bold(who), case.theatre, *times(case))
		)
	return messages


def team_of(booking):
	return [member.practitioner for member in booking.team]


def times(case):
	return format_datetime(case.scheduled_start), format_datetime(case.scheduled_end)
