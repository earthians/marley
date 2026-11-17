"""Import Oracle VISIT_00_04 (OP long-acting / injection) into Patient Medication Order + Long Acting Medicine."""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, time
from typing import Any

import frappe
from frappe import _
from frappe.utils import add_days, get_time, getdate, nowdate

from healthcare.api.lab_test_legacy_import import _resolve_patient_from_sub_dr
from healthcare.api.legacy_id_normalize import normalize_legacy_id
from healthcare.api.patient_medication_order import _long_acting_frequency_interval_days
from healthcare.api.patient_medication_order_import import (
	_cell_text,
	_clean_oracle_num,
	_file_path,
	_format_cr_datetime,
	_parse_date_value,
	_require_admin,
	_resolve_cost_center,
	_safe_savepoint_name,
	_submit_and_complete_pmo,
)
from healthcare.api.utils.api_utility import get_next_transaction_number

OP_INJECTION_IMPORT_BATCH_SIZE = 500
CACHE_TTL = 7200
CACHE_KEYS = {
	"file_url": "healthcare:data_migration:op_injection_import:file_url",
	"groups": "healthcare:data_migration:op_injection_import:groups",
	"group_keys": "healthcare:data_migration:op_injection_import:group_keys",
}

VISIT_00_04_HEADER_MAP = {
	"TRANS_NUM": "trans_num",
	"TRANS NO": "trans_num",
	"PATIENT_NUM": "patient_num",
	"PATIENT": "patient_num",
	"ACTING_DATE": "acting_date",
	"ACTING DATE": "acting_date",
	"RT_FLAG": "rt_flag",
	"LT_FLAG": "lt_flag",
	"MEDICATION": "medication",
	"DOSE": "dose",
	"FREQUENCY": "frequency",
	"STATUS": "status",
	"DOSE_TERM": "dose_term",
	"NEXT_DOSE": "next_dose",
	"REMARKS": "remarks",
	"CR_ID": "cr_id",
	"CR_DATE": "cr_date",
	"BRANCH_NUM": "branch",
	"BRANCH": "branch",
	"UP_ID": "up_id",
	"UP_DATE": "up_date",
	"NURSE_FLAG": "nurse_flag",
	"GIVEN_BY": "given_by",
	"GIVEN BY": "given_by",
	"GIVEN_BY_USER": "given_by",
	"IS_CANCELLED": "is_cancelled",
	"CANCELLED_REMARKS": "cancelled_remarks",
	"CANCELLED REMARKS": "cancelled_remarks",
	"CANCELLED_REASON": "cancelled_remarks",
	"CANCELLED REASON": "cancelled_remarks",
}

SHEET_MARKER_FIELDS = frozenset({"patient_num", "medication", "acting_date", "trans_num"})
LAM_FREQUENCY_OPTIONS = ("Weekly", "Biweekly", "Monthly", "Every 2 Months", "Every 3 Months")
UNDATED_SORT_KEY = getdate("9999-12-31")


def _row_effective_date(row: dict):
	"""Acting date from Excel, else CR_DATE fallback, else None."""
	if row.get("acting_date"):
		return getdate(row["acting_date"])
	fallback = _parse_date_value(row.get("cr_date"))
	return getdate(fallback) if fallback else None


def _group_acting_dates(lines: list[dict]) -> list:
	dates = [
		_row_effective_date(r)
		for r in lines
		if _row_effective_date(r) and not _is_cancelled_check(r)
	]
	if not dates:
		dates = [_row_effective_date(r) for r in lines if _row_effective_date(r)]
	return dates


def _group_date_range(lines: list[dict]) -> tuple[Any, Any]:
	dates = _group_acting_dates(lines)
	if not dates:
		return None, None
	return min(dates), max(dates)


def _sort_row_key(row: dict) -> tuple:
	effective = _row_effective_date(row)
	return (
		_is_cancelled_check(row),
		effective or UNDATED_SORT_KEY,
		_clean_oracle_num(row.get("trans_num")) or "",
	)


