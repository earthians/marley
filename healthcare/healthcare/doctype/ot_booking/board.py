# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

from datetime import datetime, time

from dateutil.relativedelta import relativedelta

import frappe
from frappe.utils import add_days, cint, getdate

from healthcare.healthcare.doctype.healthcare_practitioner.practitioner_leave import find_leaves
from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import ot_setting
from healthcare.healthcare.doctype.ot_booking.availability import theatre_holiday_list
from healthcare.healthcare.doctype.ot_booking.busy import INACTIVE_STATUSES
from healthcare.healthcare.doctype.ot_booking.day_rules import needs_change_reason
from healthcare.healthcare.doctype.ot_booking.fasting import is_fasting_confirmed
from healthcare.healthcare.doctype.ot_booking.ot_booking import STATUS_CHANGES
from healthcare.healthcare.doctype.ot_booking.priority import add_priority
from healthcare.healthcare.doctype.ot_booking.same_patient import add_other_cases
from healthcare.healthcare.doctype.ot_booking.theatres import (
	day_window,
	get_theatres,
	group_by_complex,
	theatre_departments,
)
from healthcare.healthcare.doctype.practitioner_availability.practitioner_availability import (
	find_unavailable_blocks,
)


@frappe.whitelist()
def get_board(date: str, company: str | None = None, department: str | None = None) -> dict:
	frappe.has_permission("OT Booking", "read", throw=True)
	date = getdate(date)
	company = company or frappe.defaults.get_user_default("Company")
	start, end = day_window(date)
	theatres = get_theatres(company, department)
	return {
		"date": date,
		"company": company,
		"department": department or "",
		"can_edit": bool(frappe.has_permission("OT Booking", "write")),
		"companies": frappe.get_list("Company", pluck="name", order_by="name", limit=0),
		"departments": theatre_departments(company),
		"day_start": start,
		"day_end": end,
		"cleaning_minutes": cint(ot_setting("ot_cleaning_minutes")),
		"holiday": get_holiday(company, date),
		"complexes": group_by_complex(theatres),
		"bookings": get_bookings(date, list(theatres)),
		"blocks": find_unavailable_blocks(list(theatres), start, end) if theatres else [],
		"away": get_away(date, start, end, company),
	}


def get_holiday(company, date):
	holiday_list = theatre_holiday_list(company)
	if not holiday_list:
		return None
	return frappe.db.get_value(
		"Holiday",
		{"parent": holiday_list, "holiday_date": date},
		["description", "is_half_day"],
		as_dict=True,
	)


def get_bookings(date, theatres):
	if not theatres:
		return []
	bookings = frappe.get_list(
		"OT Booking",
		fields=[
			"name",
			"theatre",
			"patient",
			"patient_name",
			"status",
			"priority",
			"scheduled_date",
			"scheduled_start",
			"scheduled_end",
			"cleaning_minutes",
		],
		filters={
			"scheduled_date": ["between", [add_days(date, -1), date]],
			"scheduled_end": [">", datetime.combine(date, time.min)],
			"status": ["not in", INACTIVE_STATUSES],
			"theatre": ["in", theatres],
		},
		order_by="scheduled_start",
		limit=0,
	)
	if bookings:
		add_case_details(bookings)
		add_patient_details(bookings, date)
		add_other_cases(bookings)
	return bookings


def add_case_details(bookings):
	names = [booking.name for booking in bookings]
	team = child_rows("OT Booking Team", names, ["practitioner", "practitioner_name", "role", "is_primary"])
	rows = child_rows("OT Booking Procedure", names, ["procedure_template"])
	made = frappe.get_all(
		"Clinical Procedure",
		fields=["ot_booking", "docstatus"],
		filters={"ot_booking": ["in", names], "ot_booking_row": ["is", "set"], "docstatus": ["<", 2]},
	)
	add_priority(bookings)
	for booking in bookings:
		members = [member for member in team if member.parent == booking.name]
		procedures = [procedure for procedure in made if procedure.ot_booking == booking.name]
		booking.procedures = [row.procedure_template for row in rows if row.parent == booking.name]
		add_team(booking, members)
		booking.procedures_pending = booking.status != "Completed" and len(procedures) < len(
			booking.procedures
		)
		booking.next_statuses = next_statuses(booking, procedures)
		booking.needs_reason = needs_change_reason(booking)
		booking.fasting_confirmed = is_fasting_confirmed(booking, booking.procedures)


def add_team(booking, members):
	booking.surgeon = next((member.practitioner_name for member in members if member.is_primary), None)
	booking.team_names = [member.practitioner_name for member in members]
	booking.team_ids = [member.practitioner for member in members]
	booking.team_roles = [{"name": member.practitioner_name, "role": member.role} for member in members]


def child_rows(doctype, parents, fields):
	return frappe.get_all(
		doctype,
		fields=["parent", *fields],
		filters={"parent": ["in", parents], "parenttype": "OT Booking"},
		order_by="idx",
	)


def next_statuses(booking, procedures):
	statuses = STATUS_CHANGES.get(booking.status, ())
	if any(procedure.docstatus == 1 for procedure in procedures):
		statuses = tuple(status for status in statuses if status != "Cancelled")
	return statuses


def add_patient_details(rows, on_date):
	patients = {}
	if frappe.has_permission("Patient", "read"):
		patients = {
			patient.name: patient
			for patient in frappe.get_list(
				"Patient",
				fields=["name", "sex", "dob", "inpatient_status", "inpatient_record"],
				filters={"name": ["in", list({row.patient for row in rows})]},
				limit=0,
			)
		}
	beds = current_beds([patient.inpatient_record for patient in patients.values()])
	for row in rows:
		patient = patients.get(row.patient, frappe._dict())
		row.sex = patient.sex
		row.age = age_text(patient.dob, on_date)
		row.inpatient_status = patient.inpatient_status or None
		row.bed = beds.get(patient.inpatient_record)


def current_beds(inpatient_records):
	records = [record for record in inpatient_records if record]
	if not records:
		return {}
	occupancies = frappe.get_all(
		"Inpatient Occupancy",
		fields=["parent", "service_unit"],
		filters={"parent": ["in", records], "parenttype": "Inpatient Record", "left": 0},
	)
	return {occupancy.parent: occupancy.service_unit for occupancy in occupancies}


def age_text(dob, on_date):
	if not dob:
		return None
	age = relativedelta(getdate(on_date), getdate(dob))
	return f"{age.years}y" if age.years else f"{age.months}m"


def get_away(date, start, end, company):
	if not frappe.has_permission("Healthcare Practitioner", "read"):
		return []
	practitioners = dict(
		frappe.get_list(
			"Healthcare Practitioner",
			fields=["name", "practitioner_name"],
			filters={"status": "Active"},
			as_list=True,
			limit=0,
		)
	)
	if not practitioners:
		return []
	away = [
		away_row(practitioners, block.scope, "Unavailable", block.start_time, block.end_time)
		for block in find_unavailable_blocks(list(practitioners), start, end)
	]
	away += [
		away_row(practitioners, leave.practitioner, "Half-day Leave" if leave.is_half_day else "Leave")
		for leave in find_leaves(list(practitioners), date, date, company)
	]
	return away


def away_row(practitioners, practitioner, reason, from_time=None, to_time=None):
	return {
		"practitioner": practitioner,
		"practitioner_name": practitioners[practitioner],
		"reason": reason,
		"from_time": from_time,
		"to_time": to_time,
	}
