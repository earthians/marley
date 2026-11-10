# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""What keeps a theatre, a practitioner or a patient busy: the active cases around a time, each
with its team. A Cancelled or Postponed case takes no time. A theatre also needs its cleaning
time after every case. The save-time checks (availability.py) and the slot finder read the
same cases, so the two always agree."""

from datetime import timedelta

import frappe
from frappe.utils import add_days, cint, get_datetime, getdate

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import ot_setting

INACTIVE_STATUSES = ("Cancelled", "Postponed")


def cases_between(start, end, exclude=None):
	"""The active cases running at any moment from `start` to `end`, other than `exclude`. A case
	is shorter than a day, so looking from the day before finds those running past midnight."""
	cases = frappe.get_all(
		"OT Booking",
		fields=["name", "patient", "patient_name", "theatre", "scheduled_start", "scheduled_end"],
		filters={
			"name": ["!=", exclude or ""],
			"status": ["not in", INACTIVE_STATUSES],
			"scheduled_date": ["between", [add_days(getdate(start), -1), getdate(end)]],
			"scheduled_start": ["<", end],
			"scheduled_end": [">", start],
		},
		order_by="scheduled_start",
	)
	add_teams(cases)
	return cases


def add_teams(cases):
	"""Each case's `team`: its practitioners, with their names"""
	if not cases:
		return
	members = frappe.get_all(
		"OT Booking Team",
		fields=["parent", "practitioner", "practitioner_name"],
		filters={"parenttype": "OT Booking", "parent": ["in", [case.name for case in cases]]},
	)
	for case in cases:
		case.team = [member for member in members if member.parent == case.name]


def slot(case):
	return get_datetime(case.scheduled_start), get_datetime(case.scheduled_end)


def overlaps(case, start, end):
	case_start, case_end = slot(case)
	return case_start < end and start < case_end


def cleaning_time():
	return timedelta(minutes=cint(ot_setting("ot_cleaning_minutes")))
