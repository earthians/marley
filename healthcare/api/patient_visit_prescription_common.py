"""Shared helpers for legacy Patient Visit prescription PMO imports."""

from __future__ import annotations

import json
import os
from typing import Any

import frappe
from frappe.utils import cint, now_datetime

from healthcare.api.data_migration_jobs import (
	LEGACY_PMO_SIGNATURE,
	ensure_legacy_pmo_signature_file,
)

PMO_DOCTYPE = "Patient Medication Order"
QUEUE_ROOT_DIR = "data_migration_queue"
QUEUE_META_FILE = "meta.json"
QUEUE_KEYS_FILE = "keys.json"
LEGACY_OP_SOURCE_FLAGS = (
	"patient_visit_prescription",
	"patient_visit_prescription_his",
)


def existing_pmo_for_legacy_visit(
	visit_cd: str,
	*,
	patient: str | None,
	patient_visit: str | None,
	source_flag: str,
) -> str | None:
	filters: dict[str, Any] = {
		"care_context": "Patient Visit",
		source_flag: 1,
		"docstatus": ["!=", 2],
	}
	if patient_visit:
		filters["patient_encounter"] = patient_visit
	else:
		filters["visit_cd"] = visit_cd
		if patient:
			filters["patient"] = patient
	return frappe.db.get_value(PMO_DOCTYPE, filters, "name", order_by="modified desc")


def submit_and_complete_legacy_visit_pmo(doc) -> None:
	"""Submit legacy OP visit PMO and set status Completed on upload."""
	total = len(doc.get("medication_orders") or [])
	for child in doc.get("medication_orders") or []:
		child.is_completed = 1
	doc.total_orders = total
	doc.completed_orders = total
	doc.new_system = 0
	ensure_legacy_pmo_signature_file()
	doc.doctors_signature = LEGACY_PMO_SIGNATURE
	doc.flags.ignore_mandatory = True
	doc.flags.ignore_links = True
	doc.flags.ignore_validate = True
	frappe.flags.in_import = True
	doc.save(ignore_permissions=True)
	if doc.docstatus == 0:
		doc.flags.ignore_mandatory = True
		doc.flags.ignore_validate = True
		doc.submit()
	doc.reload()
	frappe.db.set_value(
		doc.doctype,
		doc.name,
		{
			"status": "Completed",
			"completed_orders": total,
			"total_orders": total,
			"new_system": 0,
			"doctors_signature": LEGACY_PMO_SIGNATURE,
		},
		update_modified=False,
	)
	doc.status = "Completed"
	doc.completed_orders = total
	doc.total_orders = total


def _chunked(values: list[str], size: int = 1000):
	for offset in range(0, len(values), size):
		yield values[offset : offset + size]


def _bulk_existing_patient_ids(patient_ids: set[str]) -> set[str]:
	found: set[str] = set()
	if not patient_ids:
		return found
	for chunk in _chunked(sorted(patient_ids)):
		found.update(frappe.get_all("Patient", filters={"name": ["in", chunk]}, pluck="name"))
	return found


def _bulk_visit_links(visit_cds: list[str]) -> dict[str, str | None]:
	by_visit_cd: dict[str, str] = {}
	if not visit_cds:
		return {}
	for chunk in _chunked(visit_cds):
		for row in frappe.get_all(
			"Patient Visit",
			filters={"case_no": ["in", chunk]},
			fields=["name", "case_no"],
		):
			by_visit_cd[row.case_no] = row.name
		for row in frappe.get_all(
			"Patient Visit",
			filters={"name": ["in", chunk]},
			fields=["name", "case_no"],
		):
			by_visit_cd.setdefault(row.name, row.name)
	return {visit_cd: by_visit_cd.get(visit_cd) for visit_cd in visit_cds}


