# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import add_years, get_datetime, getdate, today

from healthcare.healthcare.doctype.ot_booking.busy import cleaning_of, slot
from healthcare.healthcare.doctype.ot_booking.publishing import day_cases, for_each_case, reschedule
from healthcare.healthcare.doctype.ot_booking.refusal import refusal_text
from healthcare.healthcare.doctype.ot_booking.same_patient import other_cases
from healthcare.healthcare.doctype.ot_booking.scheduling import (
	book_request,
	booked_requests,
	get_open_requests,
	get_unscheduled,
	move_booking,
)
from healthcare.healthcare.doctype.ot_booking.slots import case_to_place, day_candidates, matching_theatres

PRIORITY_RANK = {"STAT": 0, "ASAP": 1, "URGENT": 2}
ROUTINE_RANK = 3
MAX_TRIES = 20


@frappe.whitelist(methods=["POST"])
def plan_day(
	date: str,
	company: str | None = None,
	department: str | None = None,
	board_filters: str | dict | None = None,
) -> dict:
	day, company = checked_day(date, company)
	focus = focus_of(board_filters)
	frappe.db.savepoint("auto_schedule_plan")
	try:
		lifted = lift_tentative(wanted_tentative(day, company, department, focus))
		placed, not_placed = [], []
		for case in waiting_cases(day, company, department, lifted):
			row = plan_case(case, day, company, department, focus)
			if row:
				(placed if row.get("theatre") else not_placed).append(row)
		return {"placed": placed, "not_placed": not_placed, "lifted": lifted}
	finally:
		frappe.db.rollback(save_point="auto_schedule_plan")


@frappe.whitelist(methods=["POST"])
def book_day(
	date: str,
	company: str | None = None,
	department: str | None = None,
	placements: str | list | None = None,
	lifted: str | list | None = None,
) -> dict:
	day, company = checked_day(date, company)
	placements = frappe.parse_json(placements) or []
	if not placements:
		frappe.throw(_("Preview the day before booking it"), title=_("Nothing to Book"))
	still_tentative = set(day_cases(day, company, department, ["Tentative"]))
	lift_tentative([name for name in frappe.parse_json(lifted) or [] if name in still_tentative])
	placed, not_placed = [], []
	for placement in [frappe._dict(row) for row in placements]:
		refusal = book_placement(placement)
		(not_placed if refusal else placed).append({**placement, "reason": refusal})
	return {"placed": placed, "not_placed": not_placed}


def checked_day(date, company):
	frappe.has_permission("OT Booking", "write", throw=True)
	day = getdate(date)
	if day <= getdate(today()):
		frappe.throw(_("Only a day after today can be auto scheduled"), title=_("Day Not Open"))
	return day, company or frappe.defaults.get_user_default("Company")


def focus_of(board_filters):
	board_filters = frappe.parse_json(board_filters) or {}
	return frappe._dict(
		{key: str(board_filters.get(key) or "") for key in ("theatre", "practitioner", "patient")}
	)


def wanted_tentative(day, company, department, focus):
	names = day_cases(day, company, department, ["Tentative"])
	if not names:
		return []
	cases = frappe.get_all(
		"OT Booking", fields=["name", "patient", "theatre"], filters={"name": ["in", names]}
	)
	team = frappe.get_all(
		"OT Booking Team", fields=["parent", "practitioner"], filters={"parent": ["in", names]}
	)
	for case in cases:
		case.team = [member for member in team if member.parent == case.name]
	return [case.name for case in cases if is_wanted(case, focus) and focus.theatre in ("", case.theatre)]


def is_wanted(case, focus):
	if focus.patient and case.patient != focus.patient:
		return False
	return not focus.practitioner or focus.practitioner in {member.practitioner for member in case.team}


def lift_tentative(names):
	lifted, _failed = for_each_case(names, reschedule)
	return lifted


def waiting_cases(day, company, department, lifted):
	requests = [as_waiting(row, "request") for row in get_open_requests(company, department)]
	unscheduled = [as_waiting(row, "booking") for row in get_unscheduled(company, department)]
	due = [case for case in requests + unscheduled if case.name in lifted or is_due(case, day)]
	add_early_reasons(due, day)
	return sorted(due, key=order_of)


