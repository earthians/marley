"""Charge inpatient package days up to today (Statement of Account).

Uses the **existing** admission package Quotation and creates a **partial**
Sales Order for unbilled days (qty = days to charge). Does not create a new
Quotation.
"""

from __future__ import annotations

import re
from typing import Any

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, today

from healthcare.api.inpatient_package import calculate_package_price


def _require_billing_user() -> None:
	roles = set(frappe.get_roles())
	if not roles.intersection(
		{
			"System Manager",
			"Healthcare Administrator",
			"Accounts User",
			"Accounts Manager",
			"Healthcare Receptionist",
			"Sales User",
			"Sales Manager",
		}
	):
		frappe.throw(_("Not permitted to charge package days."), frappe.PermissionError)


def _admission_start_date(admission) -> Any:
	for field in ("admission_date", "scheduled_date", "admitted_datetime"):
		val = admission.get(field)
		if val:
			return getdate(val)
	return None


def _package_days_elapsed(admission, as_of=None) -> int:
	start = _admission_start_date(admission)
	if not start:
		frappe.throw(_("Admission has no start date — cannot calculate package days."))
	end = getdate(as_of or today())
	if admission.get("discharge_datetime"):
		discharge = getdate(admission.discharge_datetime)
		if discharge and discharge < end:
			end = discharge
	if end < start:
		return 0
	# Package duration counts the admission day as day 1 (expected discharge is
	# start + program days - 1), so include both the start and end dates.
	return (end - start).days + 1


def _is_open_daily_package(admission, package) -> bool:
	"""Daily / standard room packages are open-ended (no_of_days=1 means per-day rate).

	Fixed programs (7-day, 14-day, …) keep a hard package length. The old daily
	format must keep charging room days for the whole stay.
	"""
	if cint(getattr(package, "is_daily_default", 0) or 0):
		return True
	if cint(admission.get("standard_package") or 0):
		return True
	# Common naming for the default daily room package
	name = (getattr(package, "name", None) or getattr(package, "package_name", None) or "").strip().lower()
	return name in {"daily (default)", "daily", "daily package"}


def _days_from_unledgered_quotations(admission_name: str, package_name: str | None = None) -> int:
	"""Days ordered from package quotations that were never written to Package Detail.

	Does **not** treat an open admission Quotation (no Sales Order yet) as billed —
	only ordered qty / linked Sales Orders count.
	"""
	filters: dict[str, Any] = {
		"custom_inpatient_admission": admission_name,
		"docstatus": 1,
		"custom_package": ["is", "set"],
	}
	if package_name:
		filters["custom_package"] = package_name

	quotes = frappe.get_all("Quotation", filters=filters, pluck="name")
	if not quotes:
		return 0

	ledgered: set[str] = set()
	if frappe.db.has_column("Package Detail", "quotation"):
		ledgered = set(
			frappe.get_all(
				"Package Detail",
				filters={"admission_no": admission_name, "quotation": ["in", quotes]},
				pluck="quotation",
			)
		)

	total = 0
	for qname in quotes:
		if qname in ledgered:
			continue
		quotation = frappe.get_doc("Quotation", qname)
		ordered = _package_line_ordered_qty(quotation)
		if ordered > 0:
			total += ordered
			continue
		# Legacy mid-stay quote that created an SO but ordered_qty was not updated
		has_so = frappe.db.exists(
			"Sales Order Item",
			{"prevdoc_docname": qname, "docstatus": ["<", 2]},
		)
		if has_so:
			days = parse_package_days_from_quotation(quotation)
			if days <= 0 and package_name:
				days = cint(frappe.db.get_value("Inpatient Package", package_name, "no_of_days") or 0)
			total += max(days, 0)
	return total


def _package_line_ordered_qty(quotation) -> int:
	"""Days already ordered from the package Quotation line (via Sales Orders)."""
	row = _package_line_from_quotation(quotation)
	if not row:
		return 0
	return cint(getattr(row, "ordered_qty", None) or row.get("ordered_qty") or 0)


def _days_already_billed(admission_name: str, package_name: str | None = None) -> int:
	details = frappe.get_all(
		"Package Detail",
		filters={"admission_no": admission_name},
		fields=["total_days"],
	)
	detail_sum = sum(cint(d.total_days or 0) for d in details)
	unledgered = _days_from_unledgered_quotations(admission_name, package_name)

	ordered = 0
	q = _find_admission_package_quotation(admission_name, package_name, allow_draft=False)
	if q:
		ordered = _package_line_ordered_qty(q)

	total = max(detail_sum, unledgered, ordered)
	if frappe.db.has_column("Inpatient Admission", "package_days_billed"):
		billed = cint(
			frappe.db.get_value("Inpatient Admission", admission_name, "package_days_billed") or 0
		)
		return max(billed, total)
	return total


