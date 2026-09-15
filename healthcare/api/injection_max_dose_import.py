"""Import injection max-dose Excel into Item daily / long-acting dose fields.

Excel columns:
  Drug Registration Number | Medicine Name | Strength | Maximum Single Dose |
  Dosing Period | Maximum Dose Within Period | Other Dosing Remarks | Reference

Daily rows → custom_max_dose_per_single_dose + custom_max_dose_per_day
Long-acting / depot rows → long-acting Item fields (not max-per-day).
"""

from __future__ import annotations

import re
from typing import Any

import frappe
from frappe import _

from healthcare.api.patient_info_import import _cell_text, _excel_file_path, _require_admin

EXCEL_HEADER_MAP = {
	"DRUG_REGISTRATION_NUMBER": "drug_registration_number",
	"DRUG_REGISTRATION_NO": "drug_registration_number",
	"REGISTRATION_NUMBER": "drug_registration_number",
	"ITEM_CODE": "drug_registration_number",
	"MEDICINE_NAME": "medicine_name",
	"STRENGTH": "strength",
	"MAXIMUM_SINGLE_DOSE": "maximum_single_dose",
	"MAX_SINGLE_DOSE": "maximum_single_dose",
	"DOSING_PERIOD": "dosing_period",
	"MAXIMUM_DOSE_WITHIN_PERIOD": "maximum_dose_within_period",
	"MAX_DOSE_WITHIN_PERIOD": "maximum_dose_within_period",
	"OTHER_DOSING_REMARKS": "other_dosing_remarks",
	"REFERENCE": "reference",
}


def _normalize_header(cell: Any) -> str:
	if cell is None:
		return ""
	text = str(cell).strip().upper()
	for ch in ("?", "-", "(", ")", "/"):
		text = text.replace(ch, " ")
	text = "_".join(text.split())
	return EXCEL_HEADER_MAP.get(text, text.lower())


def _is_daily_period(period: str | None) -> bool:
	text = (period or "").strip().lower()
	if not text:
		return True
	# "Daily", "Daily (repeat >=4 h)", "Daily (severe), then 2-3x/week"
	return text.startswith("daily")


def _resolve_item(code: Any) -> str | None:
	raw = _cell_text(code)
	if not raw:
		return None
	if frappe.db.exists("Item", raw):
		return raw
	by_code = frappe.db.get_value("Item", {"item_code": raw}, "name")
	if by_code:
		return by_code
	# Soft match ignoring case / extra spaces
	return frappe.db.get_value("Item", {"item_code": ["like", raw]}, "name")


def _parse_sheet_rows(ws) -> list[dict]:
	rows_iter = ws.iter_rows(values_only=True)
	try:
		header_row = next(rows_iter)
	except StopIteration:
		return []

	headers = [_normalize_header(h) for h in header_row]
	parsed: list[dict] = []
	for raw in rows_iter:
		if not raw or all(cell is None or str(cell).strip() == "" for cell in raw):
			continue
		row: dict[str, Any] = {}
		for idx, key in enumerate(headers):
			if not key or idx >= len(raw):
				continue
			row[key] = raw[idx]
		code = _cell_text(row.get("drug_registration_number"))
		if not code:
			continue
		row["drug_registration_number"] = code
		parsed.append(row)
	return parsed


def _parse_excel_rows(file_url: str) -> tuple[list[dict], dict[str, int]]:
	try:
		import openpyxl
	except ImportError:
		frappe.throw(
			_(
				"openpyxl is required to read Excel files. Install it in the bench environment: pip install openpyxl"
			)
		)

	path = _excel_file_path(file_url)
	wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
	by_code: dict[str, dict] = {}
	sheet_row_counts: dict[str, int] = {}
	try:
		for sheet_name in wb.sheetnames:
			sheet_rows = _parse_sheet_rows(wb[sheet_name])
			sheet_row_counts[sheet_name] = len(sheet_rows)
			for row in sheet_rows:
				by_code[row["drug_registration_number"]] = row
	finally:
		wb.close()
	return list(by_code.values()), sheet_row_counts


def _preview_stats(rows: list[dict]) -> dict:
	matched = missing = daily = long_acting = 0
	missing_codes: list[str] = []
	for row in rows:
		period = _cell_text(row.get("dosing_period"))
		if _is_daily_period(period):
			daily += 1
		else:
			long_acting += 1
		if _resolve_item(row.get("drug_registration_number")):
			matched += 1
		else:
			missing += 1
			if len(missing_codes) < 10:
				missing_codes.append(row.get("drug_registration_number") or "")
	return {
		"matched_items": matched,
		"missing_items": missing,
		"daily_rows": daily,
		"long_acting_rows": long_acting,
		"sample_item_codes": [row.get("drug_registration_number") for row in rows[:5]],
		"sample_missing_codes": missing_codes,
	}


