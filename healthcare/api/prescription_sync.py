"""One-button Oracle -> ERPNext prescription reconciliation (OP and IP).

This is the prescription counterpart of ``healthcare.api.oracle_sync`` (the
``IP Admission`` button): it reads the legacy prescriptions straight from the
Oracle database that is already configured for the site, compares them with the
Patient Medication Orders in ERPNext and repairs whatever does not match. No
workbook has to be uploaded. Leave Patient empty to compare the whole site, or
pick one patient to repair only that patient's OP / HIS / IP prescriptions.

What one run does
-----------------
1. **OP** - ``PATIENT_VISIT_PRESCRIPTION`` is the source of truth for outpatient
   prescriptions. Every visit is compared with the ``patient_visit_prescription``
   Patient Medication Order of that visit (``visit_cd`` / ``patient_encounter``).
   A visit with no prescription is created, a visit with missing lines gets just
   those lines appended, a complete visit is left alone.
2. **HS table** - ``PATIENT_VISIT_PRESCRIPTION_HIS`` is imported as its own
   Patient Medication Order transactions (``patient_visit_prescription_his = 1``).
   Every HIS row is kept in the backend. A ``PRESCIP_ID`` that
   ``PATIENT_VISIT_PRESCRIPTION`` also has is a re-prescription repeat: the line
   is still created and the child ``is_deduplicate`` checkbox is ticked so
   Healthcare Settings → Hide Deduplicate Prescription can hide it on the UI.
   A ``PRESCIP_ID`` only the HS table has is imported the same way with
   ``is_deduplicate = 0``. HIS prescriptions are never deleted by this button.
3. **IP** - ``IP_ADMISSION_MEDICINE`` is compared with the ``reference_no``
   (= legacy ``TRANS_NUM``) of the admission's prescription; missing lines are
   created through the regular importer, depot / long-acting lines included
   (``Long Acting Medicine`` records are created for them). A prescription that
   already exists only grows: the submitted header is never rewritten, so the
   lines Oracle added after the first import (the newest admission, typically
   the discharge prescriptions) are appended to it instead of being refused.

Existing OP / IP prescriptions are never reset. HIS visit prescriptions are
rebuilt from Oracle so every HIS row (including repeats of the same
``PRESCIP_ID``) lands once per run. Running the button again only finds and
fixes what is still missing.

Execution model
---------------
The run is a self-chaining background job on the ``long`` queue: it works through
the visits / admissions in chunks, commits after each chunk, keeps its progress
in the cache (polled by the settings dialog) and re-enqueues itself until the
work list is exhausted, so a site with tens of thousands of visits does not need
one enormous request or worker timeout.

Usage::

    bench --site <site> execute healthcare.api.prescription_sync.start_prescription_reconcile
    bench --site <site> execute healthcare.api.prescription_sync.get_prescription_reconcile_status
    # inline (no queue), handy for a first smoke test on a real site:
    bench --site <site> execute healthcare.api.prescription_sync.run_prescription_reconcile --kwargs "{'limit': 50}"
"""

from __future__ import annotations

import time
from typing import Any, Iterable

import frappe
from frappe import _
from frappe.utils import cint, now_datetime

from healthcare.api.ip_medication_cleanup import (
	_admission_fields,
	_create_missing_long_acting_medicines,
	_existing_reference_nos,
	_pmo_line_keys,
	_prepare_long_acting_rows,
	_resolve_admission,
	_row_key,
)
from healthcare.api.op_prescription_cleanup import (
	_apply_imports,
	_build_coverage,
	_build_import_plan,
	_normalize_code,
	_resolve_import_patients,
)
from healthcare.api.oracle_excel_source import current_source, excel_source, normalize_files
from healthcare.api.oracle_sync import _fetch_rows, _in_clause, _oracle_schema, _query
from healthcare.api.patient_info_import import _require_admin
from healthcare.api.patient_medication_order_import import (
	ORACLE_HEADER_MAP,
	_clean_oracle_num,
	_group_rows_by_admission,
	_prepare_import_row,
	_safe_savepoint_name,
	import_patient_medication_order_for_admission,
)
from healthcare.api.patient_visit_prescription_common import _bulk_visit_links
from healthcare.api.patient_visit_prescription_his_import import (
	import_patient_medication_order_for_visit as import_his_visit_prescription,
)
from healthcare.api.patient_visit_prescription_import import (
	EXCEL_HEADER_MAP,
	_group_rows_by_visit,
	_prepare_line_row,
)

JOB_KEY = "prescription_reconcile"
PROGRESS_KEY = "healthcare:prescription_reconcile:progress"
WORK_KEY = "healthcare:prescription_reconcile:work"
LOCK_KEY = "healthcare:prescription_reconcile:lock"
PROGRESS_TTL = 60 * 60 * 12
LOCK_TTL = 60 * 60 * 6

OP_TABLE = "PATIENT_VISIT_PRESCRIPTION"
IP_TABLE = "IP_ADMISSION_MEDICINE"
# Live CLINIC2 keeps the patient on the admission header, not on the medicine rows.
IP_ADMISSION_TABLE = "IP_ADMISSION_01"
# Every row of this table becomes a Patient Medication Order line on a
# ``patient_visit_prescription_his`` prescription. Rows whose PRESCRIP_ID also
# exists on OP_TABLE are kept and flagged ``is_deduplicate`` on the child line.
HS_TABLE = "PATIENT_VISIT_PRESCRIPTION_HIS"
# The tables an Excel upload has to provide (direct reads ignore this list).
ORACLE_TABLES = [OP_TABLE, HS_TABLE, IP_TABLE]

