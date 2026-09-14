# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt
"""
Income by Doctor, Patient and Source — monthly or yearly columns like P&L.

Primary document is submitted Sales Order service lines (non-stock items).
Stock items (medicines) are excluded. When Paid Only is checked, keep orders
that are fully collected or whose linked invoices have no outstanding.
"""

from __future__ import annotations

from dateutil.relativedelta import relativedelta

import frappe
from frappe import _, scrub
from frappe.utils import cint, flt, get_first_day, get_last_day, getdate

from healthcare.api.doctor_commission import (
	get_enabled_commission_sources,
	resolve_practitioners_for_sources,
)

UNSET_SOURCE = "Not Set"
UNSET_PATIENT = "Not Set"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def execute(filters=None):
	filters = frappe._dict(filters or {})
	apply_period(filters)
	periods = get_periods(filters)

	columns = get_columns(filters, periods)
	data = get_data(filters, periods)
	chart = get_chart_data(data, periods)

	return columns, data, None, chart


def apply_period(filters):
	start, end = get_year_bounds(filters)
	filters.from_date = start
	filters.to_date = end
	filters.periodicity = (filters.get("periodicity") or "Monthly").strip() or "Monthly"


def get_year_bounds(filters):
	fy_name = filters.get("fiscal_year")
	if fy_name and frappe.db.exists("Fiscal Year", fy_name):
		start, end = frappe.db.get_value(
			"Fiscal Year", fy_name, ["year_start_date", "year_end_date"]
		)
		return getdate(start), getdate(end)

	year = cint(filters.get("year")) or getdate().year
	return getdate(f"{year}-01-01"), getdate(f"{year}-12-31")


def get_periods(filters):
	start = get_first_day(filters.from_date)
	end = get_last_day(filters.to_date)
	if filters.periodicity == "Yearly":
		label = filters.get("fiscal_year") or str(start.year)
		return [{"key": scrub(str(label)), "label": str(label), "start": start, "end": end}]

	cross_year = start.year != end.year
	periods = []
	cursor = start
	while cursor <= end:
		month_end = get_last_day(cursor)
		if month_end > end:
			month_end = end
		label = MONTHS[cursor.month - 1]
		if cross_year:
			label = f"{label} {cursor.year}"
		periods.append(
			{
				"key": f"m_{cursor.year}_{cursor.month}",
				"label": label,
				"start": cursor,
				"end": month_end,
			}
		)
		cursor = get_first_day(cursor + relativedelta(months=1))
	return periods


def get_columns(filters, periods):
	group_by = (filters.get("group_by") or "Doctor").strip()
	columns = []

	if group_by == "Patient":
		columns.extend(
			[
				{
					"label": _("Patient"),
					"fieldname": "patient",
					"fieldtype": "Link",
					"options": "Patient",
					"width": 130,
				},
				{
					"label": _("Patient Name"),
					"fieldname": "patient_name",
					"fieldtype": "Data",
					"width": 180,
				},
				{
					"label": _("Source"),
					"fieldname": "source",
					"fieldtype": "Link",
					"options": "Patient Source",
					"width": 140,
				},
			]
		)
	elif group_by == "Source":
		columns.append(
			{
				"label": _("Source"),
				"fieldname": "source",
				"fieldtype": "Link",
				"options": "Patient Source",
				"width": 180,
			}
		)
	else:
		columns.extend(
			[
				{
					"label": _("Practitioner"),
					"fieldname": "practitioner",
					"fieldtype": "Link",
					"options": "Healthcare Practitioner",
					"width": 180,
				},
				{
					"label": _("Doctor Name"),
					"fieldname": "doctor_name",
					"fieldtype": "Data",
					"width": 200,
				},
			]
		)

	columns.append({"label": _("Services"), "fieldname": "services", "fieldtype": "Int", "width": 90})
	for period in periods:
		columns.append(
			{
				"label": _(period["label"]),
				"fieldname": period["key"],
				"fieldtype": "Currency",
				"width": 110,
			}
		)
	columns.append({"label": _("Total"), "fieldname": "total", "fieldtype": "Currency", "width": 130})
	return columns