def _resolve_package_name(admission) -> str:
	package = (admission.get("inpatient_package") or "").strip()
	if package and frappe.db.exists("Inpatient Package", package):
		return package

	row = frappe.db.get_value(
		"Quotation",
		{
			"custom_inpatient_admission": admission.name,
			"docstatus": ["<", 2],
			"custom_package": ["is", "set"],
		},
		["custom_package"],
		order_by="creation desc",
		as_dict=True,
	)
	if row and row.custom_package:
		return row.custom_package

	frappe.throw(
		_("No inpatient package is linked to admission {0}. Set Inpatient Package first.").format(
			admission.name
		)
	)


def _find_admission_package_quotation(
	admission_name: str,
	package_name: str | None = None,
	*,
	allow_draft: bool = True,
):
	"""Return the existing admission package Quotation (submitted preferred)."""
	filters: dict[str, Any] = {
		"custom_inpatient_admission": admission_name,
		"custom_package": ["is", "set"],
		"docstatus": ["<", 2] if allow_draft else 1,
	}
	if package_name:
		filters["custom_package"] = package_name

	names = frappe.get_all(
		"Quotation",
		filters=filters,
		fields=["name", "docstatus"],
		order_by="docstatus desc, creation asc",
		limit_page_length=20,
	)
	if not names:
		return None
	# Prefer submitted
	for row in names:
		if cint(row.docstatus) == 1:
			return frappe.get_doc("Quotation", row.name)
	return frappe.get_doc("Quotation", names[0].name) if allow_draft else None


def _amount_per_day(admission, package_name: str, service_unit: str | None = None) -> float:
	"""Daily rate from package / admission — room multipliers are not applied."""
	rate = flt(admission.get("rate_per_day") or 0)
	if rate > 0:
		return rate

	pricing = calculate_package_price(
		package_name,
		1,
		service_unit=service_unit,
		service_unit_type=admission.get("admission_service_unit_type"),
		room_multiplier=1,
	)
	per_day = flt(pricing.get("program_price") or pricing.get("total_price") or 0)
	if per_day > 0:
		return per_day

	package = frappe.get_doc("Inpatient Package", package_name)
	base_total = flt(getattr(package, "base_total", 0) or 0)
	program_days = cint(getattr(package, "no_of_days", 0) or 0)
	if base_total and program_days:
		return base_total / program_days
	return flt(package.package_rate or 0)


def _last_package_billed_to_date(admission_name: str):
	"""Latest date already covered by a package/room stay charge.

	Prefers Package Detail.to_date (actual stay coverage). Only if the ledger is
	missing do we fall back to Sales Order transaction dates — those are billing
	dates, not coverage end dates, and must not skip an unbilled calendar day.
	"""
	if frappe.db.has_column("Package Detail", "to_date"):
		rows = frappe.get_all(
			"Package Detail",
			filters={"admission_no": admission_name},
			fields=["to_date"],
			order_by="to_date desc",
			limit_page_length=1,
		)
		if rows and rows[0].get("to_date"):
			return getdate(rows[0].to_date)

	so_dates = []
	seen: set[str] = set()
	for filters in (
		{
			"custom_base_reference": "Inpatient Admission",
			"custom_base_reference_name": admission_name,
			"docstatus": 1,
		},
	):
		for row in frappe.get_all(
			"Sales Order",
			filters=filters,
			fields=["name", "transaction_date"],
			limit_page_length=50,
		):
			if row.name in seen or not row.get("transaction_date"):
				continue
			seen.add(row.name)
			so_dates.append(getdate(row.transaction_date))

	quote_names = frappe.get_all(
		"Quotation",
		filters={
			"custom_inpatient_admission": admission_name,
			"docstatus": 1,
			"custom_package": ["is", "set"],
		},
		pluck="name",
	)
	if quote_names:
		for so_name in frappe.get_all(
			"Sales Order Item",
			filters={"prevdoc_docname": ["in", quote_names], "docstatus": 1},
			pluck="parent",
		):
			if so_name in seen:
				continue
			seen.add(so_name)
			td = frappe.db.get_value("Sales Order", so_name, "transaction_date")
			if td:
				so_dates.append(getdate(td))

	return max(so_dates) if so_dates else None