# One Oracle query + a handful of ERPNext queries per chunk. Small enough to stay
# fast (and to keep the commit small), large enough to amortise the round trips.
OP_CHUNK = 300
IP_CHUNK = 50

# A worker that has queued for longer than this hands the rest over to a fresh
# job instead of risking the RQ timeout.
TIME_BUDGET = 20 * 60

SAMPLE_LIMIT = 15
ERROR_LIMIT = 5



# ---------------------------------------------------------------------------
# Progress, work list and lock
# ---------------------------------------------------------------------------


def _set_progress(progress: dict) -> None:
	progress["updated_at"] = str(now_datetime())
	frappe.cache().set_value(PROGRESS_KEY, progress, expires_in_sec=PROGRESS_TTL)


def _load_progress() -> dict:
	return frappe.cache().get_value(PROGRESS_KEY) or {}


def _set_work(work: dict) -> None:
	frappe.cache().set_value(WORK_KEY, work, expires_in_sec=PROGRESS_TTL)


def _load_work() -> dict:
	return frappe.cache().get_value(WORK_KEY) or {}


def _lock_key() -> str:
	"""Redis key scoped to the site (``frappe.cache().set`` does not add the db prefix)."""
	db_name = (frappe.local.conf or {}).get("db_name") or frappe.local.site
	return f"{db_name}|{LOCK_KEY}"


def _acquire_lock() -> str | None:
	token = frappe.generate_hash(length=12)
	if not frappe.cache().set(_lock_key(), token.encode(), nx=True, ex=LOCK_TTL):
		return None
	return token


def _owns_lock(token: str | None) -> bool:
	if not token:
		return False
	return (frappe.cache().get(_lock_key()) or b"").decode() == token


def _refresh_lock(token: str) -> None:
	frappe.cache().set(_lock_key(), token.encode(), ex=LOCK_TTL)


def _release_lock(token: str | None) -> None:
	if _owns_lock(token):
		frappe.cache().delete(_lock_key())


def _lock_held() -> bool:
	return bool(frappe.cache().get(_lock_key()))


def _new_progress() -> dict:
	stamp = str(now_datetime())
	return {
		"job_key": JOB_KEY,
		"state": "queued",
		"phase": "op",
		"processed": 0,
		"total": 0,
		"visit_index": 0,
		"admission_index": 0,
		# OP (PATIENT_VISIT_PRESCRIPTION)
		"op_visits": 0,
		"op_complete_visits": 0,
		"op_missing_visits": 0,
		"op_partial_visits": 0,
		"op_missing_lines": 0,
		"op_created": 0,
		"op_updated": 0,
		"op_skipped": 0,
		"op_added_lines": 0,
		"op_unresolved_visits": 0,
		# HS table (PATIENT_VISIT_PRESCRIPTION_HIS) - imported as HIS transactions
		"op_hs_visits": 0,
		"op_hs_lines": 0,
		"op_hs_deduplicate_lines": 0,
		"op_hs_created": 0,
		"op_hs_updated": 0,
		"op_hs_skipped": 0,
		"op_hs_unresolved_visits": 0,
		# IP (IP_ADMISSION_MEDICINE)
		"ip_admissions": 0,
		"ip_complete_admissions": 0,
		"ip_gap_admissions": 0,
		"ip_missing_lines": 0,
		"ip_created": 0,
		"ip_completed": 0,
		"ip_skipped": 0,
		"ip_added_lines": 0,
		"ip_long_acting_created": 0,
		"ip_unresolved_admissions": 0,
		"ip_unresolved_rows": 0,
		# Outcome
		"failed": 0,
		"errors": [],
		"samples": [],
		"started_at": stamp,
		"updated_at": stamp,
	}


def _record_samples(progress: dict, samples: Iterable[str]) -> None:
	room = SAMPLE_LIMIT - len(progress.get("samples") or [])
	if room <= 0:
		return
	for sample in samples or []:
		if room <= 0:
			break
		text = str(sample or "").strip()
		if not text:
			continue
		progress.setdefault("samples", []).append(text)
		room -= 1


def _record_errors(progress: dict, errors: Iterable[str]) -> None:
	for error in errors or []:
		text = str(error or "").strip()
		if not text:
			continue
		progress["failed"] = cint(progress.get("failed")) + 1
		if len(progress.get("errors") or []) < ERROR_LIMIT:
			progress.setdefault("errors", []).append(text[:800])


# ---------------------------------------------------------------------------
# Oracle rows -> importer rows
# ---------------------------------------------------------------------------


def _map_op_rows(raw_rows: Iterable[dict]) -> list[dict]:
	"""Oracle PVP rows as the rows ``patient_visit_prescription_import`` expects."""
	rows: list[dict] = []
	for raw in raw_rows or []:
		row = {EXCEL_HEADER_MAP.get(name, (name or "").lower()): value for name, value in raw.items()}
		prepared = _prepare_line_row(row)
		if prepared:
			rows.append(prepared)
	return rows


def _map_ip_rows(raw_rows: Iterable[dict]) -> list[dict]:
	"""Oracle IP_ADMISSION_MEDICINE rows as the rows the IP importer expects."""
	rows: list[dict] = []
	for raw in raw_rows or []:
		row = {ORACLE_HEADER_MAP.get(name, (name or "").lower()): value for name, value in raw.items()}
		prepared = _prepare_import_row(row)
		if prepared:
			rows.append(prepared)
	return rows


