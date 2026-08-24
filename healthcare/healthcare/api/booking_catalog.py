# Copyright (c) 2026, Abu Zahra Physical Therapy Center and contributors
# For license information, please see license.txt

import frappe
from frappe.rate_limiter import rate_limit


def _as_options(rows, label_field):
	options = []
	for row in rows:
		label = row.get(label_field) or row.name
		options.append({"id": row.name, "label": label})
	return options


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=60, seconds=60)
def get_conditions():
	rows = frappe.get_all(
		"Complaint",
		fields=["name", "complaints"],
		order_by="complaints asc",
		limit_page_length=0,
		ignore_permissions=True,
	)
	return _as_options(rows, "complaints")


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=60, seconds=60)
def get_services():
	rows = frappe.get_all(
		"Therapy Type",
		filters={"disabled": 0},
		fields=["name", "therapy_type"],
		order_by="therapy_type asc",
		limit_page_length=0,
		ignore_permissions=True,
	)
	return _as_options(rows, "therapy_type")


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=60, seconds=60)
def get_branches():
	rows = frappe.get_all(
		"Healthcare Service Unit",
		fields=["name", "healthcare_service_unit_name", "parent_healthcare_service_unit"],
		order_by="healthcare_service_unit_name asc",
		limit_page_length=0,
		ignore_permissions=True,
	)
	# Exclude only the company root ("All Healthcare Service Units").
	bookable = [row for row in rows if row.parent_healthcare_service_unit]
	return _as_options(bookable, "healthcare_service_unit_name")
