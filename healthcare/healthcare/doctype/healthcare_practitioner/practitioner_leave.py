# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import getdate


def find_leaves(practitioners, start_date, end_date, company=None):
	if "hrms" not in frappe.get_installed_apps():
		return []
	employees = linked_employees(practitioners)
	if not employees:
		return []
	leaves = frappe.get_all(
		"Leave Application",
		fields=["name", "employee", "half_day", "half_day_date"],
		filters=leave_filters(employees, start_date, end_date, company),
	)
	for leave in leaves:
		leave.practitioner = employees[leave.employee]
		leave.is_half_day = is_half_day_only(leave, start_date, end_date)
	return leaves


def leave_filters(employees, start_date, end_date, company):
	filters = {
		"employee": ["in", list(employees)],
		"status": "Approved",
		"docstatus": 1,
		"from_date": ["<=", getdate(end_date)],
		"to_date": [">=", getdate(start_date)],
	}
	if company:
		filters["company"] = company
	return filters


def is_half_day_only(leave, start_date, end_date):
	if not (leave.half_day and leave.half_day_date):
		return False
	return getdate(start_date) == getdate(end_date) == getdate(leave.half_day_date)


def leave_message(leave):
	who = frappe.bold(
		frappe.db.get_value("Healthcare Practitioner", leave.practitioner, "practitioner_name", cache=True)
		or leave.practitioner
	)
	if leave.is_half_day:
		return _("{0} is on half-day leave").format(who)
	return _("{0} is on leave").format(who)


def linked_employees(practitioners):
	rows = frappe.get_all(
		"Healthcare Practitioner",
		fields=["name", "employee"],
		filters={"name": ["in", practitioners], "employee": ["is", "set"]},
	)
	return {row.employee: row.name for row in rows}