def _op_rows_for_chunk(visit_cds: list[str]) -> list[dict]:
	if not visit_cds:
		return []
	return _map_op_rows(
		_fetch_rows(
			OP_TABLE,
			where=f"VISIT_CD in ({_in_clause(visit_cds)})",
			order_by="VISIT_CD, PRESCRIP_ID",
		)
	)


def _ip_rows_for_chunk(admission_keys: list[str]) -> list[dict]:
	if not admission_keys:
		return []
	return _map_ip_rows(
		_fetch_rows(
			IP_TABLE,
			where=f"ADMISSION_NUM in ({_in_clause(admission_keys)})",
			order_by="ADMISSION_NUM, TRANS_DATE, TRANS_NUM",
		)
	)


def _all_hs_rows_for_chunk(visit_cds: list[str]) -> list[dict]:
	"""Every ``PATIENT_VISIT_PRESCRIPTION_HIS`` row for the visits in this chunk."""
	if not visit_cds:
		return []
	return _map_op_rows(
		_fetch_rows(
			HS_TABLE,
			where=f"VISIT_CD in ({_in_clause(visit_cds)}) and MEDICINE_CD is not null",
			order_by="VISIT_CD, PRESCRIP_ID, MEDICINE_CD, CREATE_DATE",
		)
	)


def _pvp_prescrip_ids_for_visits(visit_cds: list[str]) -> set[str]:
	"""``PRESCIP_ID`` values ``PATIENT_VISIT_PRESCRIPTION`` already has for these visits."""
	if not visit_cds:
		return set()
	rows = _query(
		f"select PRESCRIP_ID from {_oracle_schema()}.{OP_TABLE} "
		f"where VISIT_CD in ({_in_clause(visit_cds)}) and PRESCRIP_ID is not null"
	)
	return {
		pid
		for pid in (_normalize_code(row.get("PRESCRIP_ID")) for row in rows or [])
		if pid
	}


def _hs_visit_keys() -> list[str]:
	"""Every visit that has at least one HIS prescription row."""
	rows = _query(
		f"select distinct VISIT_CD from {_oracle_schema()}.{HS_TABLE} "
		"where VISIT_CD is not null and MEDICINE_CD is not null"
	)
	keys = {_clean_oracle_num(row.get("VISIT_CD")) for row in rows}
	return sorted((key for key in keys if key), key=_numeric_sort_key)


def _tag_his_deduplicate(rows: list[dict], pvp_prescrip_ids: set[str]) -> dict:
	"""Flag HIS lines that also exist on the legacy OP table.

	Repeats of the same ``PRESCIP_ID`` stay as separate lines: every HIS row is a
	transaction. The child ``is_deduplicate`` checkbox is what lets the UI hide the
	ones that are already covered by ``PATIENT_VISIT_PRESCRIPTION``.
	"""
	dedupe = 0
	tagged: list[dict] = []
	for row in rows or []:
		pid = _normalize_code(row.get("prescrip_id"))
		is_dup = 1 if pid and pid in pvp_prescrip_ids else 0
		if is_dup:
			dedupe += 1
		tagged.append({**row, "is_deduplicate": is_dup})
	return {"rows": tagged, "deduplicate_lines": dedupe}


def _prepare_his_grouped(visit_cds: list[str]) -> tuple[dict[str, dict], dict]:
	"""HIS rows for the chunk, grouped by visit, with ``is_deduplicate`` set."""
	raw = _all_hs_rows_for_chunk(visit_cds)
	if not raw:
		return {}, {"visits": 0, "lines": 0, "deduplicate_lines": 0}
	tagged = _tag_his_deduplicate(raw, _pvp_prescrip_ids_for_visits(visit_cds))
	grouped = _group_rows_by_visit(tagged["rows"])
	return grouped, {
		"visits": len(grouped),
		"lines": len(tagged["rows"]),
		"deduplicate_lines": cint(tagged["deduplicate_lines"]),
	}


def _his_visit_complete(visit_cd: str, expected_lines: int, patient: str | None = None) -> str | None:
	"""Return the HIS PMO name when it already holds every Oracle HIS line."""
	filters: dict[str, Any] = {
		"care_context": "Patient Visit",
		"patient_visit_prescription_his": 1,
		"visit_cd": visit_cd,
		"docstatus": ["!=", 2],
	}
	if patient:
		filters["patient"] = patient
	name = frappe.db.get_value("Patient Medication Order", filters, "name", order_by="modified desc")
	if not name:
		return None
	if cint(frappe.db.count("Inpatient Medication Order Entry", {"parent": name})) == cint(
		expected_lines
	):
		return name
	return None