def _acting_time_from_value(value: Any, *, has_date: bool = True) -> str | None:
	if not has_date:
		return None
	if isinstance(value, datetime):
		return value.strftime("%H:%M:%S")
	if isinstance(value, time):
		return value.strftime("%H:%M:%S")
	text = _cell_text(value)
	if not text:
		return "08:00:00"
	try:
		return str(get_time(text))
	except Exception:
		return "08:00:00"


def _format_legacy_datetime(value: Any) -> str | None:
	if value in (None, ""):
		return None
	formatted = _format_cr_datetime(value, None)
	return formatted or _cell_text(value) or None


def _is_cancelled_check(row: dict) -> int:
	return 1 if _is_cancelled_row(row) else 0


def _give_out_fields(row: dict) -> dict:
	acting = _row_effective_date(row)
	trans_num = _clean_oracle_num(row.get("trans_num"))
	status = _cell_text(row.get("status"))
	remarks = _cell_text(row.get("remarks"))
	notes = remarks
	if not row.get("acting_date"):
		missing = "Missing ACTING_DATE"
		notes = f"{missing}{(' | ' + notes) if notes else ''}"
	if status and status.lower() not in ("completed",):
		notes = f"{status}{(' | ' + notes) if notes else ''}"

	fields = {
		"trans_no": trans_num or None,
		"dose": _cell_text(row.get("dose")) or None,
		"medication": _cell_text(row.get("medication")) or None,
		"rt_flag": _cell_text(row.get("rt_flag")) or None,
		"lt_flag": _cell_text(row.get("lt_flag")) or None,
		"written_frequency": _cell_text(row.get("frequency")) or None,
		"dose_term": _cell_text(row.get("dose_term")) or None,
		"next_dose": _cell_text(row.get("next_dose")) or None,
		"cr_id": _clean_oracle_num(row.get("cr_id")) or None,
		"cr_date": _format_legacy_datetime(row.get("cr_date")),
		"up_id": _clean_oracle_num(row.get("up_id")) or None,
		"up_date": _format_legacy_datetime(row.get("up_date")),
		"nurse_flag": _cell_text(row.get("nurse_flag")) or None,
		"is_cancelled": _is_cancelled_check(row),
		"cancelled_notes": _cell_text(row.get("cancelled_remarks")) or None,
		"notes": notes or None,
	}
	given_by = _cell_text(row.get("given_by")) or None
	if given_by:
		fields["user"] = given_by
	if acting:
		fields["date"] = acting
		fields["scheduled_run_date"] = acting
		fields["time"] = row.get("acting_time") or "08:00:00"
	return fields


def _normalize_header(value: Any) -> str:
	return VISIT_00_04_HEADER_MAP.get(str(value or "").strip().upper(), str(value or "").strip().lower())


def _normalize_medication_key(value: Any) -> str:
	return _cell_text(value).upper()


def _group_key(patient_num: str, medication: str) -> str:
	p = _clean_oracle_num(patient_num) or "__NO_PATIENT__"
	m = _normalize_medication_key(medication) or "__NO_MEDICATION__"
	return f"{p}|{m}"


def _is_cancelled_row(row: dict) -> bool:
	flag = _cell_text(row.get("is_cancelled")).upper()
	return flag in ("Y", "YES", "1", "TRUE")


def _is_completed_status(value: Any) -> bool:
	return _cell_text(value).lower() == "completed"


def _lam_status_for_lines(lines: list[dict]) -> str:
	"""Match Oracle Status: Completed on all active rows → LAM Completed."""
	relevant = [r for r in lines if not _is_cancelled_check(r)] or list(lines)
	if not relevant:
		return "Active"
	if all(_is_completed_status(r.get("status")) for r in relevant):
		return "Completed"
	return "Active"


def _apply_lam_status_from_lines(lam, lines: list[dict], *, end_dt=None) -> None:
	status = _lam_status_for_lines(lines)
	lam.status = status
	if status == "Completed":
		lam.next_run_date = None
	elif end_dt and lam.frequency:
		interval_days = _long_acting_frequency_interval_days(lam.frequency)
		lam.next_run_date = add_days(end_dt, interval_days)
	elif end_dt:
		lam.next_run_date = add_days(end_dt, _long_acting_frequency_interval_days(None))