def order_of(case):
	return (case.rank, not case.infant, not case.fasting, str(case.expected_date or "9999-12-31"))


def add_early_reasons(cases, day):
	if not cases:
		return
	births = dict(
		frappe.get_all(
			"Patient",
			fields=["name", "dob"],
			filters={"name": ["in", {case.patient for case in cases}]},
			as_list=True,
		)
	)
	fasting = set(
		frappe.get_all(
			"Clinical Procedure Template",
			filters={
				"name": ["in", {name for case in cases for name in case.templates}],
				"requires_fasting": 1,
			},
			pluck="name",
		)
	)
	for case in cases:
		born = births.get(case.patient)
		case.infant = bool(born) and getdate(add_years(born, 1)) > day
		case.fasting = bool(fasting.intersection(case.templates))


def as_waiting(row, kind):
	templates = [row.procedure] if kind == "request" else row.procedures
	return frappe._dict(
		kind=kind,
		name=row.name,
		patient=row.patient,
		patient_name=row.patient_name,
		templates=templates,
		procedures=", ".join(templates),
		priority_label=row.priority_label,
		expected_date=row.expected_date,
		rank=PRIORITY_RANK.get((row.priority_label or "").upper(), ROUTINE_RANK),
	)


def is_due(case, day):
	return bool(case.expected_date) and getdate(case.expected_date) <= day


def plan_case(case, day, company, department, focus):
	request = case.name if case.kind == "request" else None
	to_place = case_to_place(request, None if request else case.name)
	theatres = [
		theatre
		for theatre in matching_theatres(to_place, company, department)
		if focus.theatre in ("", theatre.name)
	]
	if not is_wanted(to_place, focus) or (focus.theatre and not theatres):
		return None
	return place_case(case, day, company, to_place, theatres)


def place_case(case, day, company, to_place, theatres):
	reason = _("No free time in a theatre it can use that day")
	for candidate in candidates_for(case, day, company, to_place, theatres)[:MAX_TRIES]:
		refusal = try_placing(case, candidate["theatre"], candidate["start"])
		if not refusal:
			return placement(case, candidate)
		reason = refusal
	return {**placement(case), "reason": reason}


def candidates_for(case, day, company, to_place, theatres):
	candidates = day_candidates(to_place, company, theatres, day)
	after_own = own_case_ends(case.patient, day)
	return sorted(
		candidates, key=lambda found: ((found["theatre"], found["start"]) not in after_own, found["start"])
	)


def own_case_ends(patient, day):
	return {(case.theatre, slot(case)[1] + cleaning_of(case)) for case in other_cases(patient, day)}


def try_placing(case, theatre, start):
	messages = len(frappe.local.message_log)
	frappe.db.savepoint("auto_schedule_case")
	try:
		if case.kind == "request":
			book_request(case.name, theatre, str(start))
		else:
			move_booking(case.name, theatre, str(start))
	except frappe.ValidationError as error:
		frappe.db.rollback(save_point="auto_schedule_case")
		return refusal_text(error, messages)
	frappe.db.release_savepoint("auto_schedule_case")
	del frappe.local.message_log[messages:]
	return None


def book_placement(placement):
	if not still_waiting(placement):
		return _("It is no longer waiting to be scheduled")
	return try_placing(placement, placement.theatre, get_datetime(placement.scheduled_start))


def still_waiting(placement):
	if placement.kind == "booking":
		return frappe.db.get_value("OT Booking", placement.name, "status") == "Unscheduled"
	return placement.name not in booked_requests([placement.name])


def placement(case, candidate=None):
	row = {key: case[key] for key in ("kind", "name", "patient_name", "procedures", "priority_label")}
	if candidate:
		row.update(
			theatre=candidate["theatre"],
			theatre_label=candidate["theatre_label"],
			scheduled_start=str(candidate["start"]),
			scheduled_end=str(candidate["end"]),
		)
	return row