def _apply_his_imports(grouped: dict[str, dict], dry_run: int = 0) -> dict:
	"""Create / rebuild ``patient_visit_prescription_his`` PMOs from Oracle HIS rows."""
	created = updated = skipped = unresolved = added_lines = 0
	failures: list[str] = []
	done: list[str] = []

	visit_links = _bulk_visit_links(list(grouped))
	for visit_cd, payload in grouped.items():
		lines = payload.get("lines") or []
		if not lines:
			continue
		patient_visit = payload.get("patient_visit") or visit_links.get(visit_cd)
		patient = payload.get("patient_file_no")
		if patient_visit and not patient:
			patient = frappe.db.get_value("Patient Visit", patient_visit, "patient")
		if patient_visit and not payload.get("patient_visit"):
			payload = {**payload, "patient_visit": patient_visit}
		if patient and not payload.get("patient_file_no"):
			payload = {**payload, "patient_file_no": patient}

		existing = _his_visit_complete(visit_cd, len(lines), patient=patient)
		if existing:
			skipped += 1
			done.append(f"{visit_cd}: {existing} already has {len(lines)} HIS lines")
			continue

		if dry_run:
			added_lines += len(lines)
			done.append(f"{visit_cd}: would import {len(lines)} HIS lines")
			continue

		savepoint = _safe_savepoint_name("presc_reconcile_his", visit_cd)
		try:
			frappe.db.savepoint(savepoint)
			outcome = import_his_visit_prescription(payload)
		except Exception:
			frappe.db.rollback(save_point=savepoint)
			failures.append(f"{visit_cd}: {frappe.get_traceback()}")
			frappe.log_error(title=f"Prescription reconcile (HIS) failed: {visit_cd}")
			continue

		status = outcome.get("status")
		if status in ("created", "updated", "ok"):
			if status == "created":
				created += 1
			else:
				updated += 1
			added_lines += cint(outcome.get("lines"))
			done.append(
				f"{visit_cd}: {outcome.get('name')} +{cint(outcome.get('lines'))} HIS lines"
			)
		elif status in ("skip_no_patient", "skip_empty", "skip_no_lines"):
			if status == "skip_no_patient":
				unresolved += 1
			skipped += 1
			done.append(f"{visit_cd}: {status}")
		else:
			skipped += 1
			done.append(f"{visit_cd}: {status}")

	return {
		"created": created,
		"updated": updated,
		"skipped": skipped,
		"unresolved": unresolved,
		"added_lines": added_lines,
		"failures": failures,
		"done": done,
	}


def _numeric_sort_key(value: str) -> tuple[int, float, str]:
	try:
		return (0, float(value), "")
	except (TypeError, ValueError):
		return (1, 0.0, str(value))


def _distinct_keys(table: str, column: str) -> list[str]:
	rows = _query(
		f"select distinct {column} from {_oracle_schema()}.{table} "
		f"where {column} is not null order by {column}"
	)
	keys = {_clean_oracle_num(row.get(column)) for row in rows}
	return sorted((key for key in keys if key), key=_numeric_sort_key)


def _build_work_limit(
	visits: list[str], admissions: list[str], limit: int
) -> tuple[list[str], list[str]]:
	"""``limit`` caps every phase (0 = the whole site); used by smoke tests."""
	if limit:
		return visits[:limit], admissions[:limit]
	return visits, admissions


def _resolve_patient_keys(patient: str | None) -> list[str] | None:
	"""Patient id variants for Oracle PATIENT_FILE_NO / PATIENT_NUM, or None for all patients."""
	patient = (patient or "").strip()
	if not patient:
		return None
	keys: set[str] = set()
	cleaned = _clean_oracle_num(patient)
	if cleaned:
		keys.add(cleaned)
	if frappe.db.exists("Patient", patient):
		keys.add(_clean_oracle_num(patient) or patient)
		file_no = frappe.db.get_value("Patient", patient, "file_no")
		if file_no:
			keys.add(_clean_oracle_num(file_no) or str(file_no).strip())
	else:
		for row in frappe.get_all(
			"Patient",
			filters={"file_no": patient},
			fields=["name", "file_no"],
			limit=5,
		):
			if row.name:
				keys.add(_clean_oracle_num(row.name) or row.name)
			if row.file_no:
				keys.add(_clean_oracle_num(row.file_no) or str(row.file_no).strip())
	return sorted(k for k in keys if k) or None


def _erp_patients_for_keys(patient_keys: list[str]) -> list[str]:
	"""ERPNext Patient names matching the Oracle patient key variants."""
	names: set[str] = set()
	for key in patient_keys or []:
		if frappe.db.exists("Patient", key):
			names.add(key)
	if patient_keys:
		for name in frappe.get_all(
			"Patient",
			filters={"file_no": ["in", list(patient_keys)]},
			pluck="name",
		):
			names.add(name)
		for name in frappe.get_all(
			"Patient",
			filters={"name": ["in", list(patient_keys)]},
			pluck="name",
		):
			names.add(name)
	return sorted(names)


def _source_has_column(table: str, column: str) -> bool:
	"""True when Oracle live (assume full CLINIC2), or the Excel sheet actually has the column.

	Partial Excel exports often omit PATIENT_NUM / PATIENT_FILE_NO; patient filtering
	must then fall back to ERPNext visit / admission numbers matched by VISIT_CD /
	ADMISSION_NUM instead of throwing ``no such column``.
	"""
	column = (column or "").strip().upper()
	if not column:
		return False
	source = current_source()
	if source is None:
		return True
	return column in {(name or "").upper() for name in source.columns(table)}


def _oracle_keys_in_chunks(
	table: str, column: str, candidates: list[str], *, extra_where: str = ""
) -> set[str]:
	"""Intersect candidate keys with rows that exist in the Oracle / Excel table."""
	found: set[str] = set()
	chunk_size = 200
	extra = f" {extra_where}" if extra_where else ""
	for i in range(0, len(candidates), chunk_size):
		chunk = candidates[i : i + chunk_size]
		if not chunk:
			continue
		rows = _query(
			f"select distinct {column} from {_oracle_schema()}.{table} "
			f"where {column} in ({_in_clause(chunk)}){extra}"
		)
		found.update(_clean_oracle_num(row.get(column)) for row in rows or [])
	return {key for key in found if key}