def _normalize_legacy_frequency_text(raw: Any) -> str:
	return _cell_text(raw)


def _map_long_acting_frequency(raw: Any) -> str | None:
	"""Map Oracle FREQUENCY text to Long Acting Medicine Select options (when recognizable)."""
	label = _normalize_legacy_frequency_text(raw)
	if not label:
		return None

	lower = label.lower()
	compact = re.sub(r"[^a-z0-9]", "", lower)

	# Oracle shorthand: Q4W, Q2W, Q 4 weeks, etc.
	if compact in {"q4w", "q4weeks", "q4week"} or re.search(r"q4w", compact):
		return "Monthly"
	if re.search(r"q\s*4\s*w", lower) or "4 weeks" in lower or "4 week" in lower:
		return "Monthly"
	if compact in {"q2w", "q2weeks", "q2week"} or re.search(r"q2w", compact):
		return "Biweekly"
	if re.search(r"q\s*2\s*w", lower) or "2 weeks" in lower or "2 week" in lower or "every 2 week" in lower:
		return "Biweekly"
	if compact in {"q1w", "q1week"} or lower.strip() in {"1 week", "weekly"}:
		return "Weekly"
	if "biweek" in lower or "bi-week" in lower:
		return "Biweekly"
	if "2 month" in lower or "two month" in lower or compact == "q2m":
		return "Every 2 Months"
	if "3 month" in lower or "three month" in lower or compact == "q3m":
		return "Every 3 Months"
	if "month" in lower or compact == "month":
		return "Monthly"
	if "week" in lower:
		return "Weekly"

	for option in LAM_FREQUENCY_OPTIONS:
		if option.lower() == lower:
			return option

	# e.g. "as per dr AK", "after 25 days" — keep on written_frequency only
	return None


def _group_written_frequency(lines: list[dict]) -> str:
	"""Legacy Oracle FREQUENCY label for the parent Long Acting Medicine record."""
	values = [_normalize_legacy_frequency_text(r.get("frequency")) for r in lines]
	values = [v for v in values if v]
	if not values:
		return ""
	return Counter(values).most_common(1)[0][0]


def _group_long_acting_frequency(lines: list[dict]) -> str | None:
	"""Best mapped LAM Select frequency for a patient + medicine group."""
	mapped = [_map_long_acting_frequency(r.get("frequency")) for r in lines]
	mapped = [m for m in mapped if m]
	if not mapped:
		return None
	return Counter(mapped).most_common(1)[0][0]


def _apply_lam_frequency_fields(lam, lines: list[dict], entry=None) -> str | None:
	written = _group_written_frequency(lines)
	long_freq = _group_long_acting_frequency(lines)
	if not long_freq and entry:
		long_freq = getattr(entry, "long_acting_frequency", None) or None

	lam.written_frequency = written or None
	if long_freq:
		lam.frequency = long_freq
	return long_freq


def _default_company() -> str | None:
	return frappe.db.get_single_value("Global Defaults", "default_company")


def _resolve_patient(patient_num: str) -> str | None:
	key = _clean_oracle_num(patient_num)
	if not key:
		return None
	patient = _resolve_patient_from_sub_dr(key)
	if patient:
		return patient
	plain = normalize_legacy_id(key)
	if plain and plain != key:
		return _resolve_patient_from_sub_dr(plain)
	return None


