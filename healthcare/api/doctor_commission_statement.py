# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Doctor commission statement — the doctor-facing sheet (view and print).

Lays out one row per visit::

	Sl.No | Date | Patient Name | File No | Visit No. | Cash/Online | Card | Due |
	Discount | Total | Amount | Comments

followed by the grand totals, the "Commission for <doctor> (excluding due amount)"
line, the payment-mode deduction notes and the signature row — the same shape as
the manual branch commission sheets.

Commission per case comes from the payroll/payslip service lines (already computed
on the net paid amount — the collection less the rule's payment-mode charge, e.g.
the card fee). The Cash/Online — Card
split, the due amount and the RV numbers come from the receipts recorded against
the visit: Payment Entries allocated to its Sales Orders / Sales Invoices plus
payments tagged with the visit's Case No, reusing the reception report helpers.
"""

from __future__ import annotations

from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate

from healthcare.api.reception_reports import (
	_case_tagged_payments,
	_merge_payment_entries,
	_payments_by_mode,
)
from healthcare.api.doctor_commission import MONEY_PRECISION

CASH_ONLINE_COLUMN = "Cash / Online"
CARD_COLUMN = "Card"

PAYMENT_ENTRY_FIELDS = [
	"name",
	"posting_date",
	"mode_of_payment",
	"paid_amount",
	"reference_no",
	"reference_date",
	"owner",
	"creation",
]


def classify_payment_mode(mode_of_payment: str | None) -> str:
	"""Statement column for a Mode of Payment.

	Card machines (e.g. Credit Card, Credit Card Machine - AFS) sit in the Card
	column and attract the mode's deduction; everything else (cash, bank transfer,
	Benefit Pay, cheque) is collected without deduction and sits in Cash / Online.
	"""
	name = (mode_of_payment or "").strip().lower()
	if not name:
		return CASH_ONLINE_COLUMN
	if "card" in name or "credit" in name:
		return CARD_COLUMN
	return CASH_ONLINE_COLUMN


def _invoice_case_shares(invoice_names, sales_orders) -> dict[str, float]:
	"""Case share of each Sales Invoice (its item amount / invoice total).

	Branch invoices are often raised for many visits at once, so only the case's
	proportion of a receipt allocated to that invoice belongs to the case.
	"""
	invoice_names = [name for name in (invoice_names or []) if name]
	if not invoice_names:
		return {}
	totals = {
		row.name: flt(row.grand_total)
		for row in frappe.get_all(
			"Sales Invoice",
			filters={"name": ["in", invoice_names]},
			fields=["name", "grand_total"],
			limit_page_length=0,
		)
	}
	case_amounts: dict[str, float] = defaultdict(float)
	for item in frappe.get_all(
		"Sales Invoice Item",
		filters={"parent": ["in", invoice_names], "sales_order": ["in", list(sales_orders or [])]},
		fields=["parent", "amount"],
		limit_page_length=0,
	):
		case_amounts[item.parent] += flt(item.amount)

	shares: dict[str, float] = {}
	for name, amount in case_amounts.items():
		total = totals.get(name) or 0.0
		shares[name] = min(amount / total, 1.0) if total else 1.0
	return shares


def _case_collections(sales_orders, visit, from_date, to_date, cache):
	"""Submitted receipts against a visit, limited to the given Sales Orders.

	Mirrors ``reception_reports._visit_payments`` but scoped to the Sales Orders
	that carry the commissionable service lines (so pharmacy/lab bills on the same
	visit do not distort the consultation collection columns) and pro-rated when a
	receipt is allocated to a branch invoice covering several visits.
	"""
	cache_key = (visit or "", tuple(sorted({s for s in (sales_orders or []) if s})))
	if cache_key in cache:
		return cache[cache_key]

	sos = [s for s in (sales_orders or []) if s]
	allocated = []
	if sos:
		invoice_names = frappe.get_all(
			"Sales Invoice Item",
			filters={"sales_order": ["in", sos]},
			pluck="parent",
			limit_page_length=0,
		)
		invoice_names = sorted({name for name in invoice_names if name})
		invoice_shares = _invoice_case_shares(invoice_names, sos)
		ref_names = sorted({*sos, *invoice_names})
		references = frappe.get_all(
			"Payment Entry Reference",
			filters={"reference_name": ["in", ref_names]},
			fields=["parent", "reference_doctype", "reference_name", "allocated_amount"],
			limit_page_length=0,
		)
		allocated_by_entry: dict[str, float] = defaultdict(float)
		for reference in references:
			if not reference.parent:
				continue
			amount = flt(reference.allocated_amount)
			if reference.reference_doctype == "Sales Invoice":
				share = invoice_shares.get(reference.reference_name)
				amount = amount * share if share is not None else amount
			allocated_by_entry[reference.parent] += amount

		pe_names = sorted(allocated_by_entry)
		if pe_names:
			filters = {"name": ["in", pe_names], "docstatus": 1, "payment_type": "Receive"}
			if from_date and to_date:
				filters["posting_date"] = ["between", [from_date, to_date]]
			for entry in frappe.get_all(
				"Payment Entry",
				filters=filters,
				fields=PAYMENT_ENTRY_FIELDS,
				order_by="posting_date, creation",
				limit_page_length=0,
			):
				amount = flt(allocated_by_entry.get(entry.name))
				if amount <= 0:
					continue
				entry["paid_amount"] = amount
				allocated.append(entry)

	tagged = _case_tagged_payments(visit, from_date, to_date) if visit else []
	entries = _merge_payment_entries(allocated, tagged)
	cache[cache_key] = entries
	return entries


def _case_file_numbers(sales_orders) -> dict[str, str]:
	"""Customer Patient File No per Sales Order (the sheet's ``File No``)."""
	sos = [s for s in (sales_orders or []) if s]
	if not sos:
		return {}
	rows = frappe.db.sql(
		"""
		SELECT so.name, c.custom_patient_file_no AS file_no
		FROM `tabSales Order` so
		LEFT JOIN `tabCustomer` c ON c.name = so.customer
		WHERE so.name IN %(names)s
		""",
		{"names": tuple(sorted(set(sos)))},
		as_dict=True,
	)
	return {r.name: (r.file_no or "") for r in rows}


def _case_discounts(sales_orders) -> dict[str, float]:
	"""(Sales Order, discount_amount) for the sheet's ``Disc.`` column."""
	sos = [s for s in (sales_orders or []) if s]
	if not sos:
		return {}
	rows = frappe.get_all(
		"Sales Order",
		filters={"name": ["in", sorted(set(sos))]},
		fields=["name", "discount_amount"],
		limit_page_length=0,
	)
	return {r.name: flt(r.discount_amount, 3) for r in rows}


def _statement_line(row) -> dict:
	"""Normalise a payroll/payslip service line (Document row or dict)."""
	get = row.get if hasattr(row, "get") else (lambda key, default=None: getattr(row, key, default))
	net = get("net_commission_amount")
	net_paid = get("net_service_amount")
	if net_paid in (None, ""):
		# Lines generated before net paid was stored: fall back to the collection
		# less the mode charge.
		net_paid = flt(get("service_amount")) - flt(get("deduction_amount"))
	return {
		"transaction_date": str(get("transaction_date") or ""),
		"patient": get("patient"),
		"patient_name": get("patient_name") or "",
		"source_doctype": get("source_doctype") or "",
		"source_name": get("source_name") or "",
		"sales_order": get("sales_order") or "",
		"item_code": get("item_code") or "",
		"item_name": get("item_name") or "",
		"cost_center": get("cost_center") or "",
		"case_index": cint(get("case_index")),
		"mode_of_payment": get("mode_of_payment") or "",
		"payment_mode_percent": flt(get("payment_mode_percent")),
		"service_amount": flt(get("service_amount")),
		"net_service_amount": flt(net_paid),
		"commission_percent": flt(get("commission_percent")),
		"commission_amount": flt(get("commission_amount")),
		"deduction_percent": flt(get("deduction_percent")),
		"deduction_amount": flt(get("deduction_amount")),
		"net_commission_amount": flt(net) if net is not None else flt(get("commission_amount")),
		"calculation_type": get("calculation_type") or "",
		"commission_rule": get("commission_rule") or "",
	}


def _case_key(line: dict) -> tuple:
	"""One statement row per visit; other sources fall back to (source, case #)."""
	if line["source_doctype"] == "Patient Visit" and line["source_name"]:
		return (line["source_name"], line["cost_center"], 0)
	return (line["sales_order"] or line["source_name"], line["cost_center"], line["case_index"])


def _new_case(line: dict, sl_no: int) -> dict:
	visit = line["source_name"] if line["source_doctype"] == "Patient Visit" else ""
	return {
		"sl_no": sl_no,
		"date": line["transaction_date"],
		"patient": line["patient"],
		"patient_name": line["patient_name"],
		"file_no": "",
		"visit_no": visit,
		"source_doctype": line["source_doctype"],
		"source_name": line["source_name"],
		"branch": line["cost_center"],
		"sales_orders": [],
		"cash_online": 0.0,
		"card": 0.0,
		"other_collected": 0.0,
		"collected": 0.0,
		"due": 0.0,
		"discount": 0.0,
		"total": 0.0,
		"net_service_amount": 0.0,
		"gross_commission": 0.0,
		"deduction": 0.0,
		"commission": 0.0,
		"amount": 0.0,
		"comments": "",
		"payments": [],
		"has_payments": False,
	}


def _collect_case_lines(lines: list[dict]):
	"""Group service lines into statement cases (visits)."""
	cases: dict[tuple, dict] = {}
	order: list[tuple] = []
	for line in lines:
		key = _case_key(line)
		case = cases.get(key)
		if case is None:
			case = _new_case(line, len(order) + 1)
			cases[key] = case
			order.append(key)
		if line["sales_order"] and line["sales_order"] not in case["sales_orders"]:
			case["sales_orders"].append(line["sales_order"])
		if not case["patient_name"]:
			case["patient_name"] = line["patient_name"]
		if not case["date"] and line["transaction_date"]:
			case["date"] = line["transaction_date"]
		case["total"] += flt(line["service_amount"])
		case["net_service_amount"] += flt(line["net_service_amount"])
		case["gross_commission"] += flt(line["commission_amount"])
		case["deduction"] += flt(line["deduction_amount"])
		case["commission"] += flt(line["net_commission_amount"])
	return cases, order


def _apply_collections(cases, order, period_from, period_to, month_label, *, missing_receipts_are_due=False):
	"""Fill each case with its receipts (Cash/Online, Card, Due) and payment details.

	``missing_receipts_are_due`` is used by the Due Payment report/print: a case
	with no receipt at all is then shown as fully due instead of 0.
	"""
	all_orders = [so for key in order for so in cases[key]["sales_orders"]]
	file_numbers = _case_file_numbers(all_orders)
	discounts = _case_discounts(all_orders)

	payment_cache: dict = {}
	collection_data_found = False
	for key in order:
		case = cases[key]
		case["file_no"] = next(
			(file_numbers.get(so) for so in case["sales_orders"] if file_numbers.get(so)), ""
		)
		case["discount"] = flt(sum(discounts.get(so, 0.0) for so in case["sales_orders"]), 3)
		entries = _case_collections(
			case["sales_orders"], case["visit_no"], period_from, period_to, payment_cache
		)
		case["has_payments"] = bool(entries)
		if entries:
			collection_data_found = True
			mode_totals, details = _payments_by_mode(entries)
			for mode_row in mode_totals:
				amount = flt(mode_row.get("amount"), 3)
				column = classify_payment_mode(mode_row.get("mode"))
				if column == CARD_COLUMN:
					case["card"] += amount
				elif column == CASH_ONLINE_COLUMN:
					case["cash_online"] += amount
				else:
					case["other_collected"] += amount
			case["payments"] = [
				{**detail, "column": classify_payment_mode(detail.get("mode_of_payment"))}
				for detail in details
			]
		case["cash_online"] = flt(case["cash_online"], 3)
		case["card"] = flt(case["card"], 3)
		case["other_collected"] = flt(case["other_collected"], 3)
		case["collected"] = flt(case["cash_online"] + case["card"] + case["other_collected"], 3)
		case["total"] = flt(case["total"], MONEY_PRECISION)
		if entries:
			case["due"] = flt(max(case["total"] - case["collected"], 0.0), 3)
		elif missing_receipts_are_due:
			# Nothing is receipted against the visit, so the whole service is
			# still owed — the case is listed and flagged, not silently hidden.
			case["due"] = flt(case["total"], 3)
		case["comments"] = " ".join(
			part for part in ((case["branch"] or "").strip().upper(), month_label) if part
		)

	# The payroll figure is what the doctor is paid: the collection columns are a
	# memo of what has been receipted against each visit so far, and the case is
	# listed under "Due for Payment" while its receipt is still missing.
	for key in order:
		cases[key]["amount"] = flt(cases[key]["commission"], MONEY_PRECISION)
	return collection_data_found


def _statement_totals(cases, order) -> dict:
	totals = {
		"cases": len(order),
		"cash_online": flt(sum(cases[k]["cash_online"] for k in order), MONEY_PRECISION),
		"card": flt(sum(cases[k]["card"] for k in order), MONEY_PRECISION),
		"other_collected": flt(sum(cases[k]["other_collected"] for k in order), MONEY_PRECISION),
		"collected": flt(sum(cases[k]["collected"] for k in order), MONEY_PRECISION),
		"due": flt(sum(cases[k]["due"] for k in order), MONEY_PRECISION),
		"discount": flt(sum(cases[k]["discount"] for k in order), MONEY_PRECISION),
		"total": flt(sum(cases[k]["total"] for k in order), MONEY_PRECISION),
		"net_service_amount": flt(
			sum(cases[k]["net_service_amount"] for k in order), MONEY_PRECISION
		),
		"gross_commission": flt(sum(cases[k]["gross_commission"] for k in order), MONEY_PRECISION),
		"deduction": flt(sum(cases[k]["deduction"] for k in order), MONEY_PRECISION),
		"commission": flt(sum(cases[k]["commission"] for k in order), MONEY_PRECISION),
		"amount": flt(sum(cases[k]["amount"] for k in order), MONEY_PRECISION),
	}
	totals["commission_percent"] = (
		flt(totals["gross_commission"] / totals["total"] * 100, 2) if totals["total"] else 0.0
	)
	totals["payable"] = totals["amount"]
	# Bahraini Dinar is quoted in fils (3 dp), so the payable is already whole
	# currency and the round off is normally nil.
	totals["payable_rounded"] = flt(round(totals["payable"], MONEY_PRECISION), MONEY_PRECISION)
	totals["round_off"] = flt(
		totals["payable_rounded"] - totals["payable"], MONEY_PRECISION
	)
	# Memo figures — the receipts still missing against the period's cases.
	totals["cases_without_receipts"] = sum(
		1 for key in order if not cases[key]["collected"] and not cases[key]["payments"]
	)
	totals["due_commission"] = flt(
		sum(cases[key]["commission"] for key in order if flt(cases[key]["due"]) > 0), 3
	)
	return totals


def _statement_notes(lines: list[dict]) -> list[str]:
	"""The sheet's NOTE block, from the deductions configured on the rule's modes."""
	by_percent: dict[float, set[str]] = defaultdict(set)
	for line in lines:
		percent = flt(line["deduction_percent"], 3)
		if percent > 0:
			by_percent[percent].add(classify_payment_mode(line["mode_of_payment"]))
	notes = []
	for percent in sorted(by_percent, reverse=True):
		for column in sorted(by_percent[percent]):
			label = "card" if column == CARD_COLUMN else "cash / online"
			notes.append(f"{percent:.3f}% deduction, if patient pays by {label}.")
	return notes


def _statement_detail(lines: list[dict]) -> list[dict]:
	return [
		{
			"transaction_date": line["transaction_date"],
			"patient_name": line["patient_name"] or line["patient"],
			"visit_no": line["source_name"] if line["source_doctype"] == "Patient Visit" else "",
			"sales_order": line["sales_order"],
			"item_name": line["item_name"] or line["item_code"],
			"mode_of_payment": line["mode_of_payment"],
			"payment_mode_percent": line["payment_mode_percent"],
			"service_amount": line["service_amount"],
			"net_service_amount": line["net_service_amount"],
			"commission_percent": line["commission_percent"],
			"commission_amount": line["commission_amount"],
			"deduction_percent": line["deduction_percent"],
			"deduction_amount": line["deduction_amount"],
			"net_commission_amount": line["net_commission_amount"],
			"branch": line["cost_center"],
		}
		for line in lines
	]


def _statement_pending(cases, order) -> list[dict]:
	pending = []
	for key in order:
		case = cases[key]
		if flt(case["due"]) <= 0:
			continue
		pending.append(
			{
				"sl_no": len(pending) + 1,
				"date": case["date"],
				"patient_name": case["patient_name"] or case["patient"],
				"file_no": case["file_no"],
				"visit_no": case["visit_no"] or case["source_name"],
				"cash_online": case["cash_online"],
				"card": case["card"],
				"collected": case["collected"],
				"due": case["due"],
				"discount": case["discount"],
				"total": case["total"],
				"amount": 0.0,
				"commission": flt(case["commission"], 3),
				"receipt_recorded": bool(case["has_payments"]),
				"comments": case["comments"],
				"branch": case["branch"],
				"payments": case["payments"],
			}
		)
	return pending


def build_commission_statement(
	items,
	*,
	payroll=None,
	payslip=None,
	doctor=None,
	payroll_status=None,
	company=None,
	from_date=None,
	to_date=None,
	missing_receipts_are_due=False,
) -> dict:
	"""Doctor-facing statement payload built from commission service lines."""
	lines = [_statement_line(row) for row in (items or [])]
	period_from = getdate(from_date) if from_date else None
	period_to = getdate(to_date) if to_date else None
	month_label = period_to.strftime("%B").upper() if period_to else ""

	cases, order = _collect_case_lines(lines)
	has_collection_data = _apply_collections(
		cases,
		order,
		period_from,
		period_to,
		month_label,
		missing_receipts_are_due=missing_receipts_are_due,
	)

	currency = frappe.get_cached_value("Company", company, "default_currency") if company else None
	return {
		"payroll": payroll,
		"payslip": payslip,
		"payroll_status": payroll_status,
		"company": company,
		"currency": currency,
		"from_date": str(period_from) if period_from else "",
		"to_date": str(period_to) if period_to else "",
		"month_label": month_label,
		"doctor": doctor or {},
		"cases": [cases[key] for key in order],
		"totals": _statement_totals(cases, order),
		"pending": _statement_pending(cases, order),
		"detail": _statement_detail(lines),
		"notes": _statement_notes(lines),
		"has_collection_data": has_collection_data,
	}


def get_statement_for_payroll(payroll_doc, practitioner: str, *, missing_receipts_are_due=False) -> dict:
	"""Statement for one doctor on a Doctor Commission Payroll (view/print)."""
	payroll_doc = payroll_doc if hasattr(payroll_doc, "doctors") else frappe.get_doc(
		"Doctor Commission Payroll", payroll_doc
	)
	practitioner = (practitioner or "").strip()
	if not practitioner:
		frappe.throw(_("Doctor is required"))

	doctor_rows = [row for row in (payroll_doc.doctors or []) if row.practitioner == practitioner]
	if not doctor_rows:
		frappe.throw(_("{0} is not part of this Doctor Commission Payroll.").format(practitioner))
	head = doctor_rows[0]
	branches = {(row.cost_center or "") for row in doctor_rows}
	branches.discard("")
	items = [row for row in (payroll_doc.items or []) if row.practitioner == practitioner]

	doctor = {
		"practitioner": head.practitioner,
		"practitioner_name": head.practitioner_name,
		"doctors_id": head.doctors_id,
		"employee": head.employee,
		"cost_center": head.cost_center,
		"branches": sorted(branches),
		"cases_count": sum(cint(row.cases_count) for row in doctor_rows),
		"service_amount": flt(sum(flt(row.service_amount) for row in doctor_rows), 3),
		"calculated_commission": flt(
			sum(flt(row.calculated_commission) for row in doctor_rows), 3
		),
		"deduction_amount": flt(sum(flt(row.get("deduction_amount")) for row in doctor_rows), 3),
		"adjusted_commission": flt(
			sum(
				flt(row.adjusted_commission)
				if row.adjusted_commission not in (None, "")
				else flt(row.calculated_commission)
				for row in doctor_rows
			),
			3,
		),
		"remarks": head.remarks,
	}
	return build_commission_statement(
		items,
		payroll=payroll_doc.name,
		doctor=doctor,
		payroll_status=payroll_doc.status,
		company=payroll_doc.company,
		from_date=payroll_doc.from_date,
		to_date=payroll_doc.to_date,
		missing_receipts_are_due=missing_receipts_are_due,
	)


def get_statement_for_payslip(payslip_doc, *, missing_receipts_are_due=False) -> dict:
	"""Statement for a Commission Payslip (view/print)."""
	payslip_doc = (
		payslip_doc
		if hasattr(payslip_doc, "items")
		else frappe.get_doc("Commission Payslip", payslip_doc)
	)
	doctor = {
		"practitioner": payslip_doc.practitioner,
		"practitioner_name": payslip_doc.practitioner_name,
		"doctors_id": payslip_doc.doctors_id,
		"employee": payslip_doc.employee,
		"cost_center": payslip_doc.cost_center,
		"branches": [payslip_doc.cost_center] if payslip_doc.cost_center else [],
		"cases_count": cint(payslip_doc.total_cases),
		"service_amount": flt(payslip_doc.total_service_amount),
		"calculated_commission": flt(payslip_doc.total_commission),
		"deduction_amount": flt(payslip_doc.get("total_deduction")),
		"adjusted_commission": flt(payslip_doc.total_commission),
		"remarks": "",
	}
	return build_commission_statement(
		payslip_doc.items,
		payroll=payslip_doc.doctor_commission_payroll,
		payslip=payslip_doc.name,
		doctor=doctor,
		payroll_status=payslip_doc.status,
		company=payslip_doc.company,
		from_date=payslip_doc.from_date,
		to_date=payslip_doc.to_date,
		missing_receipts_are_due=missing_receipts_are_due,
	)


@frappe.whitelist()
def get_commission_statement(payroll, practitioner):
	"""Statement for a doctor on a Doctor Commission Payroll (View Doctor dialog)."""
	if not frappe.has_permission("Doctor Commission Payroll", "read", doc=payroll):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	return get_statement_for_payroll(payroll, practitioner)


@frappe.whitelist()
def get_commission_payslip_statement(payslip):
	"""Statement for a Commission Payslip (statement button on the payslip)."""
	if not frappe.has_permission("Commission Payslip", "read", doc=payslip):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	return get_statement_for_payslip(payslip)