def _charge_window(admission, package, as_of=None, *, through_discharge=False) -> dict:
	from healthcare.api.inpatient_admission import _resolve_quotation_service_unit
	from frappe.utils import add_days

	package_name = package.name
	service_unit = _resolve_quotation_service_unit(admission.name)
	program_days = cint(getattr(package, "no_of_days", 0) or 0)
	is_daily = _is_open_daily_package(admission, package)
	elapsed = _package_days_elapsed(admission, as_of=as_of)
	already = _days_already_billed(admission.name, package_name)

	quotation = _find_admission_package_quotation(admission.name, package_name, allow_draft=True)
	quot_days = parse_package_days_from_quotation(quotation) if quotation else 0
	ordered = _package_line_ordered_qty(quotation) if quotation else 0
	remaining_on_quote = max(quot_days - ordered, 0) if quot_days else None

	to_date = getdate(as_of or today())
	start = _admission_start_date(admission)
	from_date = None

	# Daily/standard room packages (and discharge catch-up) are open-ended: charge
	# from the day after the last billed stay day through as_of. Fixed programs
	# still stop at package length.
	if through_discharge or is_daily:
		last_to = _last_package_billed_to_date(admission.name)
		if last_to:
			from_date = add_days(last_to, 1)
		elif start:
			from_date = add_days(start, already) if already else start
		if from_date and from_date <= to_date:
			days_to_charge = (to_date - from_date).days + 1
		else:
			days_to_charge = 0
			if from_date and from_date > to_date:
				from_date = to_date
	else:
		target_days = elapsed
		if program_days > 0:
			target_days = min(elapsed, program_days)

		days_to_charge = max(target_days - already, 0)
		if remaining_on_quote is not None and quotation and cint(quotation.docstatus) == 1:
			days_to_charge = min(days_to_charge, remaining_on_quote)

		if start:
			from_date = add_days(start, already) if already else start
			if from_date > to_date:
				from_date = to_date

	# Fixed programs expose remaining package length; daily room rate stays open.
	remaining_before = None if is_daily else (max(program_days - already, 0) if program_days else None)
	remaining_after = (
		None
		if is_daily
		else (max(program_days - (already + days_to_charge), 0) if program_days else None)
	)

	per_day = _amount_per_day(admission, package_name, service_unit=service_unit)
	if quotation:
		pline = _package_line_from_quotation(quotation)
		if pline and flt(pline.get("rate") or 0) > 0:
			per_day = flt(pline.get("rate"))

	amount = flt(per_day) * cint(days_to_charge)
	charge_item = _package_charge_item(admission, quotation, service_unit=service_unit)

	return {
		"admission": admission.name,
		"patient": admission.patient,
		"patient_name": admission.patient_name,
		"package": package_name,
		"package_name": package.package_name or package_name,
		"quotation": quotation.name if quotation else None,
		"quotation_status": (
			"Submitted"
			if quotation and cint(quotation.docstatus) == 1
			else ("Draft" if quotation else None)
		),
		"quotation_days": quot_days or None,
		"quotation_ordered_days": ordered or None,
		"quotation_remaining_days": remaining_on_quote,
		"program_days": None if is_daily else program_days,
		"is_daily_package": is_daily,
		"days_elapsed": elapsed,
		"days_already_billed": already,
		"days_to_charge": days_to_charge,
		"remaining_days_before": remaining_before,
		"remaining_days_after": remaining_after,
		"amount_per_day": per_day,
		"amount": amount,
		"from_date": str(from_date) if from_date else None,
		"to_date": str(to_date) if to_date else None,
		"service_unit": service_unit,
		"can_charge": days_to_charge > 0 and amount > 0 and bool(charge_item),
	}


@frappe.whitelist()
def preview_package_charge_to_today(admission: str, as_of: str | None = None) -> dict:
	"""Preview unbilled package days from admission start through today (or as_of)."""
	_require_billing_user()
	if not admission or not frappe.db.exists("Inpatient Admission", admission):
		frappe.throw(_("Inpatient Admission not found"))

	adm = frappe.get_doc("Inpatient Admission", admission)
	package_name = _resolve_package_name(adm)
	package = frappe.get_doc("Inpatient Package", package_name)
	return _charge_window(adm, package, as_of=as_of)


def _package_charge_item(admission, quotation=None, service_unit: str | None = None) -> dict | None:
	"""Package/room Item for a stay charge Sales Order.

	Prefers the existing quotation package line so the same Item is reused.
	Falls back to the service-unit type Item used on admission quotes.
	"""
	if quotation:
		row = _package_line_from_quotation(quotation)
		if row and row.get("item_code"):
			return {
				"item_code": row.item_code,
				"item_name": row.get("item_name") or row.item_code,
				"description": row.get("description") or row.get("item_name") or row.item_code,
			}

	from healthcare.api.inpatient_admission import _resolve_package_quotation_item

	try:
		info = _resolve_package_quotation_item(admission, service_unit)
	except Exception:
		return None
	if not info or not info.get("item_code"):
		return None
	return {
		"item_code": info["item_code"],
		"item_name": info.get("item_name") or info["item_code"],
		"description": info.get("item_name") or info["item_code"],
	}