def _parse_excel_rows(file_url: str) -> tuple[list[dict], int]:
	try:
		import openpyxl
	except ImportError:
		frappe.throw(
			_("openpyxl is required to read Excel files. Install it in the bench environment: pip install openpyxl")
		)

	path = _file_path(file_url)
	wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
	parsed: list[dict] = []
	skipped = 0

	for ws in wb.worksheets:
		rows_iter = ws.iter_rows(values_only=True)
		try:
			header_row = next(rows_iter)
		except StopIteration:
			continue
		if not header_row or not any(cell is not None and str(cell).strip() for cell in header_row):
			continue
		headers = [_normalize_header(h) for h in header_row]
		if not SHEET_MARKER_FIELDS.intersection({h for h in headers if h}):
			continue
		for raw in rows_iter:
			if not raw or all(cell is None or str(cell).strip() == "" for cell in raw):
				continue
			row: dict[str, Any] = {}
			for idx, key in enumerate(headers):
				if not key or idx >= len(raw):
					continue
				row[key] = raw[idx]
			patient_num = _clean_oracle_num(row.get("patient_num"))
			medication = _cell_text(row.get("medication"))
			row["patient_num"] = patient_num or ""
			row["medication"] = medication or ""
			row["trans_num"] = _clean_oracle_num(row.get("trans_num"))
			raw_acting = row.get("acting_date")
			row["acting_date"] = _parse_date_value(raw_acting)
			row["acting_time"] = _acting_time_from_value(raw_acting, has_date=bool(row["acting_date"]))
			parsed.append(row)

	wb.close()
	if not parsed:
		frappe.throw(
			_(
				"No VISIT_00_04 rows found. Expected columns such as PATIENT_NUM, MEDICATION, ACTING_DATE, TRANS_NUM."
			)
		)
	return parsed, skipped


def _group_rows(rows: list[dict]) -> dict[str, list[dict]]:
	grouped: dict[str, list[dict]] = {}
	for row in rows:
		key = _group_key(row["patient_num"], row["medication"])
		grouped.setdefault(key, []).append(row)
	for key in grouped:
		grouped[key].sort(key=_sort_row_key)
	return grouped


def _existing_pmo_for_group(
	patient: str | None,
	patient_num: str,
	medication_key: str,
) -> str | None:
	med = (medication_key or "").upper()
	med_empty = not med

	if patient:
		if med_empty:
			rows = frappe.db.sql(
				"""
				SELECT DISTINCT pmo.name
				FROM `tabPatient Medication Order` pmo
				INNER JOIN `tabInpatient Medication Order Entry` entry ON entry.parent = pmo.name
				WHERE pmo.patient = %(patient)s
				  AND pmo.care_context = 'Patient Visit'
				  AND pmo.docstatus = 1
				  AND IFNULL(entry.old_medicine_name, '') = ''
				  AND IFNULL(entry.medication, '') = ''
				ORDER BY pmo.creation DESC
				LIMIT 1
				""",
				{"patient": patient},
			)
		else:
			rows = frappe.db.sql(
				"""
				SELECT DISTINCT pmo.name
				FROM `tabPatient Medication Order` pmo
				INNER JOIN `tabInpatient Medication Order Entry` entry ON entry.parent = pmo.name
				WHERE pmo.patient = %(patient)s
				  AND pmo.care_context = 'Patient Visit'
				  AND pmo.docstatus = 1
				  AND (
					UPPER(IFNULL(entry.old_medicine_name, '')) = %(med)s
					OR UPPER(IFNULL(entry.medication, '')) = %(med)s
				  )
				ORDER BY pmo.creation DESC
				LIMIT 1
				""",
				{"patient": patient, "med": med},
			)
		return rows[0][0] if rows else None

	patient_num = _clean_oracle_num(patient_num)
	if patient_num:
		if med_empty:
			rows = frappe.db.sql(
				"""
				SELECT DISTINCT pmo.name
				FROM `tabPatient Medication Order` pmo
				INNER JOIN `tabInpatient Medication Order Entry` entry ON entry.parent = pmo.name
				WHERE (pmo.patient IS NULL OR pmo.patient = '')
				  AND pmo.care_context = 'Patient Visit'
				  AND pmo.docstatus = 1
				  AND IFNULL(pmo.user_name, '') = %(patient_num)s
				  AND IFNULL(entry.old_medicine_name, '') = ''
				  AND IFNULL(entry.medication, '') = ''
				ORDER BY pmo.creation DESC
				LIMIT 1
				""",
				{"patient_num": patient_num},
			)
		else:
			rows = frappe.db.sql(
				"""
				SELECT DISTINCT pmo.name
				FROM `tabPatient Medication Order` pmo
				INNER JOIN `tabInpatient Medication Order Entry` entry ON entry.parent = pmo.name
				WHERE (pmo.patient IS NULL OR pmo.patient = '')
				  AND pmo.care_context = 'Patient Visit'
				  AND pmo.docstatus = 1
				  AND IFNULL(pmo.user_name, '') = %(patient_num)s
				  AND (
					UPPER(IFNULL(entry.old_medicine_name, '')) = %(med)s
					OR UPPER(IFNULL(entry.medication, '')) = %(med)s
				  )
				ORDER BY pmo.creation DESC
				LIMIT 1
				""",
				{"patient_num": patient_num, "med": med},
			)
		return rows[0][0] if rows else None

	if med_empty:
		rows = frappe.db.sql(
			"""
			SELECT DISTINCT pmo.name
			FROM `tabPatient Medication Order` pmo
			INNER JOIN `tabInpatient Medication Order Entry` entry ON entry.parent = pmo.name
			WHERE (pmo.patient IS NULL OR pmo.patient = '')
			  AND pmo.care_context = 'Patient Visit'
			  AND pmo.docstatus = 1
			  AND IFNULL(pmo.user_name, '') = ''
			  AND IFNULL(entry.old_medicine_name, '') = ''
			  AND IFNULL(entry.medication, '') = ''
			ORDER BY pmo.creation DESC
			LIMIT 1
			""",
		)
	else:
		rows = frappe.db.sql(
			"""
			SELECT DISTINCT pmo.name
			FROM `tabPatient Medication Order` pmo
			INNER JOIN `tabInpatient Medication Order Entry` entry ON entry.parent = pmo.name
			WHERE (pmo.patient IS NULL OR pmo.patient = '')
			  AND pmo.care_context = 'Patient Visit'
			  AND pmo.docstatus = 1
			  AND IFNULL(pmo.user_name, '') = ''
			  AND (
				UPPER(IFNULL(entry.old_medicine_name, '')) = %(med)s
				OR UPPER(IFNULL(entry.medication, '')) = %(med)s
			  )
			ORDER BY pmo.creation DESC
			LIMIT 1
			""",
			{"med": med},
		)
	return rows[0][0] if rows else None


