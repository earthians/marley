# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

from datetime import datetime, timedelta

import frappe
from frappe.utils import add_days, get_datetime, get_time, getdate, now_datetime, today

from erpnext.setup.doctype.holiday_list.holiday_list import is_holiday

from healthcare.healthcare.doctype.healthcare_practitioner.practitioner_leave import find_leaves
from healthcare.healthcare.doctype.ot_booking.availability import allowed_to_overlap, theatre_holiday_list
from healthcare.healthcare.doctype.ot_booking.busy import cases_between, cleaning_of, slot
from healthcare.healthcare.doctype.ot_booking.ot_booking import make_ot_booking
from healthcare.healthcare.doctype.ot_booking.priority import is_emergency
from healthcare.healthcare.doctype.ot_booking.procedure_status import primary_surgeon
from healthcare.healthcare.doctype.ot_booking.scheduling import check_drop
from healthcare.healthcare.doctype.ot_booking.theatres import day_window, get_theatres
from healthcare.healthcare.doctype.practitioner_availability.practitioner_availability import (
	find_unavailable_blocks,
)

GRID = timedelta(minutes=15)
MAX_CHECKS = 40


@frappe.whitelist()
def find_slots(
	service_request: str | None = None,
	booking: str | None = None,
	company: str | None = None,
	department: str | None = None,
	days: int = 7,
	limit: int = 5,
) -> list:
	frappe.has_permission("OT Booking", "write", throw=True)
	case = case_to_place(service_request, booking)
	company = company or case.company or frappe.defaults.get_user_default("Company")
	theatres = matching_theatres(case, company, department)
	candidates = []
	for day in coming_days(case, int(days)):
		candidates += day_candidates(case, company, theatres, day)
	candidates.sort(key=lambda candidate: (candidate["after_expected"], candidate["start"]))
	return confirmed(case, service_request, candidates, int(limit))


def case_to_place(service_request, booking):
	if service_request:
		case = make_ot_booking(service_request)
		case.expected_date = frappe.db.get_value("Service Request", service_request, "expected_date")
	else:
		case = frappe.get_doc("OT Booking", booking)
		case.check_permission("write")
		case.expected_date = None
	case.length = timedelta(seconds=sum(int(row.duration or 0) for row in case.procedures))
	case.surgeon = primary_surgeon(case)
	case.theatre_types = {
		frappe.db.get_value("Clinical Procedure Template", row.procedure_template, "required_theatre_type")
		for row in case.procedures
	} - {None}
	return case


def matching_theatres(case, company, department):
	if len(case.theatre_types) > 1:
		return []
	theatres = get_theatres(company, department).values()
	return [
		theatre
		for theatre in theatres
		if not case.theatre_types or theatre.service_unit_type in case.theatre_types
	]


def coming_days(case, days):
	first = getdate(today()) if is_emergency(case.priority) else add_days(getdate(today()), 1)
	return [add_days(first, offset) for offset in range(days)]


def day_candidates(case, company, theatres, day):
	if not theatres or not case.length or skipped_day(case, company, day):
		return []
	start, end = day_window(day)
	if day == getdate(today()):
		start = max(start, rounded_up(now_datetime()))
	cleaning = cleaning_of(case)
	cases = cases_between(start - timedelta(days=1), end + cleaning, exclude=case.name)
	people_busy, may_overlap_ends = people_times(case, cases, start, end)
	candidates = []
	for theatre in theatres:
		busy = theatre_times(theatre.name, cases, cleaning, start, end) + people_busy
		for gap in free_starts(start, end, case.length, cleaning, busy, also=may_overlap_ends):
			candidates.append(candidate(case, theatre, gap))
	return candidates


def skipped_day(case, company, day):
	if is_holiday(theatre_holiday_list(company), day):
		return True
	leaves = find_leaves([case.surgeon], day, day) if case.surgeon else []
	return any(not leave.is_half_day for leave in leaves)


def theatre_times(theatre, cases, cleaning, start, end):
	# each case keeps the new case's cleaning before it and its own cleaning after it
	ours = [other for other in cases if other.theatre == theatre]
	busy = [(slot(other)[0] - cleaning, slot(other)[1] + cleaning_of(other)) for other in ours]
	return busy + block_times([theatre], start, end)


def people_times(case, cases, start, end):
	team = {member.practitioner for member in case.team if member.practitioner}
	may_overlap = allowed_to_overlap(list(team)) if team else set()
	# a member allowed in two theatres at once is not busy, but the end of their case is a start
	# worth trying; the dry run still refuses a third theatre
	busy, ends = block_times(list(team), start, end), []
	for other in cases:
		theirs = {member.practitioner for member in other.team} & team
		if other.patient == case.patient or theirs - may_overlap:
			busy.append(slot(other))
		elif theirs:
			ends.append(slot(other)[1])
	return busy, ends


def block_times(scopes, start, end):
	if not scopes:
		return []
	day = getdate(start)
	return [
		(datetime.combine(day, get_time(block.start_time)), datetime.combine(day, get_time(block.end_time)))
		for block in find_unavailable_blocks(scopes, start, end)
	]


def free_starts(start, end, length, cleaning, busy, also=()):
	return [
		moment
		for moment in candidate_starts(start, busy, also)
		if moment + length + cleaning <= end and is_free(moment, length, busy)
	]


def candidate_starts(start, busy, also):
	moments = [busy_end for _busy_start, busy_end in busy] + list(also)
	return sorted({start, *(max(rounded_up(moment), start) for moment in moments)})


def is_free(moment, length, busy):
	return not any(moment < busy_end and busy_start < moment + length for busy_start, busy_end in busy)


def rounded_up(moment):
	moment = get_datetime(moment).replace(second=0, microsecond=0)
	extra = timedelta(minutes=moment.minute % (GRID.seconds // 60))
	return moment + (GRID - extra if extra else timedelta(0))


def candidate(case, theatre, start):
	return {
		"theatre": theatre.name,
		"theatre_label": theatre.label,
		"date": getdate(start),
		"start": start,
		"end": start + case.length,
		"after_expected": bool(case.expected_date) and getdate(start) > getdate(case.expected_date),
	}


def confirmed(case, service_request, candidates, limit):
	# each gap is tried as the real drop in a dry run, so a slot offered is never refused
	slots, taken, checks = [], set(), 0
	for found in candidates:
		if len(slots) == limit or checks == MAX_CHECKS:
			break
		if (found["theatre"], found["date"]) in taken:
			continue
		checks += 1
		if not check_drop(*drop_for(case, service_request, found)):
			slots.append(found)
			taken.add((found["theatre"], found["date"]))
	return slots


def drop_for(case, service_request, found):
	place = {"theatre": found["theatre"], "start": str(found["start"])}
	if service_request:
		return "book_request", {"service_request": service_request, **place}
	return "move_booking", {"name": case.name, **place}