def _visit_keys_for_patient(patient_keys: list[str]) -> list[str]:
	"""Oracle OP + HIS visit numbers for this patient (plus ERPNext visits that still have Oracle rows)."""
	keys: set[str] = set()
	# Prefer PATIENT_FILE_NO when the source has it (live Oracle / full Excel export).
	for table, extra in ((OP_TABLE, ""), (HS_TABLE, " and MEDICINE_CD is not null")):
		if not _source_has_column(table, "PATIENT_FILE_NO"):
			continue
		rows = _query(
			f"select distinct VISIT_CD from {_oracle_schema()}.{table} "
			f"where PATIENT_FILE_NO in ({_in_clause(patient_keys)}) "
			f"and VISIT_CD is not null{extra}"
		)
		keys.update(_clean_oracle_num(row.get("VISIT_CD")) for row in rows or [])

	# Excel sheets often omit PATIENT_FILE_NO — resolve visits from ERPNext instead.
	erp_patients = _erp_patients_for_keys(patient_keys)
	if erp_patients:
		erp_visits = frappe.get_all(
			"Patient Visit",
			filters={"patient": ["in", erp_patients]},
			pluck="name",
			limit_page_length=0,
		)
		erp_visit_keys = [_clean_oracle_num(v) or v for v in erp_visits if v]
		for table, extra in ((OP_TABLE, ""), (HS_TABLE, " and MEDICINE_CD is not null")):
			keys.update(
				_oracle_keys_in_chunks(
					table, "VISIT_CD", erp_visit_keys, extra_where=extra.lstrip()
				)
			)

	return sorted((key for key in keys if key), key=_numeric_sort_key)


def _admission_keys_for_patient(patient_keys: list[str]) -> list[str]:
	"""Oracle IP admission numbers for this patient (plus ERPNext admissions that still have Oracle rows)."""
	keys: set[str] = set()
	source = current_source()
	# Excel medicine sheets sometimes denormalise PATIENT_NUM onto IP_ADMISSION_MEDICINE.
	# Live CLINIC2 does not: PATIENT_NUM lives on IP_ADMISSION_01 only.
	# ``_source_has_column`` returns True for every column when reading live Oracle, so
	# do not trust it for PATIENT_NUM on IP_ADMISSION_MEDICINE.
	if source is not None and _source_has_column(IP_TABLE, "PATIENT_NUM"):
		rows = _query(
			f"select distinct ADMISSION_NUM from {_oracle_schema()}.{IP_TABLE} "
			f"where PATIENT_NUM in ({_in_clause(patient_keys)}) and ADMISSION_NUM is not null"
		)
		keys.update(_clean_oracle_num(row.get("ADMISSION_NUM")) for row in rows or [])
	elif source is None:
		rows = _query(
			f"select distinct m.ADMISSION_NUM as ADMISSION_NUM "
			f"from {_oracle_schema()}.{IP_TABLE} m "
			f"join {_oracle_schema()}.{IP_ADMISSION_TABLE} a "
			f"on a.ADMISSION_NUM = m.ADMISSION_NUM "
			f"where a.PATIENT_NUM in ({_in_clause(patient_keys)}) "
			f"and m.ADMISSION_NUM is not null"
		)
		keys.update(_clean_oracle_num(row.get("ADMISSION_NUM")) for row in rows or [])

	erp_patients = _erp_patients_for_keys(patient_keys)
	if erp_patients:
		erp_admissions = frappe.get_all(
			"Inpatient Admission",
			filters={"patient": ["in", erp_patients]},
			pluck="name",
			limit_page_length=0,
		)
		erp_adm_keys = [_clean_oracle_num(a) or a for a in erp_admissions if a]
		keys.update(_oracle_keys_in_chunks(IP_TABLE, "ADMISSION_NUM", erp_adm_keys))

	return sorted((key for key in keys if key), key=_numeric_sort_key)


def _build_work(limit: int = 0, patient: str | None = None) -> dict:
	patient_keys = _resolve_patient_keys(patient)
	if patient_keys:
		visits = _visit_keys_for_patient(patient_keys)
		admissions = _admission_keys_for_patient(patient_keys)
	else:
		visits = sorted(
			set(_distinct_keys(OP_TABLE, "VISIT_CD")) | set(_hs_visit_keys()),
			key=_numeric_sort_key,
		)
		admissions = _distinct_keys(IP_TABLE, "ADMISSION_NUM")
	visits, admissions = _build_work_limit(visits, admissions, cint(limit))
	return {
		"visits": visits,
		"admissions": admissions,
		"limit": limit,
		"patient": (patient or "").strip() or None,
		"built_at": str(now_datetime()),
	}


# ---------------------------------------------------------------------------
# OP chunk
# ---------------------------------------------------------------------------