def _entry_for_medication(pmo_name: str, medication_key: str):
	doc = frappe.get_doc("Patient Medication Order", pmo_name)
	target = (medication_key or "").upper()
	for entry in doc.get("medication_orders") or []:
		name = _normalize_medication_key(
			getattr(entry, "old_medicine_name", None) or entry.medication or ""
		)
		if name == target:
			return entry
	return None


def _lam_for_entry(entry_name: str) -> str | None:
	return frappe.db.get_value(
		"Subscription Medication Plan Item",
		{"medication_order_entry": entry_name, "parenttype": "Long Acting Medicine"},
		"parent",
	)


def _existing_lam_trans_nums(lam_name: str) -> set[str]:
	nums: set[str] = set()
	for row in frappe.get_all(
		"Long Acting Medicine Give Out",
		filters={"parent": lam_name},
		fields=["trans_no"],
	):
		trans = _clean_oracle_num(row.get("trans_no"))
		if trans:
			nums.add(trans)
	return nums


def _ensure_dosage_form_injection() -> str | None:
	"""Prefer Pharmaceutical Form (prescription / plan-item Link target)."""
	if frappe.db.exists("Pharmaceutical Form", "Injection"):
		return "Injection"
	if frappe.db.exists("DocType", "Pharmaceutical Form"):
		try:
			frappe.get_doc(
				{"doctype": "Pharmaceutical Form", "pharmaceutical_form": "Injection"}
			).insert(ignore_permissions=True)
			return "Injection"
		except Exception:
			pass
	if frappe.db.exists("Dosage Form", "Injection"):
		return "Injection"
	return None


