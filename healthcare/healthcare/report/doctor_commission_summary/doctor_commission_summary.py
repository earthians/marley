# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt, getdate


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = get_columns()
	data = get_data(filters)
	return columns, data


def get_columns():
	return [
		{
			"label": _("Doctor ID"),
			"fieldname": "doctor_id",
			"fieldtype": "Data",
			"width": 110,
		},
		{
			"label": _("Doctor Name"),
			"fieldname": "doctor_name",
			"fieldtype": "Data",
			"width": 200,
		},
		{
			"label": _("Practitioner"),
			"fieldname": "practitioner",
			"fieldtype": "Link",
			"options": "Healthcare Practitioner",
			"width": 150,
		},
		{
			"label": _("Employee"),
			"fieldname": "employee",
			"fieldtype": "Link",
			"options": "Employee",
			"width": 120,
		},
		{
			"label": _("Branch"),
			"fieldname": "cost_center",
			"fieldtype": "Link",
			"options": "Cost Center",
			"width": 130,
		},
		{
			"label": _("Cases"),
			"fieldname": "cases_count",
			"fieldtype": "Int",
			"width": 80,
		},
		{
			"label": _("Service Amount"),
			"fieldname": "service_amount",
			"fieldtype": "Currency",
			"precision": 3,
			"width": 140,
		},
		{
			"label": _("Net Paid Amount"),
			"fieldname": "net_service_amount",
			"fieldtype": "Currency",
			"precision": 3,
			"width": 150,
		},
		{
			"label": _("Calculated Commission"),
			"fieldname": "calculated_commission",
			"fieldtype": "Currency",
			"precision": 3,
			"width": 160,
		},
		{
			"label": _("Deduction"),
			"fieldname": "deduction_amount",
			"fieldtype": "Currency",
			"precision": 3,
			"width": 120,
		},
		{
			"label": _("Adjusted Commission"),
			"fieldname": "adjusted_commission",
			"fieldtype": "Currency",
			"precision": 3,
			"width": 160,
		},
		{
			"label": _("Payroll"),
			"fieldname": "payroll",
			"fieldtype": "Link",
			"options": "Doctor Commission Payroll",
			"width": 140,
		},
		{
			"label": _("Status"),
			"fieldname": "status",
			"fieldtype": "Data",
			"width": 100,
		},
		{
			"label": _("Additional Salary"),
			"fieldname": "additional_salary",
			"fieldtype": "Link",
			"options": "Additional Salary",
			"width": 140,
		},
	]


def get_data(filters):
	"""Aggregate doctor commission from Doctor Commission Payroll records."""
	conditions = []
	values = {}

	# Filter by payroll date range
	if filters.get("from_date"):
		conditions.append("parent.from_date >= %(from_date)s")
		values["from_date"] = getdate(filters.from_date)
	if filters.get("to_date"):
		conditions.append("parent.to_date <= %(to_date)s")
		values["to_date"] = getdate(filters.to_date)
	
	if filters.get("company"):
		conditions.append("parent.company = %(company)s")
		values["company"] = filters.company
	
	if filters.get("cost_center"):
		conditions.append("doctor.cost_center = %(cost_center)s")
		values["cost_center"] = filters.cost_center
	
	if filters.get("practitioner"):
		conditions.append("doctor.practitioner = %(practitioner)s")
		values["practitioner"] = filters.practitioner
	
	if filters.get("status"):
		conditions.append("parent.status = %(status)s")
		values["status"] = filters.status

	where_clause = " AND ".join(conditions) if conditions else "1=1"
	# Payment-mode charges and the net paid amount were added later, so keep the
	# report working on sites that have not migrated the new columns yet.
	has_net_paid = frappe.get_meta("Doctor Commission Payroll Doctor").has_field("net_service_amount")
	net_service_expr = (
		"SUM(doctor.net_service_amount) as net_service_amount,"
		if has_net_paid
		else "0 as net_service_amount,"
	)
	deduction_expr = (
		"SUM(doctor.deduction_amount) as deduction_amount,"
		if frappe.get_meta("Doctor Commission Payroll Doctor").has_field("deduction_amount")
		else "0 as deduction_amount,"
	)

	data = frappe.db.sql(
		f"""
		SELECT
			doctor.practitioner,
			doctor.practitioner_name as doctor_name,
			doctor.doctors_id as doctor_id,
			doctor.employee,
			doctor.cost_center,
			SUM(doctor.cases_count) as cases_count,
			SUM(doctor.service_amount) as service_amount,
			{net_service_expr}
			SUM(doctor.calculated_commission) as calculated_commission,
			{deduction_expr}
			SUM(
				CASE 
					WHEN doctor.adjusted_commission IS NOT NULL AND doctor.adjusted_commission != 0
					THEN doctor.adjusted_commission
					ELSE doctor.calculated_commission
				END
			) as adjusted_commission,
			GROUP_CONCAT(DISTINCT parent.name ORDER BY parent.name SEPARATOR ', ') as payroll,
			GROUP_CONCAT(DISTINCT parent.status ORDER BY parent.status SEPARATOR ', ') as status,
			GROUP_CONCAT(DISTINCT doctor.additional_salary ORDER BY doctor.additional_salary SEPARATOR ', ') as additional_salary
		FROM `tabDoctor Commission Payroll Doctor` doctor
		INNER JOIN `tabDoctor Commission Payroll` parent
			ON parent.name = doctor.parent
		WHERE {where_clause}
		GROUP BY doctor.practitioner, doctor.cost_center
		ORDER BY adjusted_commission DESC
		""",
		values,
		as_dict=True,
	)

	return data
