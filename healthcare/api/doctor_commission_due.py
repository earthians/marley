# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Doctor Due Payment — services billed in the period that are not paid for yet.

Backs the ``Doctor Due Payment`` print format (Doctor Commission Payroll),
``Doctor Due Payment Payslip`` (Commission Payslip) and the ``Doctor Due
Payment`` report.

A case is due when the receipts recorded against it are less than the amount
billed. A case with no receipt at all is shown as fully due and flagged
(``Receipts: None``) so the Accounts team can follow it up — the branch sheets
work the same way.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import escape_html, flt, fmt_money, formatdate, getdate

from healthcare.api.doctor_commission import MONEY_PRECISION
from healthcare.api.doctor_commission_statement import (
	get_statement_for_payroll,
	get_statement_for_payslip,
)

DUE_FOR_PAYMENT_LABEL = "Commission is not paid due to the pending for payment"


def _sl_no(row) -> int:
	try:
		return int(row.get("sl_no") or 0)
	except (TypeError, ValueError):
		return 0


def _doctor_due_block(statement) -> dict | None:
	"""One doctor's due services from a commission statement payload."""
	doctor = statement.get("doctor") or {}
	cases = statement.get("pending") or []
	if not cases:
		return None

	cases = sorted(cases, key=lambda row: (str(row.get("date") or ""), _sl_no(row)))
	withheld = flt(sum(flt(case.get("commission")) for case in cases), MONEY_PRECISION)
	doctor_commission = flt(doctor.get("adjusted_commission"), MONEY_PRECISION)

	return {
		"doctor": doctor,
		"cases": cases,
		"commission_total": doctor_commission,
		"withheld_commission": withheld,
		"payable_excluding_due": flt(doctor_commission - withheld, MONEY_PRECISION),
		"totals": {
			"cases": len(cases),
			"collected": flt(
				sum(flt(case.get("collected")) for case in cases), MONEY_PRECISION
			),
			"due": flt(sum(flt(case.get("due")) for case in cases), MONEY_PRECISION),
			"discount": flt(sum(flt(case.get("discount")) for case in cases), MONEY_PRECISION),
			"total": flt(sum(flt(case.get("total")) for case in cases), MONEY_PRECISION),
			"commission": withheld,
			"without_receipt": sum(1 for case in cases if not case.get("receipt_recorded")),
		},
	}


def _payload_totals(doctors: list[dict]) -> dict:
	totals = {
		"doctors": len(doctors),
		"cases": 0,
		"collected": 0.0,
		"due": 0.0,
		"discount": 0.0,
		"total": 0.0,
		"commission": 0.0,
		"without_receipt": 0,
	}
	for block in doctors:
		for key in ("cases", "collected", "due", "discount", "total", "commission", "without_receipt"):
			totals[key] += block["totals"][key]
	for key in ("collected", "due", "discount", "total", "commission"):
		totals[key] = flt(totals[key], MONEY_PRECISION)
	return totals



def build_due_payment_payload(payroll_doc, practitioner: str | None = None) -> dict:
	"""Due (uncollected) services for the doctors on a Doctor Commission Payroll."""
	payroll_doc = payroll_doc if hasattr(payroll_doc, "doctors") else frappe.get_doc(
		"Doctor Commission Payroll", payroll_doc
	)
	practitioner = (practitioner or "").strip()

	blocks: list[dict] = []
	seen: set[str] = set()
	for row in payroll_doc.doctors or []:
		if not row.practitioner or row.practitioner in seen:
			continue
		if practitioner and row.practitioner != practitioner:
			continue
		seen.add(row.practitioner)
		statement = get_statement_for_payroll(
			payroll_doc, row.practitioner, missing_receipts_are_due=True
		)
		block = _doctor_due_block(statement)
		if block:
			blocks.append(block)

	return {
		"payroll": payroll_doc.name,
		"payslip": None,
		"company": payroll_doc.company,
		"currency": frappe.get_cached_value("Company", payroll_doc.company, "default_currency")
		if payroll_doc.company
		else None,
		"from_date": str(payroll_doc.from_date) if payroll_doc.from_date else "",
		"to_date": str(payroll_doc.to_date) if payroll_doc.to_date else "",
		"month_label": getdate(payroll_doc.to_date).strftime("%B").upper()
		if payroll_doc.to_date
		else "",
		"practitioner": practitioner,
		"doctors": blocks,
		"totals": _payload_totals(blocks),
	}


def build_due_payment_payload_for_payslip(payslip_doc) -> dict:
	"""Due (uncollected) services for the doctor on a Commission Payslip."""
	payslip_doc = payslip_doc if hasattr(payslip_doc, "items") else frappe.get_doc(
		"Commission Payslip", payslip_doc
	)
	statement = get_statement_for_payslip(payslip_doc, missing_receipts_are_due=True)
	block = _doctor_due_block(statement)
	blocks = [block] if block else []

	return {
		"payroll": payslip_doc.doctor_commission_payroll,
		"payslip": payslip_doc.name,
		"company": payslip_doc.company,
		"currency": frappe.get_cached_value("Company", payslip_doc.company, "default_currency")
		if payslip_doc.company
		else None,
		"from_date": str(payslip_doc.from_date) if payslip_doc.from_date else "",
		"to_date": str(payslip_doc.to_date) if payslip_doc.to_date else "",
		"month_label": getdate(payslip_doc.to_date).strftime("%B").upper()
		if payslip_doc.to_date
		else "",
		"practitioner": payslip_doc.practitioner or "",
		"doctors": blocks,
		"totals": _payload_totals(blocks),
	}