def _set_if_field(doc, fieldname: str, value: str | None) -> None:
	if not doc.meta.has_field(fieldname):
		return
	doc.set(fieldname, value or None)


def update_item_from_row(row: dict) -> dict:
	item_name = _resolve_item(row.get("drug_registration_number"))
	if not item_name:
		return {"status": "not_found", "item_code": row.get("drug_registration_number")}

	doc = frappe.get_doc("Item", item_name)
	single = _cell_text(row.get("maximum_single_dose"))
	period = _cell_text(row.get("dosing_period"))
	within = _cell_text(row.get("maximum_dose_within_period"))
	remarks = _cell_text(row.get("other_dosing_remarks"))

	if _is_daily_period(period):
		_set_if_field(doc, "custom_max_dose_per_single_dose", single)
		_set_if_field(doc, "custom_max_dose_per_day", within)
		# Clear LAI fields so daily items do not keep stale depot limits.
		_set_if_field(doc, "custom_maximum_single_dose_long_acting", None)
		_set_if_field(doc, "custom_dosing_period_long_acting", None)
		_set_if_field(doc, "custom_maximum_dose_within_the_period_long_acting", None)
		_set_if_field(doc, "custom_long_acting_dose_remarks", None)
		kind = "daily"
	else:
		_set_if_field(doc, "custom_maximum_single_dose_long_acting", single)
		_set_if_field(doc, "custom_dosing_period_long_acting", period)
		_set_if_field(doc, "custom_maximum_dose_within_the_period_long_acting", within)
		_set_if_field(doc, "custom_long_acting_dose_remarks", remarks)
		# Also keep shared single-dose field for Item form / non-LAI flows.
		_set_if_field(doc, "custom_max_dose_per_single_dose", single)
		# Do not write depot period totals into max-per-day (would allow daily use of weekly max).
		kind = "long_acting"

	doc.flags.ignore_validate = True
	doc.save(ignore_permissions=True)
	return {
		"status": "updated",
		"item_code": row.get("drug_registration_number"),
		"name": item_name,
		"kind": kind,
	}


@frappe.whitelist()
def preview_injection_max_dose_import(file_url: str) -> dict:
	_require_admin()
	if not (file_url or "").strip():
		frappe.throw(_("Please upload the injection max-dose Excel file."))

	rows, sheet_row_counts = _parse_excel_rows(file_url)
	stats = _preview_stats(rows)
	return {
		"excel_rows": len(rows),
		"raw_excel_rows": sum(sheet_row_counts.values()),
		"sheets": list(sheet_row_counts.keys()),
		"sheet_row_counts": sheet_row_counts,
		**stats,
	}


@frappe.whitelist()
def run_injection_max_dose_import(file_url: str) -> dict:
	"""Update Item dose fields from injection max-dose Excel."""
	_require_admin()
	if not (file_url or "").strip():
		frappe.throw(_("Please upload the injection max-dose Excel file."))

	rows, _ = _parse_excel_rows(file_url)
	updated = not_found = skipped = daily_updated = long_acting_updated = 0
	errors: list[str] = []

	for row in rows:
		try:
			result = update_item_from_row(row)
			status = result.get("status")
			if status == "updated":
				updated += 1
				if result.get("kind") == "long_acting":
					long_acting_updated += 1
				else:
					daily_updated += 1
			elif status == "not_found":
				not_found += 1
			else:
				skipped += 1
		except Exception:
			errors.append(f"{row.get('drug_registration_number')}: {frappe.get_traceback()}")
			frappe.log_error(title=f"Injection max-dose import failed: {row.get('drug_registration_number')}")

	frappe.db.commit()
	return {
		"ok": True,
		"total": len(rows),
		"updated": updated,
		"daily_updated": daily_updated,
		"long_acting_updated": long_acting_updated,
		"not_found": not_found,
		"skipped": skipped,
		"errors": len(errors),
	}


def dosing_period_to_days(period: str | None) -> int | None:
	"""Map Item dosing-period label to a rolling window in days."""
	text = (period or "").strip().lower()
	if not text or text.startswith("daily"):
		return None
	rules = [
		(r"6\s*months?", 180),
		(r"3\s*months?", 90),
		(r"fortnight|2\s*weeks?", 14),
		(r"course|<=\s*2\s*weeks|≤\s*2\s*weeks", 14),
		# Weekly max / 1–4 weeks before plain "4 weeks / monthly"
		(r"1\s*-\s*4\s*weeks|weekly\s*max|per\s*week|weekly", 7),
		(r"4\s*weeks|monthly|every\s*4\s*weeks|/\s*month", 28),
		(r"month", 28),
		(r"week", 7),
	]
	for pattern, days in rules:
		if re.search(pattern, text):
			return days
	return None
