# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Doctor Due Payment — commission on services billed in the period that are still
not paid for, across every Doctor Commission Payroll in the date range.

The print formats ``Doctor Due Payment`` (Doctor Commission Payroll) and
``Doctor Due Payment Payslip`` (Commission Payslip) use the same computation.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import getdate

from healthcare.api.doctor_commission_due import build_due_payment_payload


def execute(filters=None):
	filters = frappe._dict(filters or {})
	return get_columns(), get_data(filters)


def get_columns():
	return [
		{
			"label": _("Payroll"),
			"fieldname": "payroll",
			"fieldtype": "Link",
			"options": "Doctor Commission Payroll",
			"width": 150,
		},
		{
			"label": _("Branch"),
			"fieldname": "cost_center",
			"fieldtype": "Link",
			"options": "Cost Center",
			"width": 130,
		},
		{"label": _("Doctor ID"), "fieldname": "doctors_id", "fieldtype": "Data", "width": 110},
		{"label": _("Doctor Name"), "fieldname": "practitioner_name", "fieldtype": "Data", "width": 180},
		{
			"label": _("Practitioner"),
			"fieldname": "practitioner",
			"fieldtype": "Link",
			"options": "Healthcare Practitioner",
			"width": 140,
		},
		{
			"label": _("Employee"),
			"fieldname": "employee",
			"fieldtype": "Link",
			"options": "Employee",
			"width": 110,
		},
		{"label": _("Date"), "fieldname": "date", "fieldtype": "Date", "width": 100},
		{"label": _("Patient"), "fieldname": "patient_name", "fieldtype": "Data", "width": 200},
		{"label": _("File No"), "fieldname": "file_no", "fieldtype": "Data", "width": 100},
		{"label": _("Visit No."), "fieldname": "visit_no", "fieldtype": "Data", "width": 110},
		{"label": _("Cash/Online"), "fieldname": "cash_online", "fieldtype": "Currency", "precision": 3, "width": 110},
		{"label": _("Card"), "fieldname": "card", "fieldtype": "Currency", "precision": 3, "width": 100},
		{"label": _("Total"), "fieldname": "total", "fieldtype": "Currency", "precision": 3, "width": 100},
		{"label": _("Discount"), "fieldname": "discount", "fieldtype": "Currency", "precision": 3, "width": 100},
		{"label": _("Due"), "fieldname": "due", "fieldtype": "Currency", "precision": 3, "width": 110},
		{"label": _("Commission"), "fieldname": "commission", "fieldtype": "Currency", "precision": 3, "width": 110},
		{"label": _("Remarks"), "fieldname": "remarks", "fieldtype": "Data", "width": 160},
	]


def get_data(filters):
	rows = []
	for payroll_name in _get_payrolls(filters):
		payroll = frappe.get_doc("Doctor Commission Payroll", payroll_name)
		payload = build_due_payment_payload(payroll, filters.get("practitioner"))
		for block in payload["doctors"]:
			doctor = block["doctor"]
			for case in block["cases"]:
				if filters.get("cost_center") and (case.get("branch") or "") != filters.cost_center:
					continue
				rows.append(
					{
						"payroll": payroll.name,
						"cost_center": case.get("branch"),
						"doctors_id": doctor.get("doctors_id"),
						"practitioner_name": doctor.get("practitioner_name"),
						"practitioner": doctor.get("practitioner"),
						"employee": doctor.get("employee"),
						"date": case.get("date"),
						"patient_name": case.get("patient_name"),
						"file_no": case.get("file_no"),
						"visit_no": case.get("visit_no"),
						"cash_online": case.get("cash_online"),
						"card": case.get("card"),
						"total": case.get("total"),
						"discount": case.get("discount"),
						"due": case.get("due"),
						"commission": case.get("commission"),
						"remarks": "" if case.get("receipt_recorded") else _("No receipt recorded"),
					}
				)
	return rows


def _get_payrolls(filters) -> list[str]:
	"""Payrolls whose period overlaps the report date range."""
	conditions = {"docstatus": ["!=", 2]}
	if filters.get("company"):
		conditions["company"] = filters.company
	if filters.get("payroll"):
		conditions["name"] = filters.payroll

	payrolls = frappe.get_all(
		"Doctor Commission Payroll",
		filters=conditions,
		fields=["name", "from_date", "to_date"],
		order_by="from_date asc, name asc",
		limit_page_length=0,
	)

	from_date = getdate(filters.get("from_date")) if filters.get("from_date") else None
	to_date = getdate(filters.get("to_date")) if filters.get("to_date") else None
	names = []
	for payroll in payrolls:
		if from_date and payroll.to_date and getdate(payroll.to_date) < from_date:
			continue
		if to_date and payroll.from_date and getdate(payroll.from_date) > to_date:
			continue
		names.append(payroll.name)
	return names
