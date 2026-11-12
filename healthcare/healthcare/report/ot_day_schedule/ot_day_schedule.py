# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import get_datetime

from healthcare.healthcare.doctype.ot_booking.board import get_board


def execute(filters=None):
	filters = frappe._dict(filters or {})
	board = get_board(filters.date, filters.company, filters.department)
	return columns(filters), rows(board, filters)


def columns(filters):
	by_practitioner = filters.group_by == "Practitioner"
	group = _("Practitioner") if by_practitioner else _("Theatre")
	return [
		column(group, "group", 180),
		column(_("Time"), "time", 110),
		*([column(_("Theatre"), "theatre", 120), column(_("Role"), "role", 140)] if by_practitioner else []),
		column(_("Patient"), "patient", 200),
		column(_("Procedures"), "procedures", 240),
		column(_("Team"), "team", 240),
		column(_("Priority"), "priority", 90),
		column(_("Status"), "status", 100),
		{
			"label": _("OT Booking"),
			"fieldname": "ot_booking",
			"fieldtype": "Link",
			"options": "OT Booking",
			"width": 160,
		},
	]


def column(label, fieldname, width):
	return {"label": label, "fieldname": fieldname, "fieldtype": "Data", "width": width}


def rows(board, filters):
	theatres = {theatre.name: theatre for group in board["complexes"] for theatre in group["theatres"]}
	cases = [case for case in board["bookings"] if matches_filters(case, filters)]
	if filters.group_by == "Practitioner":
		return practitioner_rows(cases, theatres, filters)
	return theatre_rows(cases, theatres)


def theatre_rows(cases, theatres):
	order = {name: index for index, name in enumerate(theatres)}
	found = [case_row(case, theatres[case.theatre].label) for case in cases]
	return sorted(found, key=lambda row: (order.get(row["theatre_id"], 0), row["start"]))


def practitioner_rows(cases, theatres, filters):
	found = [
		practitioner_row(case, member, theatres) for case in cases for member in members_of(case, filters)
	]
	return sorted(found, key=lambda row: (row["group"], row["start"]))


def matches_filters(case, filters):
	if filters.practitioner and filters.practitioner not in case.team_ids:
		return False
	if filters.patient and case.patient != filters.patient:
		return False
	return not filters.theatre or case.theatre == filters.theatre


def members_of(case, filters):
	members = [
		{"practitioner": practitioner, **name_and_role}
		for practitioner, name_and_role in zip(case.team_ids, case.team_roles, strict=True)
	]
	return [member for member in members if filters.practitioner in (None, "", member["practitioner"])]


def case_row(case, theatre_label):
	start, end = get_datetime(case.scheduled_start), get_datetime(case.scheduled_end)
	return {
		"group": theatre_label,
		"theatre_id": case.theatre,
		"start": start,
		"time": f"{start:%H:%M}–{end:%H:%M}",
		"patient": " · ".join(
			part for part in (case.patient_name, case.get("age"), (case.get("sex") or "")[:1]) if part
		),
		"procedures": ", ".join(case.procedures),
		"team": ", ".join(case.team_names),
		"priority": case.priority_label,
		"status": _(case.status),
		"ot_booking": case.name,
	}


def practitioner_row(case, member, theatres):
	row = case_row(case, theatres[case.theatre].label)
	return {**row, "group": member["name"], "theatre": row["group"], "role": _(member["role"])}