def _append_pmo_child(doc, lines: list[dict]) -> None:
	first = lines[0]
	medication = _cell_text(first.get("medication"))
	start_dt, end_dt = _group_date_range(lines)
	written_freq = _group_written_frequency(lines)
	long_freq = _group_long_acting_frequency(lines)

	if long_freq:
		from healthcare.api.common import ensure_prescription_frequency_for_long_acting

		ensure_prescription_frequency_for_long_acting(long_freq)

	entry = doc.append("medication_orders", {})
	if medication:
		entry.medication = medication
		entry.old_medicine_name = medication
	entry.dosage = _cell_text(first.get("dose")) or None
	entry.dosage_form = _ensure_dosage_form_injection()
	if start_dt:
		entry.date = start_dt
	if end_dt:
		entry.end_date = end_dt
	entry.time = first.get("acting_time") or "08:00:00"
	entry.is_long_acting_medicine = 1
	entry.medication_type = "Long Acting Medicine"
	if long_freq and frappe.db.has_column("Inpatient Medication Order Entry", "long_acting_frequency"):
		entry.long_acting_frequency = long_freq
	if long_freq:
		entry.patient_frequency = long_freq
	entry.written_frequency = written_freq or None
	entry.dose_term = _cell_text(first.get("dose_term")) or None
	entry.effective_status = _cell_text(first.get("status")) or None
	entry.is_completed = 1 if _is_completed_status(first.get("status")) else 0
	entry.reference_no = _clean_oracle_num(first.get("trans_num")) or None
	entry.cr_id = _clean_oracle_num(first.get("cr_id")) or None


def _create_lam_with_give_outs(
	pmo_doc,
	entry,
	lines: list[dict],
	*,
	existing_trans_nums: set[str] | None = None,
) -> tuple[str | None, int]:
	existing_trans_nums = existing_trans_nums or set()
	start_dt, end_dt = _group_date_range(lines)
	written_freq = _group_written_frequency(lines)
	long_freq = _group_long_acting_frequency(lines) or getattr(entry, "long_acting_frequency", None)
	interval_days = _long_acting_frequency_interval_days(long_freq)
	next_run = add_days(end_dt, interval_days) if end_dt else None

	lam = frappe.new_doc("Long Acting Medicine")
	lam.naming_series = "SMP-.YYYY.-"
	lam.patient = pmo_doc.patient
	lam.patient_name = pmo_doc.get("patient_name")
	lam.practitioner = pmo_doc.get("practitioner")
	lam.company = pmo_doc.company
	lam.written_frequency = written_freq or None
	entry_uom = (entry.uom or "").strip() or None
	if entry_uom and not frappe.db.exists("UOM", entry_uom):
		entry_uom = None
	if long_freq:
		lam.frequency = long_freq
	if start_dt:
		lam.start_date = start_dt
	if end_dt:
		lam.end_date = end_dt
	if next_run and _lam_status_for_lines(lines) != "Completed":
		lam.next_run_date = next_run

	lam.append(
		"medications",
		{
			"medication_order_entry": entry.name,
			"drug": entry.drug,
			"drug_name": entry.drug_name or entry.medication or entry.old_medicine_name,
			"old_medication_name": entry.old_medicine_name or entry.medication,
			"dosage": entry.dosage,
			"uom": entry_uom,
			"dosage_form": entry.dosage_form,
			"instructions": entry.instructions or "",
			"patient_frequency": entry.patient_frequency,
			"date": entry.date,
			"time": entry.time or "08:00:00",
			"qty_per_cycle": 1,
			"is_active": 1,
		},
	)

	added = 0
	for row in lines:
		trans_num = _clean_oracle_num(row.get("trans_num"))
		if trans_num and trans_num in existing_trans_nums:
			continue
		lam.append("give_outs", _give_out_fields(row))
		if trans_num:
			existing_trans_nums.add(trans_num)
		added += 1

	if added == 0:
		return None, 0

	_apply_lam_status_from_lines(lam, lines, end_dt=end_dt)
	lam.flags.ignore_mandatory = True
	lam.insert(ignore_permissions=True)
	lam.submit()
	return lam.name, added