def _apply_op_chunk(visit_cds: list[str], progress: dict, dry_run: int = 0) -> None:
	grouped = _group_rows_by_visit(_op_rows_for_chunk(visit_cds))
	his_grouped, hs_stats = _prepare_his_grouped(visit_cds)

	if grouped:
		visit_links = _bulk_visit_links(list(grouped))
		coverage = _build_coverage(grouped, visit_links)
		imports, stats = _build_import_plan(grouped, coverage)
		resolved_patients = _resolve_import_patients(imports, visit_links)
		for item in imports:
			item["patient"] = resolved_patients.get(item["visit_cd"])
			if not item["payload"].get("patient_file_no") and item["patient"]:
				# The visit is known but Oracle left PATIENT_FILE_NO empty.
				item["payload"]["patient_file_no"] = item["patient"]

		progress["op_visits"] += len(grouped)
		progress["op_complete_visits"] += cint(stats.get("complete_visits"))
		progress["op_missing_visits"] += cint(stats.get("missing_visits"))
		progress["op_partial_visits"] += cint(stats.get("partial_visits"))
		progress["op_missing_lines"] += cint(stats.get("missing_lines")) + cint(
			stats.get("partial_lines")
		)
		progress["op_unresolved_visits"] += sum(1 for item in imports if not item.get("patient"))

		if not dry_run:
			import_result = _apply_imports(imports)
			progress["op_created"] += cint(import_result.get("created"))
			progress["op_updated"] += cint(import_result.get("updated"))
			progress["op_skipped"] += cint(import_result.get("skipped"))
			progress["op_added_lines"] += cint(import_result.get("added_lines"))
			_record_errors(progress, import_result.get("failures") or [])
			_record_samples(progress, _op_samples(imports))
			_record_samples(progress, (import_result.get("done") or [])[:3])
		else:
			_record_samples(progress, _op_samples(imports))
	elif not his_grouped:
		return

	# HIS transactions: every PATIENT_VISIT_PRESCRIPTION_HIS row becomes a line on a
	# patient_visit_prescription_his PMO. Duplicates of OP PRESCRIP_IDs are kept and
	# flagged is_deduplicate (never deleted).
	progress["op_hs_visits"] += cint(hs_stats.get("visits"))
	progress["op_hs_lines"] += cint(hs_stats.get("lines"))
	progress["op_hs_deduplicate_lines"] += cint(hs_stats.get("deduplicate_lines"))
	if his_grouped:
		his_result = _apply_his_imports(his_grouped, dry_run=dry_run)
		progress["op_hs_created"] += cint(his_result.get("created"))
		progress["op_hs_updated"] += cint(his_result.get("updated"))
		progress["op_hs_skipped"] += cint(his_result.get("skipped"))
		progress["op_hs_unresolved_visits"] += cint(his_result.get("unresolved"))
		_record_errors(progress, his_result.get("failures") or [])
		_record_samples(progress, (his_result.get("done") or [])[:3])


def _op_samples(imports: list[dict]) -> list[str]:
	samples: list[str] = []
	for item in imports[:3]:
		patient = item.get("patient") or "-"
		if item["mode"] == "create":
			samples.append(
				f"{item['visit_cd']} · {patient}: {len(item['rows'])} lines (new prescription)"
			)
		else:
			samples.append(
				f"{item['visit_cd']} · {patient}: {len(item['rows'])} missing lines → {item['pmo']}"
			)
	return samples



# ---------------------------------------------------------------------------
# IP chunk
# ---------------------------------------------------------------------------


def _ip_missing_rows(admission: str, lines: list[dict], existing_references: set[str]) -> list[dict]:
	"""Legacy IP lines whose ``TRANS_NUM`` is not on the admission's prescription yet."""
	missing: list[dict] = []
	fallback_keys: set[str] | None = None
	for row in lines:
		trans_no = _clean_oracle_num(row.get("trans_no"))
		if trans_no:
			if trans_no not in existing_references:
				missing.append(row)
			continue
		if fallback_keys is None:
			fallback_keys = _pmo_line_keys(admission)
		if _row_key(row) not in fallback_keys:
			missing.append(row)
	return missing


def _apply_ip_chunk(
	admission_keys: list[str],
	progress: dict,
	existing_references: set[str],
	dry_run: int = 0,
) -> None:
	grouped, unresolved = _group_rows_by_admission(_ip_rows_for_chunk(admission_keys))
	progress["ip_unresolved_rows"] += len(unresolved)

	for admission_key in sorted(grouped, key=_numeric_sort_key):
		lines = grouped[admission_key]
		admission = _resolve_admission(lines)
		if not admission:
			progress["ip_unresolved_admissions"] += 1
			continue
		fields = _admission_fields(admission)
		if not fields.get("patient"):
			progress["ip_unresolved_admissions"] += 1
			continue

		progress["ip_admissions"] += 1
		missing = _ip_missing_rows(admission, lines, existing_references)
		if not missing:
			progress["ip_complete_admissions"] += 1
			continue

		progress["ip_gap_admissions"] += 1
		progress["ip_missing_lines"] += len(missing)
		if dry_run:
			_record_samples(
				progress,
				[f"{admission} · {fields.get('patient')}: {len(missing)} missing IP lines"],
			)
			continue

		missing = _prepare_long_acting_rows(missing)
		savepoint = _safe_savepoint_name("presc_reconcile_ip", admission_key)
		try:
			frappe.db.savepoint(savepoint)
			outcome = import_patient_medication_order_for_admission(admission_key, missing)
		except Exception:
			frappe.db.rollback(save_point=savepoint)
			_record_errors(progress, [f"{admission}: {frappe.get_traceback()}"])
			frappe.log_error(title=f"Prescription reconcile (IP) failed: {admission}")
			continue

		if outcome.get("status") != "ok":
			progress["ip_skipped"] += 1
			_record_samples(progress, [f"{admission}: {outcome.get('status')}"])
			continue

		if outcome.get("created"):
			progress["ip_created"] += 1
		else:
			progress["ip_completed"] += 1
		progress["ip_added_lines"] += cint(outcome.get("added_lines"))
		existing_references.update(
			_clean_oracle_num(row.get("trans_no")) for row in missing if row.get("trans_no")
		)
		try:
			long_acting = _create_missing_long_acting_medicines(outcome.get("pmo"))
			progress["ip_long_acting_created"] += len(long_acting)
		except Exception:
			_record_errors(progress, [f"{admission} (long acting): {frappe.get_traceback()}"])
			frappe.log_error(title=f"Prescription reconcile long acting failed: {admission}")
		_record_samples(
			progress,
			[
				f"{admission} · {fields.get('patient')}: {outcome.get('pmo')} "
				f"+{cint(outcome.get('added_lines'))} lines"
			],
		)