def _bulk_existing_legacy_visit_cds(
	grouped: dict[str, dict],
	visit_links: dict[str, str | None],
	*,
	source_flag: str | None,
) -> set[str]:
	"""Visit CDs that already have a legacy OP Patient Medication Order.

	``source_flag=None`` matches any legacy OP prescription source (either the
	PATIENT_VISIT_PRESCRIPTION or the PATIENT_VISIT_PRESCRIPTION_HIS flag) so a repair
	run can never create a second prescription for a visit.
	"""
	existing: set[str] = set()
	visit_cds = list(grouped.keys())
	base_filters = {
		"care_context": "Patient Visit",
		"docstatus": ["!=", 2],
	}
	if source_flag:
		base_filters["legacy"] = 1
		base_filters[source_flag] = 1

	for chunk in _chunked(visit_cds):
		rows = frappe.get_all(
			PMO_DOCTYPE,
			filters={**base_filters, "visit_cd": ["in", chunk]},
			pluck="visit_cd",
		)
		existing.update(row for row in rows if row)

	encounter_to_visit_cd = {
		visit_name: visit_cd for visit_cd, visit_name in visit_links.items() if visit_name
	}
	for chunk in _chunked(sorted(encounter_to_visit_cd.keys())):
		rows = frappe.get_all(
			PMO_DOCTYPE,
			filters={**base_filters, "patient_encounter": ["in", chunk]},
			pluck="patient_encounter",
		)
		for encounter in rows:
			visit_cd = encounter_to_visit_cd.get(encounter)
			if visit_cd:
				existing.add(visit_cd)

	return existing


def preview_counts_for_legacy_visit_pmo(
	grouped: dict[str, dict],
	raw_line_count: int,
	*,
	source_flag: str,
) -> dict:
	visit_cds = list(grouped.keys())
	patient_ids = {
		payload.get("patient_file_no")
		for payload in grouped.values()
		if payload.get("patient_file_no")
	}
	existing_patients = _bulk_existing_patient_ids(patient_ids)
	visit_links = _bulk_visit_links(visit_cds)
	existing_visit_cds = _bulk_existing_legacy_visit_cds(
		grouped,
		visit_links,
		source_flag=source_flag,
	)

	resolvable_patients = sum(
		1
		for payload in grouped.values()
		if payload.get("patient_file_no") in existing_patients
	)
	resolvable_visits = sum(1 for visit_cd in visit_cds if visit_links.get(visit_cd))

	return {
		"visits": len(grouped),
		"medicine_lines": raw_line_count,
		"existing_records": len(existing_visit_cds),
		"resolvable_patients": resolvable_patients,
		"resolvable_visits": resolvable_visits,
		"sample_visit_cds": visit_cds[:5],
	}


def missing_visits_for_legacy_source(
	grouped: dict[str, dict],
	*,
	source_flag: str | None,
	exclude_visit_cds: set[str] | None = None,
) -> set[str]:
	"""Source visits that still have no legacy OP Patient Medication Order."""
	visit_links = _bulk_visit_links(list(grouped.keys()))
	existing = _bulk_existing_legacy_visit_cds(grouped, visit_links, source_flag=source_flag)
	missing = {visit_cd for visit_cd in grouped.keys() if visit_cd not in existing}
	if exclude_visit_cds:
		missing -= exclude_visit_cds
	return missing


def verify_legacy_visit_coverage(
	grouped: dict[str, dict],
	*,
	source_flag: str | None,
	sample_size: int = 20,
) -> dict:
	"""How much of a source workbook is present in Patient Medication Order."""
	missing = missing_visits_for_legacy_source(grouped, source_flag=source_flag)
	sample = sorted(missing, key=_visit_sort_key)
	return {
		"source_visits": len(grouped),
		"covered": len(grouped) - len(missing),
		"missing": len(missing),
		"sample_missing": sample[:sample_size],
	}


def duplicate_legacy_visit_pmos(sample_size: int = 20) -> dict:
	"""Visits that carry both a PATIENT_VISIT_PRESCRIPTION and a HIS PMO."""
	rows = frappe.db.sql(
		"""
		SELECT patient_encounter, visit_cd,
			SUM(IF(patient_visit_prescription = 1, 1, 0)) AS normal_count,
			SUM(IF(patient_visit_prescription_his = 1, 1, 0)) AS his_count
		FROM `tabPatient Medication Order`
		WHERE care_context = 'Patient Visit'
			AND legacy = 1
			AND docstatus != 2
			AND (patient_visit_prescription = 1 OR patient_visit_prescription_his = 1)
		GROUP BY COALESCE(NULLIF(patient_encounter, ''), CONCAT('visit:', IFNULL(visit_cd, '')))
		HAVING normal_count > 0 AND his_count > 0
		""",
		as_dict=True,
	)
	return {
		"duplicate_groups": len(rows),
		"sample": [row.get("patient_encounter") or row.get("visit_cd") for row in rows[:sample_size]],
	}