def _append_give_outs_to_lam(lam_name: str, lines: list[dict], existing_trans_nums: set[str]) -> int:
	lam = frappe.get_doc("Long Acting Medicine", lam_name)
	added = 0
	_, end_dt = _group_date_range(lines)
	for row in lines:
		trans_num = _clean_oracle_num(row.get("trans_num"))
		if trans_num and trans_num in existing_trans_nums:
			continue
		lam.append("give_outs", _give_out_fields(row))
		if trans_num:
			existing_trans_nums.add(trans_num)
		added += 1

	if added == 0:
		return 0

	if end_dt:
		if not lam.end_date or getdate(lam.end_date) < end_dt:
			lam.end_date = end_dt

	_apply_lam_frequency_fields(lam, lines)

	_apply_lam_status_from_lines(lam, lines, end_dt=end_dt)

	lam.flags.ignore_permissions = True
	lam.save(ignore_permissions=True)
	return added


def import_op_injection_group(group_key: str, lines: list[dict]) -> dict:
	if not lines:
		return {"status": "skip_empty", "group_key": group_key}

	first = lines[0]
	patient_num = first.get("patient_num") or ""
	medication_key = _normalize_medication_key(first.get("medication"))
	patient = _resolve_patient(patient_num) if patient_num else None

	patient_row = {}
	if patient:
		patient_row = frappe.db.get_value(
			"Patient",
			patient,
			["patient_name"],
			as_dict=True,
		) or {}
	company = _default_company()
	if not company:
		return {"status": "skip_no_company", "group_key": group_key, "patient": patient}

	start_dt, end_dt = _group_date_range(lines)

	existing_pmo = _existing_pmo_for_group(patient, patient_num, medication_key)
	created_pmo = False
	created_lam = False
	give_outs_added = 0

	if existing_pmo:
		pmo_doc = frappe.get_doc("Patient Medication Order", existing_pmo)
		entry = _entry_for_medication(existing_pmo, medication_key)
		if not entry:
			return {"status": "skip_no_entry_on_pmo", "group_key": group_key, "pmo": existing_pmo}

		lam_name = _lam_for_entry(entry.name)
		existing_trans = _existing_lam_trans_nums(lam_name) if lam_name else set()
		if lam_name:
			give_outs_added = _append_give_outs_to_lam(lam_name, lines, existing_trans)
		else:
			lam_name, give_outs_added = _create_lam_with_give_outs(
				pmo_doc, entry, lines, existing_trans_nums=existing_trans
			)
			created_lam = bool(lam_name)

		if give_outs_added == 0:
			return {
				"status": "skip_no_new_giveouts",
				"group_key": group_key,
				"pmo": existing_pmo,
				"lam": lam_name,
			}

		if end_dt and (not pmo_doc.end_date or getdate(pmo_doc.end_date) < end_dt):
			pmo_doc.end_date = end_dt
			pmo_doc.flags.ignore_permissions = True
			pmo_doc.save(ignore_permissions=True)

		return {
			"status": "ok",
			"group_key": group_key,
			"pmo": existing_pmo,
			"lam": lam_name,
			"created_pmo": False,
			"created_lam": created_lam,
			"give_outs_added": give_outs_added,
		}

	doc = frappe.new_doc("Patient Medication Order")
	doc.trans_no = get_next_transaction_number("Patient Medication Order", fieldname="trans_no")
	doc.care_context = "Patient Visit"
	doc.patient = patient
	doc.patient_name = patient_row.get("patient_name")
	if patient_num and not patient:
		doc.user_name = patient_num
	doc.company = company
	doc.practitioner = None
	doc.posting_date = start_dt or nowdate()
	if start_dt:
		doc.start_date = start_dt
	if end_dt:
		doc.end_date = end_dt
	doc.time = first.get("acting_time") or "08:00:00"
	doc.cost_center = _resolve_cost_center(_cell_text(first.get("branch")))
	doc.effective_status = _cell_text(first.get("status")) or None
	doc.flags.ignore_mandatory = True
	created_pmo = True

	_append_pmo_child(doc, lines)
	if not doc.get("medication_orders"):
		return {"status": "skip_no_lines", "group_key": group_key}

	_submit_and_complete_pmo(doc)
	doc.reload()
	entry = _entry_for_medication(doc.name, medication_key)
	if not entry:
		return {"status": "skip_no_entry_after_save", "group_key": group_key, "pmo": doc.name}

	lam_name, give_outs_added = _create_lam_with_give_outs(doc, entry, lines)
	created_lam = bool(lam_name)

	return {
		"status": "ok",
		"group_key": group_key,
		"pmo": doc.name,
		"lam": lam_name,
		"created_pmo": created_pmo,
		"created_lam": created_lam,
		"give_outs_added": give_outs_added,
		"patient": patient,
		"medication": medication_key,
	}