# ---------------------------------------------------------------------------
# Job
# ---------------------------------------------------------------------------


def _queue_next(token: str, files: Any = None) -> None:
	frappe.enqueue(
		"healthcare.api.prescription_sync.run_prescription_reconcile",
		queue="long",
		timeout=7200,
		resume=1,
		token=token,
		files=files,
	)


def _run(
	token: str,
	resume: int,
	limit: int,
	dry_run: int = 0,
	files: Any = None,
	patient: str | None = None,
) -> dict[str, Any]:
	"""Read Oracle live, or from the uploaded Excel export, then reconcile."""
	progress = _load_progress() if resume else None
	files = normalize_files(files) or (progress or {}).get("files") or None
	patient = (patient or "").strip() or (progress or {}).get("patient") or None
	with excel_source(files, tables=ORACLE_TABLES):
		return _run_with_source(token, resume, limit, dry_run, files, patient=patient)


def _run_with_source(
	token: str,
	resume: int,
	limit: int,
	dry_run: int = 0,
	files: Any = None,
	patient: str | None = None,
) -> dict[str, Any]:
	started = time.monotonic()
	patient = (patient or "").strip() or None
	if resume:
		progress = _load_progress() or _new_progress()
		work = _load_work()
		patient = patient or progress.get("patient") or (work or {}).get("patient")
	else:
		progress = _new_progress()
		progress["dry_run"] = cint(dry_run)
		progress["patient"] = patient
		work = _build_work(limit, patient=patient)
		_set_work(work)

	if not work:
		# The work list expired (cache cleared) - rebuild it instead of doing nothing.
		work = _build_work(limit, patient=patient or progress.get("patient"))
		_set_work(work)

	visits: list[str] = work.get("visits") or []
	admissions: list[str] = work.get("admissions") or []
	existing_references: set[str] | None = None

	progress["state"] = "running"
	progress["total"] = len(visits) + len(admissions)
	progress["scanned_visits"] = len(visits)
	progress["scanned_admissions"] = len(admissions)
	progress["phase"] = progress.get("phase") or "op"
	_set_progress(progress)
	_refresh_lock(token)

	while True:
		phase = progress.get("phase") or "op"
		if phase == "op":
			index = cint(progress.get("visit_index"))
			chunk = visits[index : index + OP_CHUNK]
			if not chunk:
				progress["phase"] = "ip"
				continue
			_apply_op_chunk(chunk, progress, dry_run=cint(progress.get("dry_run")))
			progress["visit_index"] = index + len(chunk)
		elif phase == "ip":
			index = cint(progress.get("admission_index"))
			chunk = admissions[index : index + IP_CHUNK]
			if not chunk:
				break
			if existing_references is None:
				existing_references = _existing_reference_nos()
			_apply_ip_chunk(chunk, progress, existing_references, dry_run=cint(progress.get("dry_run")))
			progress["admission_index"] = index + len(chunk)
		else:
			break

		progress["processed"] = cint(progress.get("visit_index")) + cint(progress.get("admission_index"))
		frappe.db.commit()
		_set_progress(progress)
		_refresh_lock(token)

		if time.monotonic() - started > TIME_BUDGET:
			progress["state"] = "queued"
			progress["message"] = _(
				"Still running in the background ({0} of {1} records processed)."
			).format(progress.get("processed") or 0, progress.get("total") or 0)
			_set_progress(progress)
			_queue_next(token, files)
			return {"state": "queued", "handed_over": True, "progress": progress}

	frappe.db.commit()
	progress["processed"] = progress.get("total") or progress.get("processed")
	progress["state"] = "finished"
	progress["phase"] = "done"
	progress["finished_at"] = str(now_datetime())
	progress["message"] = _summary_message(progress)
	_set_progress(progress)
	return {"state": "finished", "progress": progress}