# ── Disk backed work queue (survives Redis expiry / worker restarts) ──────────


def _queue_dir(job: str) -> str:
	path = frappe.get_site_path("private", "files", QUEUE_ROOT_DIR, job)
	os.makedirs(path, exist_ok=True)
	return path


def _queue_file(job: str, name: str) -> str:
	return os.path.join(_queue_dir(job), name)


def _write_json(path: str, payload) -> None:
	"""Write atomically so an interrupted write never leaves a half queue behind."""
	tmp_path = f"{path}.tmp"
	with open(tmp_path, "w", encoding="utf-8") as handle:
		json.dump(payload, handle, default=str)
	os.replace(tmp_path, path)


def _read_json(path: str, default=None):
	if not os.path.exists(path):
		return default
	try:
		with open(path, encoding="utf-8") as handle:
			return json.load(handle)
	except (OSError, ValueError):
		return default


def _visit_sort_key(key: Any):
	return (0, cint(key)) if str(key).isdigit() else (1, str(key))


def queue_path(job: str) -> str:
	return os.path.join(frappe.get_site_path("private", "files", QUEUE_ROOT_DIR), job)


def clear_import_queue(job: str) -> None:
	path = queue_path(job)
	if not os.path.isdir(path):
		return
	for name in os.listdir(path):
		if name.startswith("batch-") or name in (QUEUE_META_FILE, QUEUE_KEYS_FILE):
			try:
				os.remove(os.path.join(path, name))
			except OSError:
				pass


def save_import_queue(
	job: str,
	*,
	file_url: str | None,
	grouped: dict[str, dict],
	medicine_lines: int,
	batch_size: int,
	extra_meta: dict | None = None,
) -> dict:
	"""Persist the parsed workbook to disk, one shard per import batch.

	Batches read their payload from these files, so a Redis flush or a cache TTL expiry
	can never mark the job complete before every visit was processed.
	"""
	clear_import_queue(job)
	batch_size = max(cint(batch_size), 1)
	visit_keys = sorted(grouped.keys(), key=_visit_sort_key)
	shard_count = 0
	for offset in range(0, len(visit_keys), batch_size):
		keys = visit_keys[offset : offset + batch_size]
		_write_json(
			_queue_file(job, f"batch-{shard_count:05d}.json"),
			{key: grouped[key] for key in keys},
		)
		shard_count += 1

	_write_json(_queue_file(job, QUEUE_KEYS_FILE), visit_keys)
	meta = {
		"job": job,
		"file_url": file_url,
		"total_visits": len(visit_keys),
		"medicine_lines": cint(medicine_lines),
		"batch_size": batch_size,
		"batch_count": shard_count,
		"created_at": str(now_datetime()),
	}
	if extra_meta:
		meta.update(extra_meta)
	_write_json(_queue_file(job, QUEUE_META_FILE), meta)
	return meta


def load_import_queue_meta(job: str) -> dict:
	return _read_json(_queue_file(job, QUEUE_META_FILE), {}) or {}


def load_import_queue_keys(job: str) -> list:
	return _read_json(_queue_file(job, QUEUE_KEYS_FILE), []) or []


def load_import_queue_batch(job: str, offset: int, *, batch_size: int) -> dict[str, dict]:
	batch_size = max(cint(batch_size), 1)
	offset = cint(offset)
	if offset % batch_size:
		return {}
	return _read_json(_queue_file(job, f"batch-{offset // batch_size:05d}.json"), {}) or {}


def save_queue_list(job: str, name: str, rows: list) -> str:
	path = _queue_file(job, name)
	_write_json(path, rows)
	return path


def load_queue_list(job: str, name: str) -> list:
	return _read_json(_queue_file(job, name), []) or []