def parse_and_cache_file(file_url: str) -> dict:
	rows, skipped = _parse_excel_rows(file_url)
	grouped = _group_rows(rows)
	group_keys = sorted(grouped.keys())

	frappe.cache().set_value(CACHE_KEYS["file_url"], file_url, expires_in_sec=CACHE_TTL)
	frappe.cache().set_value(CACHE_KEYS["group_keys"], group_keys, expires_in_sec=CACHE_TTL)
	frappe.cache().set_value(
		CACHE_KEYS["groups"],
		json.dumps(grouped, default=str),
		expires_in_sec=CACHE_TTL,
	)

	resolvable = 0
	for key in group_keys:
		lines = grouped[key]
		patient_num = lines[0].get("patient_num") if lines else ""
		if patient_num and _resolve_patient(patient_num):
			resolvable += 1

	return {
		"file_rows": len(rows) + skipped,
		"medicine_groups": len(group_keys),
		"give_out_lines": len(rows),
		"skipped_rows": skipped,
		"rows_without_acting_date": sum(1 for r in rows if not r.get("acting_date")),
		"cancelled_give_out_lines": sum(1 for r in rows if _is_cancelled_check(r)),
		"patient_linked_groups": resolvable,
		"resolvable_groups": len(group_keys),
	}


def _load_cached_groups() -> dict[str, list[dict]]:
	raw = frappe.cache().get_value(CACHE_KEYS["groups"])
	if not raw:
		return {}
	if isinstance(raw, dict):
		return raw
	return json.loads(raw)


@frappe.whitelist()
def preview_op_injection_prescription_import(file_url: str) -> dict:
	_require_admin()
	return parse_and_cache_file(file_url)


def run_op_injection_prescription_import_batch(offset: int = 0) -> dict:
	group_keys = frappe.cache().get_value(CACHE_KEYS["group_keys"]) or []
	grouped = _load_cached_groups()
	if not group_keys or not grouped:
		return {"processed": offset, "done": True, "batch_count": 0}

	batch_keys = group_keys[offset : offset + OP_INJECTION_IMPORT_BATCH_SIZE]
	if not batch_keys:
		return {"processed": offset, "done": True, "batch_count": 0}

	ok = skip_no_patient = skip_no_new = skip_other = 0
	errors: list[str] = []

	for key in batch_keys:
		lines = grouped.get(key) or []
		savepoint = _safe_savepoint_name("op_inj_import", key)
		try:
			frappe.db.savepoint(savepoint)
			result = import_op_injection_group(key, lines)
			status = result.get("status")
			if status == "ok":
				ok += 1
			elif status == "skip_no_patient":
				skip_no_patient += 1
			elif status == "skip_no_new_giveouts":
				skip_no_new += 1
			else:
				skip_other += 1
		except Exception:
			frappe.db.rollback(save_point=savepoint)
			errors.append(f"{key}: {frappe.get_traceback()}")
			frappe.log_error(title=f"OP Injection Prescription import failed: {key}")

	frappe.db.commit()
	processed = offset + len(batch_keys)
	return {
		"processed": processed,
		"done": len(batch_keys) < OP_INJECTION_IMPORT_BATCH_SIZE,
		"batch_count": len(batch_keys),
		"ok": ok,
		"skip_no_patient": skip_no_patient,
		"skip_no_new_giveouts": skip_no_new,
		"skip_other": skip_other,
		"errors": errors[:5],
	}
