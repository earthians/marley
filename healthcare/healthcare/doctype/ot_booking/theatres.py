# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""The theatres a user works with: a company's operation theatres, optionally one department's,
in tree order and grouped by their OT complex; and the theatre day, from the Operation Theatre
settings. A theatre's company ignores user permissions, so the company itself is checked."""

from datetime import datetime

import frappe
from frappe import _
from frappe.utils import get_time

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import ot_setting


def get_theatres(company, department=None):
	"""Theatre name → theatre, in tree order: only those the user may read"""
	check_company_access(company)
	filters = theatre_filters(company)
	if department:
		filters["medical_department"] = department
	theatres = frappe.get_list(
		"Healthcare Service Unit",
		fields=[
			"name",
			"healthcare_service_unit_name as label",
			"parent_healthcare_service_unit as complex",
			"service_unit_type",
		],
		filters=filters,
		order_by="lft",
		limit=0,
	)
	return {theatre.name: theatre for theatre in theatres}


def theatre_departments(company):
	"""The departments the company's theatres belong to, for a Department filter"""
	check_company_access(company)
	return frappe.get_list(
		"Healthcare Service Unit",
		filters={**theatre_filters(company), "medical_department": ["is", "set"]},
		pluck="medical_department",
		distinct=True,
		order_by="medical_department",
		limit=0,
	)


def group_by_complex(theatres):
	complexes = {}
	for theatre in theatres.values():
		complexes.setdefault(theatre.complex, {"name": theatre.complex, "theatres": []})
		complexes[theatre.complex]["theatres"].append(theatre)
	return list(complexes.values())


def check_company_access(company):
	if company and company not in frappe.get_list("Company", pluck="name", limit=0):
		frappe.throw(
			_("You cannot see the theatres of {0}").format(frappe.bold(company)), frappe.PermissionError
		)


def theatre_filters(company):
	filters = {"is_ot": 1, "is_group": 0}
	if company:
		filters["company"] = company
	return filters


def day_window(date):
	"""The theatre day's usual working hours on `date`"""
	start, end = ot_setting("ot_day_start_time"), ot_setting("ot_day_end_time")
	return datetime.combine(date, get_time(start)), datetime.combine(date, get_time(end))