@frappe.whitelist()
def get_doctor_due_payment(payroll, practitioner=None):
	"""Due services for one payroll (optionally one doctor)."""
	if not frappe.has_permission("Doctor Commission Payroll", "read", doc=payroll):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	return build_due_payment_payload(payroll, practitioner)


@frappe.whitelist()
def get_commission_payslip_due_payment(payslip):
	"""Due services for one Commission Payslip."""
	if not frappe.has_permission("Commission Payslip", "read", doc=payslip):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	return build_due_payment_payload_for_payslip(payslip)


def fmt_date(value) -> str:
	return formatdate(value, "dd-MM-yyyy") if value else ""


def _esc(value) -> str:
	return escape_html(str(value)) if value not in (None, "") else ""


def _money(value, currency=None, precision=MONEY_PRECISION) -> str:
	return fmt_money(flt(value), precision=precision, currency=currency)


def _due_cases_table(block, currency) -> str:
	heads = [
		_("Sl.No"),
		_("Date"),
		_("Patient Name"),
		_("File No"),
		_("Visit No."),
		_("Cash/Online"),
		_("Card"),
		_("Due"),
		_("Discount"),
		_("Total"),
		_("Commission"),
		_("Remarks"),
	]
	head_html = "".join(
		f'<th class="{"ddp-num" if index >= 5 else ""}">{_esc(label)}</th>'
		for index, label in enumerate(heads)
	)

	rows = []
	for index, case in enumerate(block["cases"], start=1):
		remark = "" if case.get("receipt_recorded") else _("No receipt recorded")
		rows.append(
			"<tr>"
			f'<td class="ddp-num">{index}</td>'
			f"<td>{_esc(fmt_date(case.get('date')))}</td>"
			f"<td>{_esc(case.get('patient_name'))}</td>"
			f"<td>{_esc(case.get('file_no'))}</td>"
			f"<td>{_esc(case.get('visit_no'))}</td>"
			f'<td class="ddp-num">{_money(case.get("cash_online"), currency)}</td>'
			f'<td class="ddp-num">{_money(case.get("card"), currency)}</td>'
			f'<td class="ddp-num">{_money(case.get("due"), currency)}</td>'
			f'<td class="ddp-num">{_money(case.get("discount"), currency)}</td>'
			f'<td class="ddp-num">{_money(case.get("total"), currency)}</td>'
			f'<td class="ddp-num">{_money(case.get("commission"), currency, 3)}</td>'
			f"<td>{_esc(remark)}</td>"
			"</tr>"
		)

	totals = block["totals"]
	foot = (
		'<tfoot><tr class="ddp-total">'
		f'<td colspan="5">{_esc(_("Total"))}</td>'
		f'<td class="ddp-num">{_money(totals["collected"], currency)}</td>'
		f'<td class="ddp-num">{_money(totals["due"], currency)}</td>'
		f'<td class="ddp-num">{_money(totals["discount"], currency)}</td>'
		f'<td class="ddp-num">{_money(totals["total"], currency)}</td>'
		f'<td class="ddp-num">{_money(totals["commission"], currency, 3)}</td>'
		f'<td>{_esc(_("{0} case(s)").format(totals["cases"]))}</td>'
		"</tr></tfoot>"
	)
	return f"<table class='ddp-table'><thead><tr>{head_html}</tr></thead><tbody>{''.join(rows)}</tbody>{foot}</table>"


def _payment_details_table(block, currency) -> str:
	payments = [payment for case in block["cases"] for payment in (case.get("payments") or [])]
	if not payments:
		return ""
	rows = "".join(
		"<tr>"
		f"<td>{_esc(fmt_date(payment.get('rv_date') or payment.get('posting_date')))}</td>"
		f"<td>{_esc(payment.get('rv_no') or payment.get('name'))}</td>"
		f"<td>{_esc(payment.get('mode_of_payment'))}</td>"
		f'<td class="ddp-num">{_money(payment.get("amount"), currency)}</td>'
		f"<td>{_esc(payment.get('branch'))}</td>"
		"</tr>"
		for payment in payments
	)
	return (
		f'<div class="ddp-section">{_esc(_("Payment details"))}</div>'
		"<table class='ddp-table'><thead><tr>"
		f"<th>{_esc(_('Date'))}</th><th>{_esc(_('RV No'))}</th><th>{_esc(_('Mode'))}</th>"
		f'<th class="ddp-num">{_esc(_("Amount"))}</th><th>{_esc(_("Branch"))}</th>'
		f"</tr></thead><tbody>{rows}</tbody></table>"
	)