def _make_standalone_package_sales_order(
	admission,
	*,
	days_to_charge: int,
	amount_per_day: float,
	item_code: str,
	item_name: str | None = None,
	description: str | None = None,
	note: str | None = None,
	quotation=None,
	as_of=None,
) -> str:
	"""Create a Sales Order for stay days without mapping from the Quotation.

	Used when the admission quotation qty is already exhausted (e.g. daily qty 1
	but the patient stayed many more days). Rate still comes from the package item.
	"""
	from healthcare.api.patient_file_no_charge import _ensure_patient_customer
	from healthcare.api.sales_order_cost_center import (
		apply_cost_center_to_sales_order,
		cost_center_from_visit_or_admission,
	)
	from healthcare.controllers.quotation import _copy_quotation_fields_to_sales_order

	patient = admission.patient
	if not patient:
		frappe.throw(_("Patient is required to create a package Sales Order."))

	customer = _ensure_patient_customer(patient)
	if quotation and quotation.get("quotation_to") == "Customer" and quotation.get("party_name"):
		customer = quotation.party_name

	company = (quotation.company if quotation else None) or admission.company or frappe.defaults.get_user_default(
		"Company"
	)
	if not company:
		frappe.throw(_("Company is required"))

	billing_date = getdate(as_of or today())
	rate = flt(amount_per_day)
	if rate <= 0:
		frappe.throw(_("Package daily rate must be greater than zero."))

	so = frappe.new_doc("Sales Order")
	so.company = company
	so.customer = customer
	so.patient = patient
	if so.meta.has_field("custom_patient"):
		so.custom_patient = patient
	if admission.get("patient_name") and so.meta.has_field("custom_patient_name"):
		so.custom_patient_name = admission.patient_name

	so.custom_reference_type = "Inpatient Admission"
	so.custom_reference_name = admission.name
	so.custom_base_reference = "Inpatient Admission"
	so.custom_base_reference_name = admission.name
	so.transaction_date = billing_date
	so.delivery_date = billing_date
	so.ignore_pricing_rule = 1

	if quotation:
		_copy_quotation_fields_to_sales_order(quotation, so)
		so.custom_base_reference = "Inpatient Admission"
		so.custom_base_reference_name = admission.name

	so.append(
		"items",
		{
			"item_code": item_code,
			"item_name": item_name or item_code,
			"qty": days_to_charge,
			"rate": rate,
			"price_list_rate": rate,
			"description": description,
			"delivery_date": billing_date,
		},
	)

	cc = cost_center_from_visit_or_admission("Inpatient Admission", admission.name)
	apply_cost_center_to_sales_order(so, cc)

	if note and so.meta.has_field("custom_notes"):
		so.custom_notes = note
	elif note and so.meta.has_field("remarks"):
		so.remarks = note

	so.flags.ignore_permissions = True
	so.flags.ignore_pricing_rule = True
	frappe.flags.mute_messages = True
	try:
		so.run_method("set_missing_values")
		so.run_method("calculate_taxes_and_totals")
		so.insert(ignore_permissions=True)
		so.submit()
	finally:
		frappe.flags.mute_messages = False
		frappe.clear_messages()

	return so.name