def get_data(filters, periods):
	service_lines = fetch_service_lines(filters)
	if not service_lines:
		return []

	fill_order_source_links(service_lines)
	practitioner_by_base = resolve_order_practitioners(service_lines)
	practitioner_ids = {p for p in practitioner_by_base.values() if p}
	practitioner_details = get_doctor_practitioners(practitioner_ids)
	filter_practitioner = filters.get("practitioner")
	group_by = (filters.get("group_by") or "Doctor").strip()
	period_by_ym = {(p["start"].year, p["start"].month): p["key"] for p in periods}
	yearly_key = periods[0]["key"] if filters.periodicity == "Yearly" else None
	buckets = {}

	for line in service_lines:
		txn_date = getdate(line.transaction_date)
		amount = flt(line.amount)
		if yearly_key:
			period_key = yearly_key
		else:
			period_key = period_by_ym.get((txn_date.year, txn_date.month))
		if not period_key:
			continue

		base_key = (line.custom_base_reference, line.custom_base_reference_name)
		practitioner = practitioner_by_base.get(base_key) or ""
		if not practitioner:
			continue
		if practitioner not in practitioner_details:
			continue
		if filter_practitioner and practitioner != filter_practitioner:
			continue

		details = practitioner_details.get(practitioner) or {}
		source = line.patient_source or ""
		row = _empty_group_row(group_by, line, practitioner, details, source, periods)
		key = row["_key"]
		if key not in buckets:
			buckets[key] = row

		bucket = buckets[key]
		order_name = line.sales_order or line.name
		if order_name not in bucket["_orders"]:
			bucket["_orders"].add(order_name)
			bucket["services"] += 1
		bucket[period_key] += amount
		bucket["total"] += amount

	rows = list(buckets.values())
	for row in rows:
		row.pop("_key", None)
		row.pop("_orders", None)
	return sorted(rows, key=lambda r: flt(r.get("total")), reverse=True)


def _empty_group_row(group_by, order, practitioner, details, source, periods):
	period_vals = {period["key"]: 0.0 for period in periods}
	if group_by == "Patient":
		patient = order.patient or UNSET_PATIENT
		return {
			"_key": patient,
			"patient": order.patient or None,
			"patient_name": order.patient_name or patient,
			"source": source or None,
			"services": 0,
			"_orders": set(),
			"total": 0.0,
			**period_vals,
		}
	if group_by == "Source":
		label = source or UNSET_SOURCE
		return {
			"_key": label,
			"source": source or None,
			"services": 0,
			"_orders": set(),
			"total": 0.0,
			**period_vals,
		}

	return {
		"_key": practitioner,
		"practitioner": practitioner,
		"doctor_name": details.get("practitioner_name") or practitioner,
		"services": 0,
		"_orders": set(),
		"total": 0.0,
		**period_vals,
	}


def _coalesce_link_fields(meta, fieldnames):
	parts = [f"NULLIF(so.{name}, '')" for name in fieldnames if meta.has_field(name)]
	if not parts:
		return "NULL"
	if len(parts) == 1:
		return parts[0]
	return "COALESCE(" + ", ".join(parts) + ")"


def fill_order_source_links(orders):
	"""Use the same Sales Order source fields as doctor commission (base, else reference)."""
	for order in orders:
		order.custom_base_reference = (order.get("custom_base_reference") or "").strip() or None
		order.custom_base_reference_name = (
			(order.get("custom_base_reference_name") or "").strip() or None
		)


def resolve_order_practitioners(orders):
	"""Same doctor lookup as commission: source DocType + configured practitioner field."""
	with_base = [
		row
		for row in orders
		if row.get("custom_base_reference") and row.get("custom_base_reference_name")
	]
	if not with_base:
		return {}

	sources = list(get_enabled_commission_sources() or [])
	known = {s.source_doctype for s in sources}
	for row in with_base:
		doctype = row.custom_base_reference
		if doctype and doctype not in known:
			sources.append(frappe._dict(source_doctype=doctype, practitioner_field=None))
			known.add(doctype)

	return resolve_practitioners_for_sources(with_base, sources)


