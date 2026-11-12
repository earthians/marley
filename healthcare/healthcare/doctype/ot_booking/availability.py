# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

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
FINISHED_APPOINTMENT_STATUSES = ("Closed", "Cancelled")


def validate_availability(booking):
	if booking.status in INACTIVE_STATUSES:
		return
	clashes = clash_messages(booking)
	if clashes:
		frappe.throw(clashes, title=_("Booking Conflict"), as_list=True)
	refusals, warnings = unavailable_messages(booking)
	if refusals and not is_emergency(booking.priority):
		frappe.throw(refusals, title=_("Not Available"), as_list=True)
	if refusals or warnings:
		frappe.msgprint(refusals + warnings, title=_("Not Available"), indicator="orange", as_list=True)


def unavailable_messages(booking):
	leaves = find_leaves(team_of(booking), *slot(booking))
	refusals = holiday_messages(booking) + blocked_messages(booking) + appointment_messages(booking)
	refusals += [leave_message(leave) for leave in leaves if not leave.is_half_day]
	warnings = [leave_message(leave) for leave in leaves if leave.is_half_day]
	return refusals, warnings


def clash_messages(booking):
	start, end = slot(booking)
	cleaning = cleaning_of(booking)
	# a day back, for earlier cases whose own cleaning time runs into this one
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
	return _("{0} is in theatre {1} from {2} to {3}, with {4}").format(
		frappe.bold(practitioner_name_in(case, practitioner)), case.theatre, *times(case), patient_shown(case)
	)


def practitioner_name_in(case, practitioner):
	names = [member.practitioner_name for member in case.team if member.practitioner == practitioner]
	return names[0] if names and names[0] else practitioner


def patient_shown(case):
	if frappe.has_permission("OT Booking", "read", case.name):
		return case.patient_name
	return _("another patient")


def most_at_once(cases, start, end):
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
	who = frappe.db.get_value("Healthcare Practitioner", block.scope, "practitioner_name", cache=True)
	message = _("{0} is unavailable from {1} to {2} on {3}").format(
		frappe.bold(who or block.scope),
		format_time(block.start_time),
		format_time(block.end_time),
		format_date(block.start_date),
	)
	return f"{message} ({_(block.reason)})" if block.reason else message


def appointment_messages(booking):
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
	for appointment in appointments:
		appointment.start, appointment.end = visit_times(appointment)
	return [
		appointment for appointment in appointments if appointment.start < end and start < appointment.end
	]


def visit_times(appointment):
	start = get_datetime(f"{appointment.appointment_date} {appointment.appointment_time or '00:00:00'}")
	return start, start + timedelta(minutes=flt(appointment.duration))


def appointment_message(appointment, booking):
	own = appointment.patient == booking.patient
	who = booking.patient_name if own else appointment.practitioner_name or appointment.practitioner
	return _("{0} has a clinic appointment from {1} to {2}").format(
		frappe.bold(who), format_datetime(appointment.start), format_datetime(appointment.end)
	)


def theatre_case_messages(practitioner, patient, start, end):
	messages = []
	for case in cases_between(start, end):
		if case.patient == patient:
			who = case.patient_name
		elif practitioner in team_of(case):
			who = practitioner_name_in(case, practitioner)
		else:
			continue
		messages.append(
			_("{0} is in theatre {1} from {2} to {3}").format(frappe.bold(who), case.theatre, *times(case))
		)
	return messages


def team_of(booking):
	return [member.practitioner for member in booking.team]


def times(case):
	return format_datetime(case.scheduled_start), format_datetime(case.scheduled_end)