def _charge_package_days(
	admission: str,
	as_of: str | None = None,
	*,
	throw_if_nothing: bool = True,
	note: str | None = None,
	through_discharge: bool = False,
) -> dict | None:
	"""Create a Sales Order for unbilled package days through ``as_of``.

	When ``throw_if_nothing`` is False, missing package / unbilled days return None
	instead of raising (used by discharge catch-up).
	When ``through_discharge`` is True, days are counted from the day after the
	last Package Detail ``to_date`` through ``as_of``, and a standalone Sales Order
	is created at the package item rate (quotation remaining qty is ignored).
	When no Quotation exists for the current package (for example after a package
	change), a standalone Sales Order is created at the admission's current rate.
	"""
	admission = (admission or "").strip()
	if not admission or not frappe.db.exists("Inpatient Admission", admission):
		if throw_if_nothing:
			frappe.throw(_("Inpatient Admission not found"))
		return None

	adm = frappe.get_doc("Inpatient Admission", admission)
	if adm.status == "Cancelled":
		if throw_if_nothing:
			frappe.throw(_("Cannot charge package on a cancelled admission."))
		return None

	try:
		package_name = _resolve_package_name(adm)
	except Exception:
		if throw_if_nothing:
			raise
		return None

	package = frappe.get_doc("Inpatient Package", package_name)
	is_daily = _is_open_daily_package(adm, package)
	preview = _charge_window(
		adm,
		package,
		as_of=as_of,
		through_discharge=through_discharge or is_daily,
	)

	quotation = _find_admission_package_quotation(admission, package_name, allow_draft=True)
	# A package change only updates the admission; the previous package Quotation
	# stays linked to already-billed days. With no Quotation for the new package,
	# fall through to a standalone Sales Order at the admission's current rate.

	if not preview.get("can_charge"):
		if not throw_if_nothing:
			return None
		if cint(preview.get("days_to_charge") or 0) <= 0:
			frappe.throw(
				_(
					"No unbilled package days to charge. Elapsed: {0}, already billed: {1}, "
					"package length: {2}, quotation: {3}."
				).format(
					preview.get("days_elapsed"),
					preview.get("days_already_billed"),
					preview.get("program_days") or _("daily / open"),
					quotation.name if quotation else _("(none)"),
				)
			)
		if flt(preview.get("amount") or 0) <= 0:
			frappe.throw(_("Charge amount must be greater than zero."))
		frappe.throw(
			_("No package/room Item found to charge stay days for admission {0}.").format(admission)
		)

	days_to_charge = cint(preview["days_to_charge"])
	per_day = flt(preview["amount_per_day"])
	default_note = note or _(
		"Package charge to {0}: {1} day(s) @ {2} = {3}."
	).format(
		preview.get("to_date"),
		days_to_charge,
		per_day,
		preview.get("amount"),
	)

	def _standalone(days: int, from_date, to_date, so_note: str) -> str:
		item = _package_charge_item(adm, quotation, service_unit=preview.get("service_unit"))
		if not item:
			if not throw_if_nothing:
				return ""
			frappe.throw(
				_("No package/room Item found to charge stay days for admission {0}.").format(admission)
			)
		desc = (
			f"{item.get('description') or item.get('item_name') or 'Inpatient Package'} "
			f"— {days} day(s) @ {per_day}/day"
			f" ({from_date} to {to_date})"
		).strip()
		return _make_standalone_package_sales_order(
			adm,
			days_to_charge=days,
			amount_per_day=per_day,
			item_code=item["item_code"],
			item_name=item.get("item_name"),
			description=desc,
			note=so_note,
			quotation=quotation,
			as_of=to_date,
		)

	def _ledger(sales_order: str, days: int, from_date, to_date) -> None:
		try:
			record_partial_package_charge(
				quotation=quotation,
				sales_order=sales_order,
				days=days,
				amount=flt(per_day) * cint(days),
				amount_per_day=per_day,
				from_date=from_date,
				to_date=to_date,
				admission=admission,
				package=package_name,
			)
		except Exception:
			frappe.log_error(
				title=f"Package charge ledger (SOA) failed: {quotation.name if quotation else admission}"
			)

	from frappe.utils import add_days

	quote_remaining = cint(preview.get("quotation_remaining_days") or 0)
	use_standalone = through_discharge or not quotation or (is_daily and quote_remaining <= 0)

	sales_orders: list[str] = []
	if use_standalone:
		sales_order = _standalone(
			days_to_charge,
			preview.get("from_date"),
			preview.get("to_date"),
			default_note,
		)
		if not sales_order:
			return None
		sales_orders.append(sales_order)
		_ledger(sales_order, days_to_charge, preview.get("from_date"), preview.get("to_date"))
	else:
		# Submit draft quotation without auto full-SO (we create a partial SO below)
		if cint(quotation.docstatus) == 0:
			frappe.flags.healthcare_skip_package_auto_so = True
			try:
				quotation.flags.ignore_permissions = True
				quotation.flags.ignore_mandatory = True
				quotation.submit()
			finally:
				frappe.flags.healthcare_skip_package_auto_so = False
			quotation.reload()

		days_from_quote = days_to_charge
		days_beyond_quote = 0
		if is_daily and quote_remaining >= 0 and days_to_charge > quote_remaining:
			days_from_quote = quote_remaining
			days_beyond_quote = days_to_charge - quote_remaining

		if days_from_quote > 0:
			from_date = preview.get("from_date")
			to_date = (
				str(add_days(getdate(from_date), days_from_quote - 1))
				if from_date
				else preview.get("to_date")
			)
			sales_order = _make_partial_package_sales_order(
				quotation,
				days_to_charge=days_from_quote,
				amount_per_day=per_day,
				note=note
				or _(
					"Package charge to {0}: {1} day(s) @ {2} = {3} (partial from Quotation {4})."
				).format(
					to_date,
					days_from_quote,
					per_day,
					flt(per_day) * days_from_quote,
					quotation.name,
				),
			)
			sales_orders.append(sales_order)
			_ledger(sales_order, days_from_quote, from_date, to_date)

		if days_beyond_quote > 0:
			from_date = (
				str(add_days(getdate(preview.get("from_date")), days_from_quote))
				if preview.get("from_date")
				else preview.get("from_date")
			)
			to_date = preview.get("to_date")
			sales_order = _standalone(
				days_beyond_quote,
				from_date,
				to_date,
				_(
					"Daily room charge beyond Quotation {0}: {1} day(s) @ {2} ({3} to {4})."
				).format(
					quotation.name if quotation else _("(none)"),
					days_beyond_quote,
					per_day,
					from_date,
					to_date,
				),
			)
			sales_orders.append(sales_order)
			_ledger(sales_order, days_beyond_quote, from_date, to_date)

	billed_after = _days_already_billed(admission, package_name)
	quotation_name = quotation.name if quotation else None
	primary_so = sales_orders[-1] if sales_orders else None

	return {
		"ok": True,
		"quotation": quotation_name,
		"sales_order": primary_so,
		"sales_orders": sales_orders,
		"days_charged": days_to_charge,
		"amount": flt(per_day) * days_to_charge,
		"amount_per_day": per_day,
		"days_already_billed": billed_after,
		"remaining_days": (
			None
			if is_daily or not preview.get("program_days")
			else max(cint(preview.get("program_days") or 0) - billed_after, 0)
		),
		"from_date": preview.get("from_date"),
		"to_date": preview.get("to_date"),
		"message": _(
			"Charged {0} package day(s) for {1} via Sales Order {2}."
		).format(
			days_to_charge,
			flt(per_day) * days_to_charge,
			", ".join(sales_orders),
		),
	}