def _summary_message(progress: dict) -> str:
	lines = [
		_("Reconcile Prescriptions finished."),
	]
	if progress.get("patient"):
		lines.append(_("Patient: {0}").format(progress.get("patient")))
	lines.extend([
		"",
		_("OP - PATIENT_VISIT_PRESCRIPTION"),
		_("Visits checked: {0} (complete: {1})").format(
			cint(progress.get("op_visits")), cint(progress.get("op_complete_visits"))
		),
		_("Visits with no prescription: {0} ({1} lines) → created: {2}").format(
			cint(progress.get("op_missing_visits")),
			cint(progress.get("op_missing_lines")),
			cint(progress.get("op_created")),
		),
		_("Visits with missing lines: {0} → completed: {1}").format(
			cint(progress.get("op_partial_visits")), cint(progress.get("op_updated"))
		),
		_("Prescription lines added: {0}").format(cint(progress.get("op_added_lines"))),
		"",
		_("HIS - PATIENT_VISIT_PRESCRIPTION_HIS"),
		_("HIS visits: {0} ({1} lines, {2} marked Is Deduplicate)").format(
			cint(progress.get("op_hs_visits")),
			cint(progress.get("op_hs_lines")),
			cint(progress.get("op_hs_deduplicate_lines")),
		),
		_("HIS prescriptions created: {0}, updated: {1}, already complete: {2}").format(
			cint(progress.get("op_hs_created")),
			cint(progress.get("op_hs_updated")),
			cint(progress.get("op_hs_skipped")),
		),
		_("HIS visits without a resolvable patient: {0}").format(
			cint(progress.get("op_hs_unresolved_visits"))
		),
		_("Visits without a resolvable patient: {0}").format(
			cint(progress.get("op_unresolved_visits"))
		),
		"",
		_("IP - IP_ADMISSION_MEDICINE"),
		_("Admissions checked: {0} (complete: {1})").format(
			cint(progress.get("ip_admissions")), cint(progress.get("ip_complete_admissions"))
		),
		_("Admissions with missing lines: {0} ({1} lines) → created: {2}, completed: {3}").format(
			cint(progress.get("ip_gap_admissions")),
			cint(progress.get("ip_missing_lines")),
			cint(progress.get("ip_created")),
			cint(progress.get("ip_completed")),
		),
		_("Prescription lines added: {0}").format(cint(progress.get("ip_added_lines"))),
		_("Long Acting Medicine created: {0}").format(cint(progress.get("ip_long_acting_created"))),
		_("Admissions not found in ERPNext: {0}").format(
			cint(progress.get("ip_unresolved_admissions"))
		),
	])
	if progress.get("dry_run"):
		lines.insert(1, _("DRY RUN - nothing was changed."))
	if progress.get("failed"):
		lines.extend(["", _("Failed records: {0}").format(progress.get("failed"))])
		for error in progress.get("errors") or []:
			lines.append(f"• {error}")
	samples = progress.get("samples") or []
	if samples:
		lines.extend(["", _("Samples")])
		lines.extend(f"• {sample}" for sample in samples)
	return "\n".join(lines)



# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


@frappe.whitelist()
def start_prescription_reconcile(
	limit: int = 0, dry_run: int = 0, files=None, patient: str | None = None
) -> dict[str, Any]:
	"""Queue one reconciliation of OP / HIS / IP prescriptions (button entry point).

	Leave ``patient`` empty to compare the whole site; pass a Patient name or
	file number to repair only that patient's prescriptions.
	"""
	_require_admin()
	files = normalize_files(files)
	patient = (patient or "").strip() or None
	if _lock_held():
		return {
			"queued": False,
			"running": True,
			"message": _("A prescription reconciliation is already running."),
			"status": _load_progress(),
		}

	progress = _new_progress()
	progress["state"] = "queued"
	progress["dry_run"] = cint(dry_run)
	progress["limit"] = cint(limit)
	progress["patient"] = patient
	progress["files"] = files
	if patient:
		progress["message"] = (
			_("Queued for patient {0}. The uploaded Excel export is read in the background.").format(
				patient
			)
			if files
			else _("Queued for patient {0}. Oracle is read in the background.").format(patient)
		)
	else:
		progress["message"] = (
			_("Queued. The uploaded Excel export is read in the background.")
			if files
			else _("Queued. Oracle is read in the background.")
		)
	_set_progress(progress)

	frappe.enqueue(
		"healthcare.api.prescription_sync.run_prescription_reconcile",
		queue="long",
		timeout=7200,
		limit=cint(limit),
		dry_run=cint(dry_run),
		files=files,
		patient=patient,
	)
	return {"queued": True, "job_key": JOB_KEY, "status": progress}


@frappe.whitelist()
def get_prescription_reconcile_status() -> dict[str, Any]:
	"""Progress of the last / ongoing reconciliation (polled by the settings dialog)."""
	_require_admin()
	return _load_progress() or {
		"job_key": JOB_KEY,
		"state": "idle",
		"phase": "op",
		"processed": 0,
		"total": 0,
	}


def run_prescription_reconcile(
	limit: int = 0,
	resume: int = 0,
	token: str | None = None,
	dry_run: int = 0,
	files: Any = None,
	patient: str | None = None,
) -> dict[str, Any]:
	"""Background entry point (also callable inline from the bench console)."""
	if cint(resume):
		if not _owns_lock(token):
			return {
				"state": "skipped",
				"message": _("This reconciliation run was replaced by a newer one."),
			}
	else:
		token = _acquire_lock()
		if not token:
			return {
				"state": "running",
				"message": _("A prescription reconciliation is already running."),
			}

	outcome: dict[str, Any] = {}
	try:
		outcome = _run(
			token,
			cint(resume),
			cint(limit),
			cint(dry_run),
			files,
			patient=patient,
		)
	except Exception:
		progress = _load_progress() or _new_progress()
		progress["state"] = "failed"
		progress["message"] = frappe.get_traceback()
		_record_errors(progress, [frappe.get_traceback()])
		_set_progress(progress)
		frappe.log_error(title="Prescription reconciliation failed")
		raise
	finally:
		if not outcome.get("handed_over"):
			_release_lock(token)
	return outcome