def get_doctor_practitioners(practitioner_ids):
	"""Practitioners eligible for doctor income (same flag as commission when present)."""
	if not practitioner_ids:
		return {}
	meta = frappe.get_meta("Healthcare Practitioner")
	filters = {"name": ["in", list(practitioner_ids)]}
	# Prefer Receive Commission (same as Doctor Commission Payroll). Fall back to Doctor.
	if meta.has_field("receive_commision"):
		filters["receive_commision"] = 1
	elif meta.has_field("doctor"):
		filters["doctor"] = 1
	fields = ["name", "practitioner_name"]
	if meta.has_field("doctors_id"):
		fields.append("doctors_id")
	rows = frappe.get_all(
		"Healthcare Practitioner",
		filters=filters,
		fields=fields,
	)
	return {row.name: row for row in rows}


def fetch_service_lines(filters):
	so_meta = frappe.get_meta("Sales Order")
	conditions = [
		"so.docstatus = 1",
		"IFNULL(item.is_stock_item, 0) = 0",
	]
	values = {}

	conditions.append("so.transaction_date >= %(from_date)s")
	conditions.append("so.transaction_date <= %(to_date)s")
	values["from_date"] = getdate(filters.from_date)
	values["to_date"] = getdate(filters.to_date)

	if cint(filters.get("paid")):
		conditions.append(
			"""(
				IFNULL(so.advance_paid, 0) + 0.00001 >= IFNULL(so.grand_total, 0)
				OR (
					IFNULL(inv.invoice_count, 0) > 0
					AND IFNULL(inv.outstanding, 0) <= 0.00001
				)
			)"""
		)

	if filters.get("company") and so_meta.has_field("company"):
		conditions.append("so.company = %(company)s")
		values["company"] = filters.company
	if filters.get("cost_center") and so_meta.has_field("cost_center"):
		conditions.append("so.cost_center = %(cost_center)s")
		values["cost_center"] = filters.cost_center
	if filters.get("patient") and so_meta.has_field("patient"):
		conditions.append("so.patient = %(patient)s")
		values["patient"] = filters.patient
	if filters.get("source"):
		conditions.append("p.source = %(source)s")
		values["source"] = filters.source

	patient_name_expr = "p.patient_name"
	if so_meta.has_field("custom_patient_name") and so_meta.has_field("patient"):
		patient_name_expr = "IFNULL(so.custom_patient_name, p.patient_name)"
	elif so_meta.has_field("patient_name"):
		patient_name_expr = "IFNULL(so.patient_name, p.patient_name)"

	base_ref_select = _coalesce_link_fields(
		so_meta, ["custom_base_reference", "custom_reference_type"]
	)
	base_name_select = _coalesce_link_fields(
		so_meta, ["custom_base_reference_name", "custom_reference_name"]
	)
	patient_select = "so.patient" if so_meta.has_field("patient") else "NULL"

	return frappe.db.sql(
		f"""
		SELECT
			so.name AS sales_order,
			so.name,
			so.transaction_date,
			{patient_select} AS patient,
			{patient_name_expr} AS patient_name,
			soi.amount,
			{base_ref_select} AS custom_base_reference,
			{base_name_select} AS custom_base_reference_name,
			p.source AS patient_source
		FROM `tabSales Order` so
		INNER JOIN `tabSales Order Item` soi
			ON soi.parent = so.name AND soi.parenttype = 'Sales Order'
		INNER JOIN `tabItem` item ON item.name = soi.item_code
		LEFT JOIN `tabPatient` p ON p.name = so.patient
		LEFT JOIN (
			SELECT
				x.sales_order,
				COUNT(*) AS invoice_count,
				SUM(x.outstanding_amount) AS outstanding
			FROM (
				SELECT DISTINCT
					sii.sales_order,
					si.name,
					si.outstanding_amount
				FROM `tabSales Invoice Item` sii
				INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
				WHERE si.docstatus = 1
					AND IFNULL(sii.sales_order, '') != ''
			) x
			GROUP BY x.sales_order
		) inv ON inv.sales_order = so.name
		WHERE {" AND ".join(conditions)}
		ORDER BY so.transaction_date DESC, so.name DESC
		""",
		values,
		as_dict=True,
	)


def get_chart_data(data, periods):
	if not data or not periods:
		return None

	labels = [period["label"] for period in periods]
	values = [flt(sum(flt(row.get(period["key"])) for row in data)) for period in periods]
	return {
		"data": {
			"labels": labels,
			"datasets": [{"name": _("Income"), "values": values}],
		},
		"type": "bar",
		"fieldtype": "Currency",
	}