@frappe.whitelist()
def charge_package_to_today(admission: str, as_of: str | None = None) -> dict:
	"""Create a **partial** Sales Order for the unbilled package days up to today.

	Does **not** create a new Quotation. Uses the existing package Quotation when
	one exists; otherwise (for example after a package change) posts a standalone
	Sales Order at the admission's current package rate.
	"""
	_require_billing_user()
	return _charge_package_days(admission, as_of=as_of, throw_if_nothing=True)


def charge_pending_package_days_for_admission(admission: str, as_of: str | None = None) -> dict | None:
	"""Charge unbilled package/room days through ``as_of`` (discharge date).

	Used when discharge starts mid-stay so remaining package days from the last
	family payment through the discharge date are billed immediately. Creates a
	standalone Sales Order at the package item rate even if the quotation qty is
	exhausted. No-op when the admission has no package or no remaining unbilled days.
	"""
	as_of = getdate(as_of or today())
	return _charge_package_days(
		admission,
		as_of=as_of,
		throw_if_nothing=False,
		through_discharge=True,
		note=_(
			"Discharge package charge to {0}: remaining room/package days from last billed day through discharge."
		).format(as_of),
	)


def _make_partial_package_sales_order(
	quotation,
	*,
	days_to_charge: int,
	amount_per_day: float,
	note: str | None = None,
) -> str:
	"""Map existing Quotation → Sales Order with only ``days_to_charge`` on the package line."""
	from erpnext.selling.doctype.quotation.quotation import _make_sales_order
	from healthcare.controllers.quotation import (
		_copy_quotation_fields_to_sales_order,
		_set_default_delivery_date,
	)

	package_row = _package_line_from_quotation(quotation)
	if not package_row:
		frappe.throw(_("Quotation {0} has no package line to charge.").format(quotation.name))

	remaining = flt(package_row.qty) - flt(getattr(package_row, "ordered_qty", 0) or 0)
	if remaining <= 0:
		frappe.throw(
			_("Quotation {0} has no remaining package days to order (all {1} already ordered).").format(
				quotation.name, cint(package_row.qty)
			)
		)
	if days_to_charge > remaining + 0.0001:
		frappe.throw(
			_("Cannot charge {0} days — only {1} remain on Quotation {2}.").format(
				days_to_charge, cint(remaining), quotation.name
			)
		)

	# Only map the package line (partial). Case-management lines stay on the Quotation
	# until ordered separately / on full convert.
	sales_order = _make_sales_order(
		quotation.name,
		ignore_permissions=True,
		args={"filtered_children": [package_row.name]},
	)
	if not sales_order.get("items"):
		frappe.throw(_("Could not map package line from Quotation {0} to Sales Order.").format(quotation.name))

	# Cap qty to days_to_charge (mapper would take full remaining balance)
	rate = flt(amount_per_day) or flt(package_row.rate) or 0
	for row in sales_order.items:
		row.qty = days_to_charge
		if rate > 0:
			row.rate = rate
			row.price_list_rate = rate
		row.amount = flt(row.rate) * flt(row.qty)
		row.description = (
			f"{package_row.description or package_row.item_name or 'Inpatient Package'} "
			f"— charged {days_to_charge} day(s) @ {rate}/day"
		).strip()

	_copy_quotation_fields_to_sales_order(quotation, sales_order)
	_set_default_delivery_date(sales_order)

	if note and sales_order.meta.has_field("custom_notes"):
		sales_order.custom_notes = note
	elif note and sales_order.meta.has_field("remarks"):
		sales_order.remarks = note

	sales_order.flags.ignore_permissions = True
	sales_order.flags.ignore_pricing_rule = True
	# Avoid Stock Settings "auto insert Item Price" noise / masked errors on portal charge
	frappe.flags.mute_messages = True
	try:
		sales_order.run_method("set_missing_values")
		sales_order.run_method("calculate_taxes_and_totals")
		sales_order.insert(ignore_permissions=True)
		sales_order.submit()
	finally:
		frappe.flags.mute_messages = False
		frappe.clear_messages()

	return sales_order.name


