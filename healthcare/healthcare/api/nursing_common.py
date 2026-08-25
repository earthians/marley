# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

import erpnext

# An admission in any of these states still has the patient on a ward.
IN_HOSPITAL_STATUSES = ("Admitted", "Discharge Scheduled")


def has_value(value):
	return value is not None and str(value).strip() != ""


def default_company():
	company = frappe.defaults.get_user_default("Company") or erpnext.get_default_company()
	if company:
		return company

	companies = frappe.get_all("Company", pluck="name", limit=1)
	return companies[0] if companies else None


def admitted_patients():
	"""A patient pending discharge is still in a bed and still needs nursing care."""
	return frappe.get_all(
		"Inpatient Record",
		filters={"status": ["in", IN_HOSPITAL_STATUSES]},
		pluck="patient",
	)