def _doctor_due_html(block, currency) -> str:
	doctor = block["doctor"]
	name = doctor.get("practitioner_name") or doctor.get("practitioner") or ""
	doctor_no = f" (No.{doctor.get('doctors_id')})" if doctor.get("doctors_id") else ""
	heading = f"{_(DUE_FOR_PAYMENT_LABEL)} - {name}{doctor_no}"
	summary = _(
		"Commission on due services: {0} | Payable commission (excluding due amount): {1}"
	).format(
		_money(block["withheld_commission"], currency, 3),
		_money(block["payable_excluding_due"], currency, 3),
	)
	return (
		f'<div class="ddp-doctor">{_esc(heading)}</div>'
		f'<div class="ddp-doctor-sum">{_esc(summary)}</div>'
		f"{_due_cases_table(block, currency)}"
		f"{_payment_details_table(block, currency)}"
	)


def _styles() -> str:
	return """
	<style>
		.ddp { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; font-size: 12px; }
		.ddp-title { font-size: 16px; font-weight: 700; }
		.ddp-sub { font-size: 12px; color: #64748b; margin-bottom: 8px; }
		.ddp-meta { display: flex; flex-wrap: wrap; gap: 4px 18px; margin-bottom: 10px; }
		.ddp-meta span { color: #64748b; margin-right: 4px; }
		.ddp-doctor { margin: 12px 0 2px; font-weight: 600; }
		.ddp-doctor-sum { margin-bottom: 4px; color: #475569; }
		.ddp-section { margin: 8px 0 4px; font-weight: 600; }
		.ddp-table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
		.ddp-table th, .ddp-table td { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; }
		.ddp-table th { background: #f1f5f9; text-align: left; }
		.ddp-num { text-align: right; }
		.ddp-total td { font-weight: 700; background: #f8fafc; }
		.ddp-grand { margin-top: 10px; font-weight: 700; }
		.ddp-empty { padding: 8px; border: 1px solid #cbd5e1; color: #475569; }
		.ddp-notes { margin-top: 10px; color: #475569; }
		.ddp-sign { width: 100%; margin-top: 26px; }
		.ddp-sign td { width: 25%; padding: 0 8px; text-align: center; }
		.ddp-sign-line { border-bottom: 1px solid #475569; height: 26px; }
		.ddp-sign-label { padding-top: 4px; color: #475569; }
	</style>
	"""


def _signature_html() -> str:
	blocks = [_("Prepared by"), _("Checked by"), _("Verified by"), _("Approved by")]
	cells = "".join(
		f'<td><div class="ddp-sign-line"></div><div class="ddp-sign-label">{_esc(label)}</div></td>'
		for label in blocks
	)
	return f'<table class="ddp-sign"><tbody><tr>{cells}</tr></tbody></table>'


def render_due_payment_html(payload: dict) -> str:
	"""Doctor Due Payment body HTML for the print formats."""
	currency = payload.get("currency")
	doctors = payload.get("doctors") or []
	totals = payload.get("totals") or {}

	meta = [
		[_("Payroll"), payload.get("payroll")],
		[_("Payslip"), payload.get("payslip")],
		[_("Company"), payload.get("company")],
		[
			_("Period"),
			f"{fmt_date(payload.get('from_date'))} - {fmt_date(payload.get('to_date'))}"
			if payload.get("from_date")
			else "",
		],
		[_("Doctors"), totals.get("doctors")],
		[_("Cases"), totals.get("cases")],
	]
	meta_html = "".join(
		f'<div><span>{_esc(label)}</span><b>{_esc(value)}</b></div>'
		for label, value in meta
		if value not in (None, "")
	)

	body = "".join(_doctor_due_html(block, currency) for block in doctors)
	if not body:
		body = f'<div class="ddp-empty">{_esc(_("No due services for this period."))}</div>'
	else:
		body += (
			f'<div class="ddp-grand">{_esc(_("Grand Total (Due)"))}: '
			f'{_esc(_money(totals.get("due"), currency))} — '
			f'{_esc(_("Commission on due services"))}: '
			f'{_esc(_money(totals.get("commission"), currency, 3))}</div>'
		)

	notes = (
		f'<div class="ddp-notes"><b>{_esc(_("NOTE"))}:</b> '
		f"{_esc(_('1) Services billed in this period that are not receipted are listed above; their commission is not included in the payable amount.'))} "
		f"{_esc(_('2) Commission is computed on the net paid amount (payment-mode deductions are taken off the collection).'))}"
		"</div>"
	)

	return f"""
	{_styles()}
	<div class="ddp">
		<div class="ddp-title">{_esc(_("Doctor Due Payment"))}</div>
		<div class="ddp-sub">{_esc(_("Services within the period that are not paid for yet"))}</div>
		<div class="ddp-meta">{meta_html}</div>
		{body}
		{notes}
		{_signature_html()}
	</div>
	"""


@frappe.whitelist()
def render_due_payment(doc):
	"""Jinja method: Doctor Due Payment body HTML for the print formats."""
	if getattr(doc, "doctype", "") == "Commission Payslip":
		return render_due_payment_html(build_due_payment_payload_for_payslip(doc))
	return render_due_payment_html(build_due_payment_payload(doc))