def parse_package_days_from_quotation(quotation) -> int:
	"""Days on the package line: prefer item qty (days × daily rate), else '(N days)' in description."""
	items = quotation.get("items") or []
	for row in items:
		text = str(row.get("description") or row.get("item_name") or "")
		lower = text.lower()
		is_package_line = (
			"inpatient package" in lower
			or "/day" in lower
			or bool(re.search(r"\(\d+\s*days?", text, flags=re.IGNORECASE))
		)
		if not is_package_line and len(items) > 1:
			continue
		match = re.search(r"\((\d+)\s*days?", text, flags=re.IGNORECASE)
		if match:
			return cint(match.group(1))
		qty = cint(row.get("qty") or 0)
		if qty > 0 and (is_package_line or len(items) == 1):
			return qty
	return 0


def _package_line_from_quotation(quotation) -> Any:
	items = quotation.get("items") or []
	for row in items:
		text = str(row.get("description") or row.get("item_name") or "").lower()
		if "inpatient package" in text or "/day" in text:
			return row
	return items[0] if len(items) == 1 else None


def record_partial_package_charge(
	quotation,
	sales_order,
	*,
	days: int,
	amount: float,
	amount_per_day: float,
	from_date=None,
	to_date=None,
	admission: str | None = None,
	package: str | None = None,
) -> None:
	"""Ledger Package Detail for a stay charge (mapped or standalone Sales Order)."""
	admission = (
		admission
		or (getattr(quotation, "custom_inpatient_admission", None) if quotation else None)
		or ""
	).strip()
	package = (
		package or (getattr(quotation, "custom_package", None) if quotation else None) or ""
	).strip()
	if not admission or not package or days <= 0:
		return
	if not frappe.db.exists("Inpatient Admission", admission):
		return

	so_name = sales_order if isinstance(sales_order, str) else getattr(sales_order, "name", None)
	if so_name and frappe.db.has_column("Package Detail", "sales_order"):
		if frappe.db.exists("Package Detail", {"sales_order": so_name}):
			_sync_admission_days_billed(admission)
			return

	adm = frappe.get_doc("Inpatient Admission", admission)
	start = _admission_start_date(adm)
	if not start and quotation:
		start = getdate(quotation.transaction_date)
	from frappe.utils import add_days

	if from_date:
		fdate = getdate(from_date)
	else:
		already_before = max(_days_already_billed(admission, package) - days, 0)
		fdate = add_days(start, already_before) if start and already_before else start
	# Package Detail counts days inclusively, so end on the last covered day.
	# The Sales Order quantity is authoritative (the preview ``to_date`` is the
	# charge cut-off date, which can be one day after the last covered day).
	tdate = add_days(fdate, max(days - 1, 0))

	per_day = flt(amount_per_day) or (flt(amount) / days if days else 0)
	detail = frappe.new_doc("Package Detail")
	detail.company = (quotation.company if quotation else None) or adm.company
	detail.admission_no = admission
	detail.file_number = adm.patient
	detail.from_date = fdate
	detail.to_date = tdate
	detail.total_days = days
	detail.transaction_amount = flt(amount)
	detail.currency = (quotation.currency if quotation else None) or adm.get("currency")
	detail.vch_status = "Open"
	if quotation:
		detail.remarks = _("Stay charge from last billed day → Sales Order {0} (Quotation {1}).").format(
			so_name or "", quotation.name
		)
	else:
		detail.remarks = _("Stay charge from last billed day → Sales Order {0}.").format(so_name or "")
	if detail.meta.has_field("inpatient_package"):
		detail.inpatient_package = package
	if detail.meta.has_field("quotation") and quotation:
		detail.quotation = quotation.name
	if detail.meta.has_field("sales_order") and so_name:
		detail.sales_order = so_name
	if detail.meta.has_field("amount_per_day"):
		detail.amount_per_day = per_day
	detail.insert(ignore_permissions=True)
	_sync_admission_days_billed(admission)


def record_package_charge_from_quotation(quotation, sales_order=None) -> None:
	"""Ledger Package Detail after a (full) package Quotation → Sales Order.

	Used by the Quotation on_submit hook when auto-SO creates a full order.
	Partial mid-stay charges use ``record_partial_package_charge`` instead.
	"""
	admission = (getattr(quotation, "custom_inpatient_admission", None) or "").strip()
	package = (getattr(quotation, "custom_package", None) or "").strip()
	if not admission or not package:
		return
	if not frappe.db.exists("Inpatient Admission", admission):
		return

	days = parse_package_days_from_quotation(quotation)
	if days <= 0:
		days = cint(frappe.db.get_value("Inpatient Package", package, "no_of_days") or 0)
	if days <= 0:
		return

	# If this quotation already has any Package Detail (partial charges), don't
	# also ledger the full quotation amount — mid-stay flow owns the ledger.
	if frappe.db.has_column("Package Detail", "quotation") and frappe.db.exists(
		"Package Detail", {"quotation": quotation.name}
	):
		_sync_admission_days_billed(admission)
		return

	so_name = sales_order if isinstance(sales_order, str) else getattr(sales_order, "name", None)
	# Prefer SO qty when this is a mapped order
	so_days = days
	so_amount = None
	so_rate = None
	if so_name and frappe.db.exists("Sales Order", so_name):
		so_items = frappe.get_all(
			"Sales Order Item",
			filters={"parent": so_name},
			fields=["qty", "rate", "amount"],
			limit_page_length=5,
		)
		if so_items:
			so_days = cint(so_items[0].qty) or days
			so_amount = flt(so_items[0].amount)
			so_rate = flt(so_items[0].rate)

	package_line = _package_line_from_quotation(quotation)
	if so_amount is not None:
		amount = so_amount
		per_day = so_rate or (flt(amount) / so_days if so_days else 0)
		days = so_days
	elif package_line:
		amount = flt(package_line.get("amount") or 0)
		if amount <= 0:
			amount = flt(package_line.get("rate") or 0) * cint(package_line.get("qty") or days)
		per_day = flt(package_line.get("rate") or 0) or (flt(amount) / days if days else 0)
	else:
		amount = flt(quotation.grand_total or quotation.base_grand_total or 0)
		if amount <= 0:
			amount = sum(flt(r.amount) for r in (quotation.get("items") or []))
		per_day = flt(amount) / days if days else 0

	if so_name and frappe.db.has_column("Package Detail", "sales_order"):
		if frappe.db.exists("Package Detail", {"sales_order": so_name}):
			_sync_admission_days_billed(admission)
			return

	adm = frappe.get_doc("Inpatient Admission", admission)
	start = _admission_start_date(adm) or getdate(quotation.transaction_date)
	already_before = max(_days_already_billed(admission, package) - days, 0)
	from frappe.utils import add_days

	from_date = add_days(start, already_before) if already_before else start
	to_date = add_days(from_date, max(days - 1, 0))
	if not per_day:
		per_day = flt(amount) / days if days else 0

	detail = frappe.new_doc("Package Detail")
	detail.company = quotation.company or adm.company
	detail.admission_no = admission
	detail.file_number = adm.patient
	detail.from_date = from_date
	detail.to_date = to_date
	detail.total_days = days
	detail.transaction_amount = amount
	detail.currency = quotation.currency
	detail.vch_status = "Open"
	detail.remarks = _("From Quotation {0}").format(quotation.name)
	if detail.meta.has_field("inpatient_package"):
		detail.inpatient_package = package
	if detail.meta.has_field("quotation"):
		detail.quotation = quotation.name
	if detail.meta.has_field("sales_order") and so_name:
		detail.sales_order = so_name
	if detail.meta.has_field("amount_per_day"):
		detail.amount_per_day = per_day
	detail.insert(ignore_permissions=True)

	_sync_admission_days_billed(admission)


def _sync_admission_days_billed(admission_name: str) -> None:
	if not frappe.db.has_column("Inpatient Admission", "package_days_billed"):
		return
	total = (
		frappe.db.sql(
			"""
			SELECT COALESCE(SUM(total_days), 0)
			FROM `tabPackage Detail`
			WHERE admission_no = %s
			""",
			admission_name,
		)[0][0]
		or 0
	)
	frappe.db.set_value(
		"Inpatient Admission",
		admission_name,
		"package_days_billed",
		cint(total),
		update_modified=False,
	)
