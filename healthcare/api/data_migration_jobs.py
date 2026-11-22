"""One-off / bulk data maintenance jobs — run from Healthcare Settings in batches."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, now_datetime, nowdate, get_time, getdate
from healthcare.api.ip_patient_assessment_import import (
	_abbrev_to_row_key,
	_assessment_datetime_from_row,
	_assessment_time_from_row,
	_persist_and_submit_patient_assessment,
	_row_value_for_abbrev,
	_to_yes_no_flag,
)

# ── Batch sizes (tune for ~1h runs on large datasets) ─────────────────────────
PATIENT_BATCH_SIZE = 2000
PATIENT_CUSTOMER_NAME_BATCH_SIZE = 500
ADMISSION_BATCH_SIZE = 2000
VISIT_BATCH_SIZE = 25
APPOINTMENT_BATCH_SIZE = 2000
MEDICATION_ORDER_BATCH_SIZE = 25
DISCHARGE_BATCH_SIZE = 10
IP_ADMISSION_MEDICINE_BATCH_SIZE = 50
IP_ADMISSION_MEDICINE_SHEET_BATCH_SIZE = 500
IP_PATIENT_ASSESSMENT_BATCH_SIZE = 500
CLINICAL_NOTE_TYPE_BATCH_SIZE = 500
PATIENT_LEGACY_GENDER_BATCH_SIZE = 500
DISCHARGE_CHECKLIST_IMPORT_BATCH_SIZE = 500
PATIENT_HISTORY_DATE_BATCH_SIZE = 100
PATIENT_INFO_IMPORT_BATCH_SIZE = 500
IP_ADMISSION_DISCHARGE_IMPORT_BATCH_SIZE = 500

JOB_LOCK_SECONDS = 7200  # 2 hours

# Legacy DIAGNOSES_FLAG → Clinical Note Type (Clinical Note.diagnosis_flag is Data)
_DIAGNOSIS_FLAG_TO_NOTE_TYPE = {
	"1": "Doctor Progress Note",
	"DOC": "Doctor Progress Note",
	"2": "Psychologist Note",
	"PSY": "Psychologist Note",
	"3": "Nutritionist Note",
	"NUT": "Nutritionist Note",
	"4": "General Note",
	"OCC": "General Note",
}
ALL_CUSTOMER_GROUP_NAMES = ("All Customer Groups", "All Customer Group")


def _require_admin():
	frappe.only_for(("System Manager", "Healthcare Administrator"))


def _job_lock_key(job: str) -> str:
	return f"healthcare:data_migration:{job}:lock"


def _job_progress_key(job: str) -> str:
	return f"healthcare:data_migration:{job}:progress"


def _job_stop_key(job: str) -> str:
	return f"healthcare:data_migration:{job}:stop"


def _job_stop_global_key(job: str) -> str:
	"""DB-backed stop flag so RQ workers see stop even if Redis/cache is flaky."""
	return f"healthcare_migration_stop::{job}"


def _job_lock_global_key(job: str) -> str:
	return f"healthcare_migration_lock::{job}"


def _acquire_lock(job: str) -> None:
	if _job_is_marked_running(job):
		frappe.throw(
			_("Job “{0}” is already running. Wait for it to finish before starting again.").format(job)
		)
	_clear_stop_request(job)
	frappe.cache().set_value(_job_lock_key(job), 1, expires_in_sec=JOB_LOCK_SECONDS)
	frappe.db.set_global(_job_lock_global_key(job), "1")
	frappe.db.commit()


def _renew_lock(job: str) -> None:
	"""Keep lock alive across long multi-batch runs."""
	frappe.cache().set_value(_job_lock_key(job), 1, expires_in_sec=JOB_LOCK_SECONDS)
	frappe.db.set_global(_job_lock_global_key(job), "1")


def _release_lock(job: str) -> None:
	frappe.cache().delete_value(_job_lock_key(job))
	frappe.db.set_global(_job_lock_global_key(job), None)
	_clear_stop_request(job)


def _job_appears_active(job: str) -> bool:
	"""True when lock is held or progress shows an unfinished run."""
	if _job_is_marked_running(job):
		return True
	progress = frappe.cache().get_value(_job_progress_key(job)) or {}
	if not progress:
		return False
	if progress.get("done") or progress.get("stopped") or progress.get("error"):
		return False
	return True


def _request_stop(job: str) -> None:
	frappe.cache().set_value(_job_stop_key(job), 1, expires_in_sec=JOB_LOCK_SECONDS)
	# Commit so background workers see this on the next DB read / after their commit.
	frappe.db.set_global(_job_stop_global_key(job), "1")
	frappe.db.commit()


def _clear_stop_request(job: str) -> None:
	frappe.cache().delete_value(_job_stop_key(job))
	frappe.db.set_global(_job_stop_global_key(job), None)


def _read_global_flag(key: str) -> bool:
	"""Read tabDefaultValue directly so RQ workers are not stuck on a stale defaults cache."""
	row = frappe.db.sql(
		"""
		SELECT defvalue
		FROM `tabDefaultValue`
		WHERE defkey = %s AND parent = %s
		LIMIT 1
		""",
		(key, "__default"),
	)
	if not row:
		return False
	return bool(cint(row[0][0]))


def _stop_requested(job: str) -> bool:
	if frappe.cache().get_value(_job_stop_key(job)):
		return True
	return _read_global_flag(_job_stop_global_key(job))


def _job_is_marked_running(job: str) -> bool:
	if frappe.cache().get_value(_job_lock_key(job)):
		return True
	return _read_global_flag(_job_lock_global_key(job))


def _set_progress(
	job: str,
	processed: int,
	*,
	done: bool = False,
	error: str | None = None,
	**extra,
) -> None:
	payload = {
		"processed": processed,
		"done": done,
		"error": error,
		"updated_at": str(now_datetime()),
	}
	if extra:
		payload.update(extra)
	frappe.cache().set_value(
		_job_progress_key(job),
		payload,
		expires_in_sec=JOB_LOCK_SECONDS,
	)


def _ensure_patient_category(name: str) -> None:
	if frappe.db.exists("Patient Category", name):
		return
	doc = frappe.new_doc("Patient Category")
	doc.patient_category = name
	doc.insert(ignore_permissions=True)


def _ensure_customer_group_patient() -> None:
	if frappe.db.exists("Customer Group", "Patient"):
		return
	parent = frappe.db.get_single_value("Selling Settings", "customer_group") or "All Customer Groups"
	if not frappe.db.exists("Customer Group", parent):
		parent = "All Customer Groups"
	frappe.get_doc(
		{
			"doctype": "Customer Group",
			"customer_group_name": "Patient",
			"is_group": 0,
			"parent_customer_group": parent,
		}
	).insert(ignore_permissions=True)


def _patient_row_updates(row: dict) -> dict:
	updates = {}
	category = (row.get("category") or "").strip()
	if category == "American Navy":
		updates["category"] = "Military"
	elif category == "Royal":
		updates["category"] = "VIP"
	elif not category:
		updates["category"] = "Regular"

	cg = (row.get("customer_group") or "").strip()
	if cg in ALL_CUSTOMER_GROUP_NAMES:
		updates["customer_group"] = "Patient"

	return updates


# ── Starters (whitelisted from Healthcare Settings) ───────────────────────────


@frappe.whitelist()
def start_patient_migration() -> dict:
	_require_admin()
	_acquire_lock("patients")
	_set_progress("patients", 0)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_migration_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_migrate_patients",
	)
	return {"ok": True, "message": _("Patient migration started in the background.")}


@frappe.whitelist()
def start_patient_category_customer_group_sync() -> dict:
	"""Align Patient + linked Customer customer_group with Patient.category."""
	_require_admin()
	_acquire_lock("patient_category_customer_group")
	_set_progress("patient_category_customer_group", 0, updated=0, skipped_no_category=0)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_category_customer_group_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_sync_patient_category_customer_group",
	)
	return {
		"ok": True,
		"message": _("Customer Group sync from Patient Category started in the background."),
	}


@frappe.whitelist()
def start_admission_migration() -> dict:
	_require_admin()
	_acquire_lock("admissions")
	_set_progress("admissions", 0)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_admission_migration_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_migrate_admissions",
	)
	return {"ok": True, "message": _("Admission migration started in the background.")}


@frappe.whitelist()
def start_patient_visit_migration() -> dict:
	_require_admin()
	_acquire_lock("patient_visits")
	_clear_failed_visits()
	_set_progress("patient_visits", 0)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_visit_migration_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_migrate_patient_visits",
	)
	return {"ok": True, "message": _("Submit & complete Patient Visits job started in the background.")}


@frappe.whitelist()
def start_appointment_close_migration() -> dict:
	_require_admin()
	_acquire_lock("appointments")
	_set_progress("appointments", 0)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_appointment_close_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_close_appointments",
	)
	return {"ok": True, "message": _("Close appointments job started in the background.")}


@frappe.whitelist()
def start_appointment_old_status_migration(file_url: str | None = None) -> dict:
	"""Backfill doc_code/practitioner from Oracle Excel, then set status from old_status (S/V)."""
	_require_admin()
	from healthcare.api.patient_appointment_old_status_backfill import (
		cache_appointments_excel_for_migration,
		run_patient_appointment_old_status_backfill_preview,
	)

	if not file_url:
		frappe.throw(_("Upload the Oracle appointments Excel file (all sheets) before starting."))

	preview = run_patient_appointment_old_status_backfill_preview(file_url=file_url)
	cache_appointments_excel_for_migration(file_url)
	_acquire_lock("appointment_old_status")
	_set_progress(
		"appointment_old_status",
		0,
		phase="doc_code",
		pending_doc_code=preview.get("pending_doc_code_updates") or 0,
		total_needing_update=preview.get("total_needing_update") or 0,
		to_closed=preview.get("to_closed") or 0,
		to_no_show=preview.get("to_no_show") or 0,
		to_scheduled=preview.get("to_scheduled") or 0,
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_appointment_old_status_batch",
		offset=0,
		phase="doc_code",
		queue="long",
		timeout=3600,
		job_name="healthcare_appointment_old_status",
	)
	return {
		"ok": True,
		"message": _(
			"Appointment Oracle backfill started in the background "
			"({0} doc_code/practitioner, then {1} status: {2} Closed, {3} No Show, {4} Scheduled)."
		).format(
			preview.get("pending_doc_code_updates") or 0,
			preview.get("total_needing_update") or 0,
			preview.get("to_closed") or 0,
			preview.get("to_no_show") or 0,
			preview.get("to_scheduled") or 0,
		),
	}


@frappe.whitelist()
def start_medication_order_complete_migration() -> dict:
	_require_admin()
	_acquire_lock("medication_orders")
	_clear_failed_medication_orders()
	_set_progress("medication_orders", 0)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_medication_order_complete_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_complete_medication_orders",
	)
	return {
		"ok": True,
		"message": _("Submit & complete Patient Medication Orders job started in the background."),
	}


LEGACY_PMO_SIGNATURE = "/files/legacy-migration-signature.png"

# 1×1 transparent PNG used as the public placeholder for legacy / migrated PMOs.
_LEGACY_PMO_SIGNATURE_PNG = (
	b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
	b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
	b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def ensure_legacy_pmo_signature_file() -> str:
	"""Create the public placeholder PNG if missing so Attach Image saves do not fail."""
	import os

	file_url = LEGACY_PMO_SIGNATURE
	rel = file_url.lstrip("/")
	abs_path = frappe.get_site_path("public", *rel.split("/"))
	os.makedirs(os.path.dirname(abs_path), exist_ok=True)
	if not os.path.exists(abs_path):
		with open(abs_path, "wb") as handle:
			handle.write(_LEGACY_PMO_SIGNATURE_PNG)
	return file_url


def _failed_job_names_key(job: str) -> str:
	return f"healthcare:data_migration:{job}:failed"


def _mark_job_name_failed(job: str, name: str) -> None:
	failed = set(frappe.cache().get_value(_failed_job_names_key(job)) or [])
	failed.add(name)
	frappe.cache().set_value(_failed_job_names_key(job), list(failed), expires_in_sec=JOB_LOCK_SECONDS)


def _clear_failed_job_names(job: str) -> None:
	frappe.cache().delete_value(_failed_job_names_key(job))


def _job_date_range_key(job: str) -> str:
	return f"healthcare:data_migration:{job}:date_range"


def _set_job_date_range(job: str, from_date, to_date) -> None:
	frappe.cache().set_value(
		_job_date_range_key(job),
		{"from_date": str(getdate(from_date)), "to_date": str(getdate(to_date))},
		expires_in_sec=JOB_LOCK_SECONDS,
	)


def _get_job_date_range(job: str) -> tuple:
	payload = frappe.cache().get_value(_job_date_range_key(job)) or {}
	return getdate(payload.get("from_date")), getdate(payload.get("to_date"))


def _pmo_names_for_date_range(
	from_date,
	to_date,
	*,
	failed_skip: list | None = None,
	limit: int = MEDICATION_ORDER_BATCH_SIZE,
) -> list[str]:
	from_date = getdate(from_date)
	to_date = getdate(to_date)
	params = {"from_date": from_date, "to_date": to_date}
	conditions = [
		"docstatus != 2",
		"IFNULL(status, '') NOT IN ('Completed', 'Cancelled')",
		"""(
			(posting_date IS NOT NULL AND posting_date BETWEEN %(from_date)s AND %(to_date)s)
			OR (
				(posting_date IS NULL OR posting_date = '')
				AND start_date IS NOT NULL
				AND start_date BETWEEN %(from_date)s AND %(to_date)s
			)
		)""",
	]
	if failed_skip:
		conditions.append("name NOT IN %(failed_skip)s")
		params["failed_skip"] = tuple(failed_skip)

	return frappe.db.sql(
		f"""
		SELECT name
		FROM `tabPatient Medication Order`
		WHERE {" AND ".join(conditions)}
		ORDER BY name ASC
		LIMIT {cint(limit)}
		""",
		params,
		pluck="name",
	)


def _count_pmo_sign_candidates() -> int:
	return cint(
		frappe.db.sql(
			"""
			SELECT COUNT(*)
			FROM `tabPatient Medication Order`
			WHERE docstatus != 2
				AND IFNULL(status, '') NOT IN ('Completed', 'Cancelled')
				AND (
					doctors_signature IS NULL
					OR TRIM(doctors_signature) = ''
				)
			"""
		)[0][0]
	)


def _pmo_names_for_sign(*, failed_skip: list | None = None, limit: int = MEDICATION_ORDER_BATCH_SIZE) -> list[str]:
	params: dict = {}
	conditions = [
		"docstatus != 2",
		"IFNULL(status, '') NOT IN ('Completed', 'Cancelled')",
		"(doctors_signature IS NULL OR TRIM(doctors_signature) = '')",
	]
	if failed_skip:
		conditions.append("name NOT IN %(failed_skip)s")
		params["failed_skip"] = tuple(failed_skip)

	return frappe.db.sql(
		f"""
		SELECT name
		FROM `tabPatient Medication Order`
		WHERE {" AND ".join(conditions)}
		ORDER BY name ASC
		LIMIT {cint(limit)}
		""",
		params,
		pluck="name",
	)


@frappe.whitelist()
def preview_pmo_sign_migration() -> dict:
	"""Count submitted/draft PMOs that still need a doctor signature."""
	_require_admin()
	return {"candidates": _count_pmo_sign_candidates()}


@frappe.whitelist()
def start_pmo_sign_migration() -> dict:
	"""Submit draft PMOs if needed, attach legacy signature, and set status Signed."""
	_require_admin()
	preview = preview_pmo_sign_migration()
	if not cint(preview.get("candidates")):
		return {
			"ok": True,
			"message": _("No Patient Medication Orders need signing."),
		}

	job = "pmo_sign"
	_acquire_lock(job)
	_clear_failed_job_names(job)
	_set_progress(job, 0, candidates=preview.get("candidates"))
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_pmo_sign_batch",
		queue="long",
		timeout=3600,
		job_name="healthcare_pmo_sign",
	)
	return {
		"ok": True,
		"message": _("Sign Patient Medication Orders job started ({0} candidate(s)).").format(
			preview.get("candidates") or 0
		),
	}


@frappe.whitelist()
def preview_pmo_complete_by_date(from_date=None, to_date=None) -> dict:
	"""Count non-completed PMOs whose posting_date (or start_date) falls in the range."""
	_require_admin()
	if not from_date or not to_date:
		frappe.throw(_("From Date and To Date are required"))
	from_date = getdate(from_date)
	to_date = getdate(to_date)
	if from_date > to_date:
		frappe.throw(_("From Date must be on or before To Date"))

	candidates = cint(
		frappe.db.sql(
			"""
			SELECT COUNT(*)
			FROM `tabPatient Medication Order`
			WHERE docstatus != 2
				AND IFNULL(status, '') NOT IN ('Completed', 'Cancelled')
				AND (
					(posting_date IS NOT NULL AND posting_date BETWEEN %(from_date)s AND %(to_date)s)
					OR (
						(posting_date IS NULL OR posting_date = '')
						AND start_date IS NOT NULL
						AND start_date BETWEEN %(from_date)s AND %(to_date)s
					)
				)
			""",
			{"from_date": from_date, "to_date": to_date},
		)[0][0]
	)
	return {
		"from_date": str(from_date),
		"to_date": str(to_date),
		"candidates": candidates,
	}


@frappe.whitelist()
def start_pmo_complete_by_date_migration(from_date=None, to_date=None) -> dict:
	"""Submit and complete PMOs in a posting_date / start_date range."""
	_require_admin()
	preview = preview_pmo_complete_by_date(from_date, to_date)
	if not cint(preview.get("candidates")):
		return {
			"ok": True,
			"message": _("No Patient Medication Orders found in that date range to complete."),
		}

	job = "pmo_complete_by_date"
	_acquire_lock(job)
	_clear_failed_job_names(job)
	_set_job_date_range(job, preview["from_date"], preview["to_date"])
	_set_progress(
		job,
		0,
		from_date=preview.get("from_date"),
		to_date=preview.get("to_date"),
		candidates=preview.get("candidates"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_pmo_complete_by_date_batch",
		queue="long",
		timeout=3600,
		job_name="healthcare_pmo_complete_by_date",
	)
	return {
		"ok": True,
		"message": _(
			"Complete Patient Medication Orders job started for {0} to {1} ({2} candidate(s))."
		).format(preview.get("from_date"), preview.get("to_date"), preview.get("candidates") or 0),
	}


def _pmo_admission_link_join_sql() -> str:
	return """
		INNER JOIN `tabInpatient Admission` adm ON (
			(pmo.inpatient_record IS NOT NULL AND pmo.inpatient_record != '' AND pmo.inpatient_record = adm.name)
			OR (
				pmo.written_inpatient_admission IS NOT NULL
				AND pmo.written_inpatient_admission != ''
				AND pmo.written_inpatient_admission = adm.name
			)
		)
	"""


def _pmo_status_filter_for_admission_action(action: str) -> str:
	if action == "sign":
		return "AND IFNULL(pmo.status, '') NOT IN ('Signed', 'In Process', 'Completed', 'Cancelled')"
	if action == "complete":
		return "AND IFNULL(pmo.status, '') NOT IN ('Completed', 'Cancelled')"
	return ""


def _count_pmo_for_admission_status(admission_status: str, *, action: str) -> int:
	return cint(
		frappe.db.sql(
			f"""
			SELECT COUNT(*)
			FROM `tabPatient Medication Order` pmo
			{_pmo_admission_link_join_sql()}
			WHERE pmo.docstatus != 2
				AND adm.status = %(admission_status)s
				{_pmo_status_filter_for_admission_action(action)}
			""",
			{"admission_status": admission_status},
		)[0][0]
	)


def _pmo_names_for_admission_status(
	admission_status: str,
	*,
	action: str,
	failed_skip: list | None = None,
	limit: int = MEDICATION_ORDER_BATCH_SIZE,
) -> list[str]:
	params: dict = {"admission_status": admission_status}
	failed_clause = ""
	if failed_skip:
		failed_clause = "AND pmo.name NOT IN %(failed_skip)s"
		params["failed_skip"] = tuple(failed_skip)

	return frappe.db.sql(
		f"""
		SELECT pmo.name
		FROM `tabPatient Medication Order` pmo
		{_pmo_admission_link_join_sql()}
		WHERE pmo.docstatus != 2
			AND adm.status = %(admission_status)s
			{_pmo_status_filter_for_admission_action(action)}
			{failed_clause}
		ORDER BY pmo.name ASC
		LIMIT {cint(limit)}
		""",
		params,
		pluck="name",
	)


def _ensure_pmo_legacy_signature(doc) -> None:
	if (doc.doctors_signature or "").strip():
		return
	ensure_legacy_pmo_signature_file()
	frappe.db.set_value(
		doc.doctype,
		doc.name,
		{
			"doctors_signature": LEGACY_PMO_SIGNATURE,
			"new_system": 1,
		},
		update_modified=False,
	)
	doc.doctors_signature = LEGACY_PMO_SIGNATURE
	doc.new_system = 1


def _submit_pmo_if_draft(doc) -> bool:
	if doc.docstatus != 0:
		return False
	doc.flags.ignore_mandatory = True
	doc.submit()
	doc.reload()
	return True


@frappe.whitelist()
def preview_pmo_sync_by_admission_status() -> dict:
	"""Count PMOs linked to Admitted / Discharged inpatient admissions."""
	_require_admin()
	sign_candidates = _count_pmo_for_admission_status("Admitted", action="sign")
	complete_candidates = _count_pmo_for_admission_status("Discharged", action="complete")
	return {
		"sign_candidates": sign_candidates,
		"complete_candidates": complete_candidates,
		"total_candidates": sign_candidates + complete_candidates,
	}


@frappe.whitelist()
def start_pmo_sync_by_admission_status_migration() -> dict:
	"""Sign PMOs on Admitted admissions; complete PMOs on Discharged admissions."""
	_require_admin()
	preview = preview_pmo_sync_by_admission_status()
	if not cint(preview.get("total_candidates")):
		return {
			"ok": True,
			"message": _("No Patient Medication Orders need updating by admission status."),
		}

	job = "pmo_sync_by_admission_status"
	_acquire_lock(job)
	_clear_failed_job_names(job)
	_set_progress(
		job,
		0,
		phase="sign",
		sign_candidates=preview.get("sign_candidates"),
		complete_candidates=preview.get("complete_candidates"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_pmo_sync_by_admission_status_batch",
		phase="sign",
		queue="long",
		timeout=3600,
		job_name="healthcare_pmo_sync_by_admission_status",
	)
	return {
		"ok": True,
		"message": _(
			"PMO admission-status sync started ({0} to sign on Admitted, {1} to complete on Discharged)."
		).format(
			preview.get("sign_candidates") or 0,
			preview.get("complete_candidates") or 0,
		),
	}


@frappe.whitelist()
def start_discharge_submit_migration() -> dict:
	_require_admin()
	_acquire_lock("discharges")
	_clear_failed_discharges()
	_set_progress("discharges", 0)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_discharge_submit_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_submit_discharges",
	)
	return {
		"ok": True,
		"message": _("Submit all draft Discharge documents job started in the background."),
	}


@frappe.whitelist()
def start_ip_admission_medicine_link_migration() -> dict:
	"""Create/update Patient Medication Orders from imported IP Admission Medicine rows."""
	_require_admin()
	_acquire_lock("ip_admission_medicine_link")
	_set_progress("ip_admission_medicine_link", 0)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_admission_medicine_link_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_admission_medicine_link",
	)
	return {
		"ok": True,
		"message": _("IP Admission Medicine linking job started in the background."),
	}


@frappe.whitelist()
def start_pmo_written_admission_backfill_migration() -> dict:
	"""Fill inpatient_record + patient on PMO from written_inpatient_admission."""
	_require_admin()
	from healthcare.api.patient_medication_order_admission_backfill import (
		cache_pmo_admission_backfill_names,
	)

	job = "pmo_admission_backfill"
	_acquire_lock(job)
	total = cache_pmo_admission_backfill_names()
	_set_progress(job, 0, total_orders=total)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_pmo_admission_backfill_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_pmo_admission_backfill",
	)
	return {
		"ok": True,
		"message": _(
			"Patient Medication Order admission backfill started ({0} orders with written admission)."
		).format(total),
	}


def process_pmo_admission_backfill_batch(offset: int = 0) -> None:
	from healthcare.api.patient_medication_order_admission_backfill import (
		PMO_ADMISSION_BACKFILL_BATCH_SIZE,
		load_cached_pmo_admission_backfill_names,
		run_pmo_admission_backfill_batch,
	)

	job = "pmo_admission_backfill"
	try:
		names = load_cached_pmo_admission_backfill_names()
		batch = names[offset : offset + PMO_ADMISSION_BACKFILL_BATCH_SIZE]
		if not batch:
			_set_progress(job, offset, done=True)
			_release_lock(job)
			frappe.log_error(
				title="PMO written admission backfill complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
			return

		result = run_pmo_admission_backfill_batch(batch)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = offset + len(batch)
		error_samples = list(prev.get("error_samples") or [])
		for sample in result.get("error_samples") or []:
			if len(error_samples) >= 10:
				break
			error_samples.append(sample)
		_set_progress(
			job,
			processed,
			ok=cint(prev.get("ok", 0)) + cint(result.get("ok", 0)),
			skip=cint(prev.get("skip", 0)) + cint(result.get("skip", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			error_samples=error_samples,
			total_orders=prev.get("total_orders"),
		)

		if processed < len(names):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_pmo_admission_backfill_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_pmo_admission_backfill_{processed}",
			)
		else:
			final = frappe.cache().get_value(_job_progress_key(job)) or {}
			final.update({"processed": processed, "done": True, "updated_at": str(now_datetime())})
			frappe.cache().set_value(_job_progress_key(job), final, expires_in_sec=JOB_LOCK_SECONDS)
			_release_lock(job)
			frappe.log_error(
				title="PMO written admission backfill complete",
				message=frappe.as_json(final),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_clinical_note_branch_backfill_migration() -> dict:
	"""Fill Clinical Note branch from Patient Visit or Inpatient Admission cost center."""
	_require_admin()
	from healthcare.api.clinical_note_branch_backfill import (
		cache_clinical_note_branch_backfill_names,
	)

	job = "clinical_note_branch_backfill"
	_acquire_lock(job)
	total = cache_clinical_note_branch_backfill_names()
	_set_progress(job, 0, total_notes=total)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_clinical_note_branch_backfill_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_clinical_note_branch_backfill",
	)
	return {
		"ok": True,
		"message": _("Clinical Note branch backfill started ({0} notes without branch).").format(total),
	}


def process_clinical_note_branch_backfill_batch(offset: int = 0) -> None:
	from healthcare.api.clinical_note_branch_backfill import (
		CLINICAL_NOTE_BRANCH_BACKFILL_BATCH_SIZE,
		load_cached_clinical_note_branch_backfill_names,
		run_clinical_note_branch_backfill_batch,
	)

	job = "clinical_note_branch_backfill"
	try:
		names = load_cached_clinical_note_branch_backfill_names()
		batch = names[offset : offset + CLINICAL_NOTE_BRANCH_BACKFILL_BATCH_SIZE]
		if not batch:
			_set_progress(job, offset, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Clinical Note branch backfill complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
			return

		result = run_clinical_note_branch_backfill_batch(batch)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = offset + len(batch)
		error_samples = list(prev.get("error_samples") or [])
		for sample in result.get("error_samples") or []:
			if len(error_samples) >= 10:
				break
			error_samples.append(sample)
		_set_progress(
			job,
			processed,
			ok=cint(prev.get("ok", 0)) + cint(result.get("ok", 0)),
			skip=cint(prev.get("skip", 0)) + cint(result.get("skip", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			error_samples=error_samples,
			total_notes=prev.get("total_notes"),
		)

		if processed < len(names):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_clinical_note_branch_backfill_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_clinical_note_branch_backfill_{processed}",
			)
		else:
			final = frappe.cache().get_value(_job_progress_key(job)) or {}
			final.update({"processed": processed, "done": True, "updated_at": str(now_datetime())})
			frappe.cache().set_value(_job_progress_key(job), final, expires_in_sec=JOB_LOCK_SECONDS)
			_release_lock(job)
			frappe.log_error(
				title="Clinical Note branch backfill complete",
				message=frappe.as_json(final),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_patient_visit_branch_backfill_migration(
	patient: str | None = None,
	from_date: str | None = None,
	to_date: str | None = None,
) -> dict:
	"""Fill Patient Visit cost center (branch) from Daily Patient Visit Setup / admission."""
	_require_admin()
	from healthcare.api.patient_visit_branch import (
		cache_patient_visit_branch_backfill_names,
	)

	job = "patient_visit_branch_backfill"
	_acquire_lock(job)
	total = cache_patient_visit_branch_backfill_names(
		patient=patient,
		from_date=from_date,
		to_date=to_date,
	)
	_set_progress(job, 0, total_visits=total, updated=0, errors=0)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_visit_branch_backfill_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_visit_branch_backfill",
	)
	return {
		"ok": True,
		"message": _("Patient Visit branch backfill started ({0} visits with a blank branch).").format(
			total
		),
	}


def process_patient_visit_branch_backfill_batch(offset: int = 0) -> None:
	from healthcare.api.patient_visit_branch import (
		PATIENT_VISIT_BRANCH_BACKFILL_BATCH_SIZE,
		load_cached_patient_visit_branch_backfill_names,
		run_patient_visit_branch_backfill_batch,
	)

	job = "patient_visit_branch_backfill"
	try:
		names = load_cached_patient_visit_branch_backfill_names()
		batch = names[offset : offset + PATIENT_VISIT_BRANCH_BACKFILL_BATCH_SIZE]
		if not batch:
			_set_progress(job, offset, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Patient Visit branch backfill complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
			return

		result = run_patient_visit_branch_backfill_batch(batch)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = offset + len(batch)
		error_samples = list(prev.get("error_samples") or [])
		for sample in result.get("error_samples") or []:
			if len(error_samples) >= 10:
				break
			error_samples.append(sample)
		_set_progress(
			job,
			processed,
			updated=cint(prev.get("updated", 0)) + cint(result.get("ok", 0)),
			skip=cint(prev.get("skip", 0)) + cint(result.get("skip", 0)),
			skip_has_branch=cint(prev.get("skip_has_branch", 0))
			+ cint(result.get("skip_has_branch", 0)),
			skip_legacy=cint(prev.get("skip_legacy", 0)) + cint(result.get("skip_legacy", 0)),
			skip_no_source=cint(prev.get("skip_no_source", 0))
			+ cint(result.get("skip_no_source", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			error_samples=error_samples,
			total_visits=prev.get("total_visits"),
		)

		if processed < len(names):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_visit_branch_backfill_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_visit_branch_backfill_{processed}",
			)
		else:
			final = frappe.cache().get_value(_job_progress_key(job)) or {}
			final.update({"processed": processed, "done": True, "updated_at": str(now_datetime())})
			frappe.cache().set_value(_job_progress_key(job), final, expires_in_sec=JOB_LOCK_SECONDS)
			_release_lock(job)
			frappe.log_error(
				title="Patient Visit branch backfill complete",
				message=frappe.as_json(final),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_assessment_cost_center_backfill_migration() -> dict:
	"""Fill assessment cost_center from Patient Visit or Inpatient Admission."""
	_require_admin()
	from healthcare.api.assessment_cost_center_backfill import (
		cache_assessment_cost_center_backfill_names,
	)

	job = "assessment_cost_center_backfill"
	_acquire_lock(job)
	total = cache_assessment_cost_center_backfill_names()
	_set_progress(job, 0, total_notes=total)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_assessment_cost_center_backfill_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_assessment_cost_center_backfill",
	)
	return {
		"ok": True,
		"message": _("Assessment cost center backfill started ({0} records without cost center).").format(
			total
		),
	}


def process_assessment_cost_center_backfill_batch(offset: int = 0) -> None:
	from healthcare.api.assessment_cost_center_backfill import (
		ASSESSMENT_COST_CENTER_BACKFILL_BATCH_SIZE,
		load_cached_assessment_cost_center_backfill_names,
		run_assessment_cost_center_backfill_batch,
	)

	job = "assessment_cost_center_backfill"
	try:
		names = load_cached_assessment_cost_center_backfill_names()
		batch = names[offset : offset + ASSESSMENT_COST_CENTER_BACKFILL_BATCH_SIZE]
		if not batch:
			_set_progress(job, offset, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Assessment cost center backfill complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
			return

		result = run_assessment_cost_center_backfill_batch(batch)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = offset + len(batch)
		error_samples = list(prev.get("error_samples") or [])
		for sample in result.get("error_samples") or []:
			if len(error_samples) >= 10:
				break
			error_samples.append(sample)
		_set_progress(
			job,
			processed,
			ok=cint(prev.get("ok", 0)) + cint(result.get("ok", 0)),
			skip=cint(prev.get("skip", 0)) + cint(result.get("skip", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			error_samples=error_samples,
			total_notes=prev.get("total_notes"),
		)

		if processed < len(names):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_assessment_cost_center_backfill_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_assessment_cost_center_backfill_{processed}",
			)
		else:
			final = frappe.cache().get_value(_job_progress_key(job)) or {}
			final.update({"processed": processed, "done": True, "updated_at": str(now_datetime())})
			frappe.cache().set_value(_job_progress_key(job), final, expires_in_sec=JOB_LOCK_SECONDS)
			_release_lock(job)
			frappe.log_error(
				title="Assessment cost center backfill complete",
				message=frappe.as_json(final),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_patient_assessment_cost_center_backfill_migration() -> dict:
	"""Fill Patient Assessment cost_center from encounter (visit/admission) or admission."""
	_require_admin()
	from healthcare.api.assessment_cost_center_backfill import (
		cache_patient_assessment_cost_center_backfill_names,
	)

	job = "patient_assessment_cost_center_backfill"
	_acquire_lock(job)
	total = cache_patient_assessment_cost_center_backfill_names()
	_set_progress(job, 0, total_notes=total)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_assessment_cost_center_backfill_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_assessment_cost_center_backfill",
	)
	return {
		"ok": True,
		"message": _(
			"Patient Assessment cost center backfill started ({0} records without cost center)."
		).format(total),
	}


def process_patient_assessment_cost_center_backfill_batch(offset: int = 0) -> None:
	from healthcare.api.assessment_cost_center_backfill import (
		ASSESSMENT_COST_CENTER_BACKFILL_BATCH_SIZE,
		load_cached_patient_assessment_cost_center_backfill_names,
		run_assessment_cost_center_backfill_batch,
	)

	job = "patient_assessment_cost_center_backfill"
	try:
		names = load_cached_patient_assessment_cost_center_backfill_names()
		batch = names[offset : offset + ASSESSMENT_COST_CENTER_BACKFILL_BATCH_SIZE]
		if not batch:
			_set_progress(job, offset, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Patient Assessment cost center backfill complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
			return

		result = run_assessment_cost_center_backfill_batch(batch)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = offset + len(batch)
		error_samples = list(prev.get("error_samples") or [])
		for sample in result.get("error_samples") or []:
			if len(error_samples) >= 10:
				break
			error_samples.append(sample)
		_set_progress(
			job,
			processed,
			ok=cint(prev.get("ok", 0)) + cint(result.get("ok", 0)),
			skip=cint(prev.get("skip", 0)) + cint(result.get("skip", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			error_samples=error_samples,
			total_notes=prev.get("total_notes"),
		)

		if processed < len(names):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_assessment_cost_center_backfill_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_assessment_cost_center_backfill_{processed}",
			)
		else:
			final = frappe.cache().get_value(_job_progress_key(job)) or {}
			final.update({"processed": processed, "done": True, "updated_at": str(now_datetime())})
			frappe.cache().set_value(_job_progress_key(job), final, expires_in_sec=JOB_LOCK_SECONDS)
			_release_lock(job)
			frappe.log_error(
				title="Patient Assessment cost center backfill complete",
				message=frappe.as_json(final),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_physical_examination_cost_center_backfill_migration() -> dict:
	"""Fill Physical Examination cost_center from Patient Visit or Inpatient Admission."""
	_require_admin()
	from healthcare.api.assessment_cost_center_backfill import (
		cache_physical_examination_cost_center_backfill_names,
	)

	job = "physical_examination_cost_center_backfill"
	_acquire_lock(job)
	total = cache_physical_examination_cost_center_backfill_names()
	_set_progress(job, 0, total_notes=total)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_physical_examination_cost_center_backfill_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_physical_examination_cost_center_backfill",
	)
	return {
		"ok": True,
		"message": _(
			"Physical Examination cost center backfill started ({0} records without cost center)."
		).format(total),
	}


def process_physical_examination_cost_center_backfill_batch(offset: int = 0) -> None:
	from healthcare.api.assessment_cost_center_backfill import (
		ASSESSMENT_COST_CENTER_BACKFILL_BATCH_SIZE,
		load_cached_physical_examination_cost_center_backfill_names,
		run_assessment_cost_center_backfill_batch,
	)

	job = "physical_examination_cost_center_backfill"
	try:
		names = load_cached_physical_examination_cost_center_backfill_names()
		batch = names[offset : offset + ASSESSMENT_COST_CENTER_BACKFILL_BATCH_SIZE]
		if not batch:
			_set_progress(job, offset, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Physical Examination cost center backfill complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
			return

		result = run_assessment_cost_center_backfill_batch(batch)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = offset + len(batch)
		error_samples = list(prev.get("error_samples") or [])
		for sample in result.get("error_samples") or []:
			if len(error_samples) >= 10:
				break
			error_samples.append(sample)
		_set_progress(
			job,
			processed,
			ok=cint(prev.get("ok", 0)) + cint(result.get("ok", 0)),
			skip=cint(prev.get("skip", 0)) + cint(result.get("skip", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			error_samples=error_samples,
			total_notes=prev.get("total_notes"),
		)

		if processed < len(names):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_physical_examination_cost_center_backfill_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_physical_examination_cost_center_backfill_{processed}",
			)
		else:
			final = frappe.cache().get_value(_job_progress_key(job)) or {}
			final.update({"processed": processed, "done": True, "updated_at": str(now_datetime())})
			frappe.cache().set_value(_job_progress_key(job), final, expires_in_sec=JOB_LOCK_SECONDS)
			_release_lock(job)
			frappe.log_error(
				title="Physical Examination cost center backfill complete",
				message=frappe.as_json(final),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_ip_admission_medicine_sheet_map_migration() -> dict:
	"""Map IP Admission Medicine Sheet rows into Admission Detail child tables."""
	_require_admin()
	_acquire_lock("ip_admission_medicine_sheet_map")
	_set_progress("ip_admission_medicine_sheet_map", 0)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_admission_medicine_sheet_map_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_admission_medicine_sheet_map",
	)
	return {
		"ok": True,
		"message": _("IP Admission Medicine Sheet mapping job started in the background."),
	}


@frappe.whitelist()
def start_ip_admission_medicine_sheet_given_import_migration(file_url: str) -> dict:
	"""Import IP_ADMISSION_MEDICINE_SHEET Excel directly into Admission Detail given medicine rows."""
	_require_admin()
	from healthcare.api.ip_admission_medicine_sheet_given_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_ADMISSION_MEDICINE_SHEET Excel file."))

	job = "ip_admission_medicine_sheet_given_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		raw_excel_rows=summary.get("raw_excel_rows"),
		admissions=summary.get("admissions"),
		given_rows=summary.get("given_rows"),
		not_given_rows=summary.get("not_given_rows"),
		staging_existing=summary.get("existing_rows"),
		staging_new=summary.get("new_rows"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_admission_medicine_sheet_given_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_admission_medicine_sheet_given_import",
	)
	return {
		"ok": True,
		"message": _(
			"Admission Detail given medicine import started ({0} rows, {1} given rows, {2} admissions)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("given_rows") or 0,
			summary.get("admissions") or 0,
		),
	}


@frappe.whitelist()
def start_ip_patient_assessment_map_migration() -> dict:
	"""Map imported IP Patient Assessment rows to Patient Assessment."""
	_require_admin()
	_acquire_lock("ip_patient_assessment_map")
	_set_progress("ip_patient_assessment_map", 0)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_patient_assessment_map_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_patient_assessment_map",
	)
	return {
		"ok": True,
		"message": _("IP Patient Assessment mapping job started in the background."),
	}


@frappe.whitelist()
def start_clinical_note_type_from_flag_migration() -> dict:
	"""Set Clinical Note Type from legacy diagnosis_flag (and IP nurse notes when applicable)."""
	_require_admin()
	_acquire_lock("clinical_note_type_from_flag")
	_set_progress("clinical_note_type_from_flag", 0)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_clinical_note_type_from_flag_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_clinical_note_type_from_flag",
	)
	return {
		"ok": True,
		"message": _("Clinical Note type mapping job started in the background."),
	}


@frappe.whitelist()
def start_patient_visit_encounter_comment_clinical_note_migration() -> dict:
	"""Create Doctor Progress Notes from Patient Visit.encounter_comment (non-empty only)."""
	_require_admin()
	from healthcare.api.patient_visit_encounter_comment_clinical_note import (
		migration_disabled_message,
		preview_patient_visit_encounter_comment_clinical_note,
		migration_enabled,
	)

	if not migration_enabled():
		return {"ok": False, "message": migration_disabled_message()}

	job = "patient_visit_encounter_comment_clinical_note"
	preview = preview_patient_visit_encounter_comment_clinical_note()
	if not cint(preview.get("total_with_comment")):
		return {
			"ok": True,
			"message": _("No Patient Visits with encounter_comment found."),
		}

	_acquire_lock(job)
	_set_progress(
		job,
		0,
		total_with_comment=preview.get("total_with_comment"),
		already_linked=preview.get("already_linked"),
		to_create=preview.get("to_create"),
		stopped=False,
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_visit_encounter_comment_clinical_note_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_visit_encounter_comment_clinical_note",
	)
	return {
		"ok": True,
		"message": _(
			"Patient Visit encounter_comment → Clinical Note job started ({0} visits with comment, {1} to create, {2} already linked patient+visit skipped)."
		).format(
			preview.get("total_with_comment") or 0,
			preview.get("to_create") or 0,
			preview.get("already_duplicate") or preview.get("already_linked") or 0,
		),
	}


@frappe.whitelist()
def stop_patient_visit_encounter_comment_clinical_note_migration() -> dict:
	"""Request stop of the visit encounter_comment → Clinical Note background job."""
	_require_admin()
	job = "patient_visit_encounter_comment_clinical_note"
	# Always set the stop flag. The Redis lock can disappear (worker recycle / expiry)
	# while RQ is still creating notes — refusing here left the job unstoppable.
	_request_stop(job)
	prev = frappe.cache().get_value(_job_progress_key(job)) or {}
	_set_progress(
		job,
		cint(prev.get("processed") or 0),
		stop_requested=True,
		done=False,
		**{
			k: prev.get(k)
			for k in prev
			if k
			not in (
				"processed",
				"done",
				"error",
				"stop_requested",
				"stopped",
				"updated_at",
			)
		},
	)
	if not _job_appears_active(job) and not prev:
		return {
			"ok": True,
			"message": _(
				"Stop signal sent. No active job lock was found — if a worker is still "
				"creating Clinical Notes, it will halt after the current visit."
			),
		}
	return {
		"ok": True,
		"message": _(
			"Stop requested. The Clinical Notes job will halt after the current visit "
			"(no further batches will be queued)."
		),
	}


def _finalize_patient_visit_encounter_comment_job_stopped(job: str, processed: int) -> None:
	prev = frappe.cache().get_value(_job_progress_key(job)) or {}
	_set_progress(
		job,
		processed,
		done=True,
		stopped=True,
		created=cint(prev.get("created")),
		skipped_existing=cint(prev.get("skipped_existing")),
		skipped_no_patient=cint(prev.get("skipped_no_patient")),
		skipped_no_comment=cint(prev.get("skipped_no_comment")),
		errors=cint(prev.get("errors")),
		total_with_comment=prev.get("total_with_comment"),
		already_linked=prev.get("already_linked"),
		to_create=prev.get("to_create"),
	)
	_release_lock(job)
	frappe.db.commit()
	frappe.log_error(
		title="Patient Visit encounter_comment → Clinical Note migration stopped",
		message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
	)


def process_patient_visit_encounter_comment_clinical_note_batch(offset: int = 0) -> None:
	from healthcare.api.patient_visit_encounter_comment_clinical_note import (
		run_patient_visit_encounter_comment_clinical_note_batch,
	)

	job = "patient_visit_encounter_comment_clinical_note"
	try:
		_renew_lock(job)
		if _stop_requested(job):
			_finalize_patient_visit_encounter_comment_job_stopped(job, cint(offset))
			return

		result = run_patient_visit_encounter_comment_clinical_note_batch(
			offset=offset,
			stop_check=lambda: _stop_requested(job),
		)
		processed = result.get("next_offset") or offset
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created")) + cint(result.get("created")),
			skipped_existing=cint(prev.get("skipped_existing")) + cint(result.get("skipped_existing")),
			skipped_no_patient=cint(prev.get("skipped_no_patient")) + cint(result.get("skipped_no_patient")),
			skipped_no_comment=cint(prev.get("skipped_no_comment")) + cint(result.get("skipped_no_comment")),
			errors=cint(prev.get("errors")) + cint(result.get("errors")),
			total_with_comment=prev.get("total_with_comment"),
			already_linked=prev.get("already_linked"),
			to_create=prev.get("to_create"),
		)

		if result.get("stopped") or _stop_requested(job):
			_finalize_patient_visit_encounter_comment_job_stopped(job, processed)
			return

		if result.get("has_more"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_visit_encounter_comment_clinical_note_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_visit_encounter_comment_clinical_note_{processed}",
			)
		else:
			final = frappe.cache().get_value(_job_progress_key(job)) or {}
			_set_progress(job, processed, done=True, **{k: final.get(k) for k in final if k != "done"})
			_release_lock(job)
			frappe.log_error(
				title="Patient Visit encounter_comment → Clinical Note migration complete",
				message=frappe.as_json(final),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def preview_patient_legacy_gender_fix() -> dict:
	"""Count Patient / Warning Message rows still using legacy sex codes 1 / 2."""
	_require_admin()
	patients_sex_1 = frappe.db.count("Patient", {"sex": "1"})
	patients_sex_2 = frappe.db.count("Patient", {"sex": "2"})
	warning_messages = frappe.db.count("Warning Message", {"gender": ["in", ["1", "2"]]})
	return {
		"patients_sex_1": patients_sex_1,
		"patients_sex_2": patients_sex_2,
		"patients_total": patients_sex_1 + patients_sex_2,
		"warning_messages": warning_messages,
	}


@frappe.whitelist()
def start_patient_legacy_gender_fix_migration() -> dict:
	"""Replace legacy Patient.sex codes 1 → Male, 2 → Female (and linked warning messages)."""
	_require_admin()
	preview = preview_patient_legacy_gender_fix()
	if not cint(preview.get("patients_total")) and not cint(preview.get("warning_messages")):
		return {
			"ok": True,
			"message": _("No patients or warning messages with legacy gender codes 1 / 2 found."),
		}

	job = "patient_legacy_gender_fix"
	_acquire_lock(job)
	_set_progress(
		job,
		0,
		patients_sex_1=preview.get("patients_sex_1"),
		patients_sex_2=preview.get("patients_sex_2"),
		warning_messages=preview.get("warning_messages"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_legacy_gender_fix_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_legacy_gender_fix",
	)
	return {
		"ok": True,
		"message": _(
			"Patient gender fix started ({0} patients, {1} warning messages to check)."
		).format(preview.get("patients_total") or 0, preview.get("warning_messages") or 0),
	}


@frappe.whitelist()
def start_morse_fall_scale_detail_migration() -> dict:
	"""Backfill Morse Fall Scale detail lines from MORSE_FALL_SCALE_01 staging."""
	_require_admin()
	from healthcare.api.morse_fall_scale_detail_import import preview_morse_fall_scale_detail_import

	job = "morse_fall_scale_detail"
	_acquire_lock(job)
	preview = preview_morse_fall_scale_detail_import()
	_set_progress(
		job,
		0,
		staging_rows=preview.get("staging_rows"),
		resolvable=preview.get("resolvable"),
		unresolved=preview.get("unresolved"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_morse_fall_scale_detail_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_morse_fall_scale_detail",
	)
	return {
		"ok": True,
		"message": _(
			"Morse Fall Scale detail backfill started ({0} staging rows, {1} resolvable)."
		).format(preview.get("staging_rows", 0), preview.get("resolvable", 0)),
	}


@frappe.whitelist()
def start_morse_fall_scale_detail_dedupe_migration() -> dict:
	"""Delete duplicate Morse Fall Scale Detail rows (one row per text message per scale)."""
	_require_admin()
	from healthcare.api.morse_fall_scale_detail_dedupe import preview_morse_fall_scale_detail_dedupe

	job = "morse_fall_scale_detail_dedupe"
	preview = preview_morse_fall_scale_detail_dedupe()
	if not cint(preview.get("rows_to_delete")):
		return {
			"ok": True,
			"message": _("No duplicate Morse Fall Scale detail rows found."),
		}

	_acquire_lock(job)
	_set_progress(
		job,
		0,
		parents_affected=preview.get("parents_affected"),
		rows_to_delete=preview.get("rows_to_delete"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_morse_fall_scale_detail_dedupe_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_morse_fall_scale_detail_dedupe",
	)
	return {
		"ok": True,
		"message": _(
			"Morse Fall Scale detail dedupe started ({0} scale(s), {1} duplicate row(s) to remove)."
		).format(
			preview.get("parents_affected") or 0,
			preview.get("rows_to_delete") or 0,
		),
	}


@frappe.whitelist()
def get_migration_job_status(job: str) -> dict:
	_require_admin()
	progress = frappe.cache().get_value(_job_progress_key(job)) or {}
	running = _job_is_marked_running(job) or (
		bool(progress)
		and not progress.get("done")
		and not progress.get("stopped")
		and not progress.get("error")
	)
	return {
		**progress,
		"running": running,
		"stop_requested": _stop_requested(job) or bool(progress.get("stop_requested")),
	}


def _patient_history_import_admissions_cache_key() -> str:
	return "healthcare:data_migration:patient_history_import:admissions"


def _patient_history_import_grouped_cache_key() -> str:
	return "healthcare:data_migration:patient_history_import:grouped"


@frappe.whitelist()
def start_patient_history_import_migration() -> dict:
	_require_admin()
	from healthcare.api.patient_history_import import (
		_default_template_name,
		_fetch_import_rows,
		_group_rows_by_import_key,
	)

	_acquire_lock("patient_history_import")
	rows = _fetch_import_rows()
	by_admission, unresolved = _group_rows_by_import_key(rows)
	admission_keys = sorted(by_admission.keys())
	frappe.cache().set_value(
		_patient_history_import_admissions_cache_key(),
		admission_keys,
		expires_in_sec=JOB_LOCK_SECONDS,
	)
	frappe.cache().set_value(
		_patient_history_import_grouped_cache_key(),
		by_admission,
		expires_in_sec=JOB_LOCK_SECONDS,
	)
	_set_progress(
		"patient_history_import",
		0,
		total_admissions=len(admission_keys),
		unresolved_rows=len(unresolved),
		template=_default_template_name(),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_history_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_history_import",
	)
	return {
		"ok": True,
		"message": _(
			"Patient History import started in the background ({0} admissions, {1} unresolved rows)."
		).format(len(admission_keys), len(unresolved)),
	}


@frappe.whitelist()
def start_patient_history_orphan_cleanup_migration() -> dict:
	"""Clean Patient History orphans/duplicates and duplicate Inpatient Admissions."""
	_require_admin()
	from healthcare.api.patient_history_orphan_cleanup import run_patient_history_orphan_cleanup_preview

	preview = run_patient_history_orphan_cleanup_preview()
	_acquire_lock("patient_history_orphan_cleanup")
	_set_progress(
		"patient_history_orphan_cleanup",
		0,
		orphaned_count=preview.get("orphaned_count") or 0,
		duplicate_patient_history_count=preview.get("duplicate_patient_history_count") or 0,
		duplicate_admission_groups=preview.get("duplicate_admission_groups") or 0,
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_history_orphan_cleanup_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_history_orphan_cleanup",
	)
	total_work = (
		cint(preview.get("orphaned_count") or 0)
		+ cint(preview.get("duplicate_patient_history_count") or 0)
		+ cint(preview.get("duplicate_admissions_to_remove") or 0)
	)
	return {
		"ok": True,
		"message": _(
			"Patient History / admission cleanup started in the background "
			"({0} orphan history, {1} duplicate history, {2} duplicate admission(s) to remove)."
		).format(
			preview.get("orphaned_count") or 0,
			preview.get("duplicate_patient_history_count") or 0,
			preview.get("duplicate_admissions_to_remove") or 0,
		),
		"total_work": total_work,
	}


@frappe.whitelist()
def start_patient_history_date_backfill_migration() -> dict:
	"""Set Patient History.date from Patient History Import CR Date (matched by admission)."""
	_require_admin()
	from healthcare.api.patient_history_date_backfill import run_patient_history_date_backfill_preview

	preview = run_patient_history_date_backfill_preview()
	_acquire_lock("patient_history_date_backfill")
	_set_progress(
		"patient_history_date_backfill",
		0,
		missing_date=preview.get("missing_date") or 0,
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_history_date_backfill_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_history_date_backfill",
	)
	return {
		"ok": True,
		"message": _(
			"Patient History date backfill started in the background ({0} record(s) missing date)."
		).format(preview.get("missing_date") or 0),
	}


# ── Batch workers ─────────────────────────────────────────────────────────────


def process_patient_category_customer_group_batch(offset: int = 0) -> None:
	"""Set customer_group = category name for patients that have a category."""
	from healthcare.healthcare.doctype.patient.patient import ensure_customer_group_for_category

	job = "patient_category_customer_group"
	try:
		rows = frappe.db.sql(
			"""
			SELECT name, category, customer_group, customer
			FROM `tabPatient`
			ORDER BY name
			LIMIT %s OFFSET %s
			""",
			(PATIENT_BATCH_SIZE, offset),
			as_dict=True,
		)

		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		updated = cint(prev.get("updated"))
		skipped_no_category = cint(prev.get("skipped_no_category"))

		for row in rows:
			category = (row.get("category") or "").strip()
			if not category:
				skipped_no_category += 1
				continue

			_ensure_patient_category(category)
			target_cg = ensure_customer_group_for_category(category)
			current_cg = (row.get("customer_group") or "").strip()

			patient_changed = current_cg != target_cg
			if patient_changed:
				frappe.db.set_value(
					"Patient",
					row.name,
					"customer_group",
					target_cg,
					update_modified=False,
				)

			customer = (row.get("customer") or "").strip()
			if customer:
				customer_cg = frappe.db.get_value("Customer", customer, "customer_group")
				if (customer_cg or "").strip() != target_cg:
					frappe.db.set_value(
						"Customer",
						customer,
						"customer_group",
						target_cg,
						update_modified=False,
					)
					patient_changed = True

			if patient_changed:
				updated += 1

		frappe.db.commit()
		processed = offset + len(rows)
		_set_progress(
			job,
			processed,
			updated=updated,
			skipped_no_category=skipped_no_category,
		)

		if len(rows) >= PATIENT_BATCH_SIZE:
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_category_customer_group_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_sync_patient_category_customer_group_{processed}",
			)
		else:
			_set_progress(
				job,
				processed,
				done=True,
				updated=updated,
				skipped_no_category=skipped_no_category,
			)
			_release_lock(job)
			frappe.log_error(
				title="Healthcare patient category → customer group sync complete",
				message=(
					f"Scanned {processed} patient row(s); updated {updated}; "
					f"skipped without category {skipped_no_category}."
				),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


def process_patient_migration_batch(offset: int = 0) -> None:
	try:
		for name in ("Military", "VIP", "Regular"):
			_ensure_patient_category(name)
		_ensure_customer_group_patient()

		rows = frappe.db.sql(
			"""
			SELECT name, category, customer_group, customer
			FROM `tabPatient`
			ORDER BY name
			LIMIT %s OFFSET %s
			""",
			(PATIENT_BATCH_SIZE, offset),
			as_dict=True,
		)

		updated = 0
		for row in rows:
			updates = _patient_row_updates(row)
			if not updates:
				continue
			frappe.db.set_value("Patient", row.name, updates, update_modified=False)
			if updates.get("customer_group") == "Patient" and row.get("customer"):
				frappe.db.set_value(
					"Customer",
					row.customer,
					"customer_group",
					"Patient",
					update_modified=False,
				)
			updated += 1

		frappe.db.commit()
		processed = offset + len(rows)
		_set_progress("patients", processed)

		if len(rows) >= PATIENT_BATCH_SIZE:
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_migration_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_migrate_patients_{processed}",
			)
		else:
			_set_progress("patients", processed, done=True)
			_release_lock("patients")
			frappe.log_error(
				title="Healthcare patient migration complete",
				message=f"Processed {processed} patient row(s); updated {updated} in final batch.",
			)
	except Exception:
		frappe.db.rollback()
		_set_progress("patients", cint(offset), done=True, error=frappe.get_traceback())
		_release_lock("patients")
		raise


def process_admission_migration_batch(offset: int = 0) -> None:
	try:
		names = frappe.get_all(
			"Inpatient Admission",
			filters={"status": "Admission Scheduled"},
			pluck="name",
			order_by="name asc",
			limit_page_length=ADMISSION_BATCH_SIZE,
		)

		for name in names:
			frappe.db.set_value(
				"Inpatient Admission",
				name,
				"status",
				"Discharged",
				update_modified=False,
			)

		frappe.db.commit()
		prev = frappe.cache().get_value(_job_progress_key("admissions")) or {}
		processed = cint(prev.get("processed", 0)) + len(names)
		_set_progress("admissions", processed)

		if len(names) >= ADMISSION_BATCH_SIZE:
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_admission_migration_batch",
				offset=0,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_migrate_admissions_{processed}",
			)
		else:
			_set_progress("admissions", processed, done=True)
			_release_lock("admissions")
			frappe.log_error(
				title="Healthcare admission migration complete",
				message=f"Set {processed} admission(s) from Admission Scheduled to Discharged.",
			)
	except Exception:
		frappe.db.rollback()
		_set_progress("admissions", cint(offset), done=True, error=frappe.get_traceback())
		_release_lock("admissions")
		raise


def _failed_visits_key() -> str:
	return "healthcare:data_migration:patient_visits:failed"


def _mark_visit_failed(name: str) -> None:
	failed = set(frappe.cache().get_value(_failed_visits_key()) or [])
	failed.add(name)
	frappe.cache().set_value(_failed_visits_key(), list(failed), expires_in_sec=JOB_LOCK_SECONDS)


def _clear_failed_visits() -> None:
	frappe.cache().delete_value(_failed_visits_key())


def process_patient_visit_migration_batch(offset: int = 0) -> None:
	try:
		failed_skip = frappe.cache().get_value(_failed_visits_key()) or []
		filters: dict = {
			"docstatus": ["!=", 2],
			"status": ["not in", ["Completed", "Cancelled"]],
		}
		if failed_skip:
			filters["name"] = ["not in", failed_skip]

		visits = frappe.get_all(
			"Patient Visit",
			filters=filters,
			pluck="name",
			order_by="name asc",
			limit_page_length=VISIT_BATCH_SIZE,
		)

		submitted = 0
		completed = 0
		failed = 0
		for name in visits:
			try:
				doc = frappe.get_doc("Patient Visit", name)
				if doc.docstatus == 2:
					continue
				if doc.docstatus == 0:
					doc.flags.ignore_mandatory = True
					doc.submit()
					submitted += 1
					doc.reload()

				doc.db_set("status", "Completed", update_modified=False)
				completed += 1
			except Exception:
				failed += 1
				_mark_visit_failed(name)
				frappe.log_error(
					title=f"Patient Visit submit/complete failed: {name}",
					message=frappe.get_traceback(),
				)

		frappe.db.commit()
		prev = frappe.cache().get_value(_job_progress_key("patient_visits")) or {}
		processed = cint(prev.get("processed", 0)) + len(visits)
		_set_progress("patient_visits", processed)

		if len(visits) >= VISIT_BATCH_SIZE:
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_visit_migration_batch",
				offset=0,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_migrate_patient_visits_{processed}",
			)
		else:
			_set_progress("patient_visits", processed, done=True)
			_release_lock("patient_visits")
			_clear_failed_visits()
			frappe.log_error(
				title="Healthcare Patient Visit migration complete",
				message=(
					f"Processed {processed} visit(s). "
					f"Submitted {submitted} in final batch; marked {completed} Completed; "
					f"{failed} failed (see Error Log)."
				),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress("patient_visits", cint(offset), done=True, error=frappe.get_traceback())
		_release_lock("patient_visits")
		_clear_failed_visits()
		raise


def process_appointment_old_status_batch(offset: int = 0, phase: str = "doc_code") -> None:
	from healthcare.api.patient_appointment_old_status_backfill import (
		clear_appointments_excel_cache,
		run_patient_appointment_doc_code_backfill_batch,
		run_patient_appointment_old_status_backfill_batch,
	)

	job = "appointment_old_status"
	try:
		if phase == "doc_code":
			result = run_patient_appointment_doc_code_backfill_batch(offset=offset)
			processed = cint(result.get("processed") or 0)
			stats = result.get("stats") or {}
			_set_progress(
				job,
				processed,
				phase="doc_code",
				ok=processed,
				errors=stats.get("errors") or 0,
				remaining=result.get("remaining"),
				stats=stats,
			)

			if not result.get("done"):
				frappe.enqueue(
					"healthcare.api.data_migration_jobs.process_appointment_old_status_batch",
					offset=processed,
					phase="doc_code",
					queue="long",
					timeout=3600,
					job_name=f"healthcare_appointment_doc_code_{processed}",
				)
				return

			clear_appointments_excel_cache()
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_appointment_old_status_batch",
				offset=0,
				phase="status",
				queue="long",
				timeout=3600,
				job_name="healthcare_appointment_old_status",
			)
			return

		result = run_patient_appointment_old_status_backfill_batch(offset=offset)
		processed = cint(result.get("processed") or 0)
		stats = result.get("stats") or {}
		_set_progress(
			job,
			processed,
			phase="status",
			ok=processed,
			errors=stats.get("errors") or 0,
			remaining=stats.get("remaining"),
			stats=stats,
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_appointment_old_status_batch",
				offset=processed,
				phase="status",
				queue="long",
				timeout=3600,
				job_name=f"healthcare_appointment_old_status_{processed}",
			)
		else:
			_set_progress(
				job,
				processed,
				done=True,
				phase="status",
				ok=processed,
				errors=stats.get("errors") or 0,
				stats=stats,
			)
			_release_lock(job)
			frappe.log_error(
				title="Healthcare appointment Oracle backfill complete",
				message=frappe.as_json(stats),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


def process_appointment_close_batch(offset: int = 0) -> None:
	try:
		appointments = frappe.get_all(
			"Patient Appointment",
			filters={"status": ["not in", ["Closed", "Cancelled"]]},
			pluck="name",
			order_by="name asc",
			limit_page_length=APPOINTMENT_BATCH_SIZE,
		)

		for name in appointments:
			frappe.db.set_value(
				"Patient Appointment",
				name,
				"status",
				"Closed",
				update_modified=False,
			)

		frappe.db.commit()
		prev = frappe.cache().get_value(_job_progress_key("appointments")) or {}
		processed = cint(prev.get("processed", 0)) + len(appointments)
		_set_progress("appointments", processed)

		if len(appointments) >= APPOINTMENT_BATCH_SIZE:
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_appointment_close_batch",
				offset=0,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_close_appointments_{processed}",
			)
		else:
			_set_progress("appointments", processed, done=True)
			_release_lock("appointments")
			frappe.log_error(
				title="Healthcare appointment close migration complete",
				message=f"Set {processed} appointment(s) to Closed.",
			)
	except Exception:
		frappe.db.rollback()
		_set_progress("appointments", cint(offset), done=True, error=frappe.get_traceback())
		_release_lock("appointments")
		raise


def _failed_medication_orders_key() -> str:
	return "healthcare:data_migration:medication_orders:failed"


def _mark_medication_order_failed(name: str) -> None:
	failed = set(frappe.cache().get_value(_failed_medication_orders_key()) or [])
	failed.add(name)
	frappe.cache().set_value(_failed_medication_orders_key(), list(failed), expires_in_sec=JOB_LOCK_SECONDS)


def _clear_failed_medication_orders() -> None:
	frappe.cache().delete_value(_failed_medication_orders_key())


def process_pmo_sign_batch() -> None:
	job = "pmo_sign"
	try:
		failed_skip = frappe.cache().get_value(_failed_job_names_key(job)) or []
		names = _pmo_names_for_sign(failed_skip=failed_skip)

		submitted = 0
		signed = 0
		failed = 0
		for name in names:
			try:
				doc = frappe.get_doc("Patient Medication Order", name)
				if doc.docstatus == 2:
					continue
				if doc.docstatus == 0:
					doc.flags.ignore_mandatory = True
					doc.submit()
					submitted += 1
					doc.reload()

				if not (doc.doctors_signature or "").strip():
					ensure_legacy_pmo_signature_file()
					frappe.db.set_value(
						doc.doctype,
						doc.name,
						{
							"doctors_signature": LEGACY_PMO_SIGNATURE,
							"new_system": 1,
						},
						update_modified=False,
					)
					doc.doctors_signature = LEGACY_PMO_SIGNATURE
					doc.new_system = 1

				doc.set_status()
				signed += 1
			except Exception:
				failed += 1
				_mark_job_name_failed(job, name)
				frappe.log_error(
					title=f"Patient Medication Order sign failed: {name}",
					message=frappe.get_traceback(),
				)

		frappe.db.commit()
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = cint(prev.get("processed", 0)) + len(names)
		_set_progress(
			job,
			processed,
			submitted=submitted + cint(prev.get("submitted", 0)),
			signed=signed + cint(prev.get("signed", 0)),
			errors=failed + cint(prev.get("errors", 0)),
		)

		if len(names) >= MEDICATION_ORDER_BATCH_SIZE:
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_pmo_sign_batch",
				queue="long",
				timeout=3600,
				job_name=f"healthcare_pmo_sign_{processed}",
			)
		else:
			prev = frappe.cache().get_value(_job_progress_key(job)) or {}
			_set_progress(job, processed, done=True)
			_release_lock(job)
			_clear_failed_job_names(job)
			frappe.log_error(
				title="Healthcare Patient Medication Order sign migration complete",
				message=(
					f"Processed {processed} order(s). "
					f"Submitted {prev.get('submitted', 0)}; signed {prev.get('signed', 0)}; "
					f"{prev.get('errors', 0)} failed (see Error Log)."
				),
			)
	except Exception:
		frappe.db.rollback()
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		_set_progress(job, cint(prev.get("processed", 0)), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


def process_pmo_sync_by_admission_status_batch(phase: str = "sign") -> None:
	job = "pmo_sync_by_admission_status"
	phase = (phase or "sign").strip().lower()
	try:
		failed_skip = frappe.cache().get_value(_failed_job_names_key(job)) or []
		submitted = signed = completed = failed = 0

		if phase == "sign":
			names = _pmo_names_for_admission_status(
				"Admitted",
				action="sign",
				failed_skip=failed_skip,
			)
			for name in names:
				try:
					doc = frappe.get_doc("Patient Medication Order", name)
					if doc.docstatus == 2:
						continue
					if _submit_pmo_if_draft(doc):
						submitted += 1
					_ensure_pmo_legacy_signature(doc)
					doc.set_status()
					signed += 1
				except Exception:
					failed += 1
					_mark_job_name_failed(job, name)
					frappe.log_error(
						title=f"PMO sign by admission status failed: {name}",
						message=frappe.get_traceback(),
					)

			frappe.db.commit()
			prev = frappe.cache().get_value(_job_progress_key(job)) or {}
			processed = cint(prev.get("processed", 0)) + len(names)
			_set_progress(
				job,
				processed,
				phase="sign",
				submitted=submitted + cint(prev.get("submitted", 0)),
				signed=signed + cint(prev.get("signed", 0)),
				completed=cint(prev.get("completed", 0)),
				errors=failed + cint(prev.get("errors", 0)),
				sign_candidates=prev.get("sign_candidates"),
				complete_candidates=prev.get("complete_candidates"),
			)

			if len(names) >= MEDICATION_ORDER_BATCH_SIZE:
				frappe.enqueue(
					"healthcare.api.data_migration_jobs.process_pmo_sync_by_admission_status_batch",
					phase="sign",
					queue="long",
					timeout=3600,
					job_name=f"healthcare_pmo_sync_by_admission_status_sign_{processed}",
				)
			else:
				frappe.enqueue(
					"healthcare.api.data_migration_jobs.process_pmo_sync_by_admission_status_batch",
					phase="complete",
					queue="long",
					timeout=3600,
					job_name=f"healthcare_pmo_sync_by_admission_status_complete_{processed}",
				)
			return

		names = _pmo_names_for_admission_status(
			"Discharged",
			action="complete",
			failed_skip=failed_skip,
		)
		for name in names:
			try:
				doc = frappe.get_doc("Patient Medication Order", name)
				if doc.docstatus == 2:
					continue
				if _submit_pmo_if_draft(doc):
					submitted += 1
				_ensure_pmo_legacy_signature(doc)
				total = doc.total_orders or len(doc.get("medication_orders") or []) or 0
				doc.db_set("completed_orders", total, update_modified=False)
				doc.completed_orders = total
				doc.set_status()
				completed += 1
			except Exception:
				failed += 1
				_mark_job_name_failed(job, name)
				frappe.log_error(
					title=f"PMO complete by admission status failed: {name}",
					message=frappe.get_traceback(),
				)

		frappe.db.commit()
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = cint(prev.get("processed", 0)) + len(names)
		_set_progress(
			job,
			processed,
			phase="complete",
			submitted=submitted + cint(prev.get("submitted", 0)),
			signed=cint(prev.get("signed", 0)),
			completed=completed + cint(prev.get("completed", 0)),
			errors=failed + cint(prev.get("errors", 0)),
			sign_candidates=prev.get("sign_candidates"),
			complete_candidates=prev.get("complete_candidates"),
		)

		if len(names) >= MEDICATION_ORDER_BATCH_SIZE:
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_pmo_sync_by_admission_status_batch",
				phase="complete",
				queue="long",
				timeout=3600,
				job_name=f"healthcare_pmo_sync_by_admission_status_complete_{processed}",
			)
		else:
			prev = frappe.cache().get_value(_job_progress_key(job)) or {}
			_set_progress(job, processed, done=True, phase="complete")
			_release_lock(job)
			_clear_failed_job_names(job)
			frappe.log_error(
				title="Healthcare PMO admission-status sync complete",
				message=(
					f"Processed {processed} order(s). "
					f"Submitted {prev.get('submitted', 0)}; signed {prev.get('signed', 0)}; "
					f"completed {prev.get('completed', 0)}; {prev.get('errors', 0)} failed (see Error Log)."
				),
			)
	except Exception:
		frappe.db.rollback()
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		_set_progress(job, cint(prev.get("processed", 0)), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


def process_pmo_complete_by_date_batch() -> None:
	job = "pmo_complete_by_date"
	try:
		from_date, to_date = _get_job_date_range(job)
		failed_skip = frappe.cache().get_value(_failed_job_names_key(job)) or []
		names = _pmo_names_for_date_range(
			from_date,
			to_date,
			failed_skip=failed_skip,
		)

		submitted = 0
		completed = 0
		failed = 0
		for name in names:
			try:
				doc = frappe.get_doc("Patient Medication Order", name)
				if doc.docstatus == 2:
					continue
				if doc.docstatus == 0:
					doc.flags.ignore_mandatory = True
					doc.submit()
					submitted += 1
					doc.reload()

				total = doc.total_orders or len(doc.get("medication_orders") or []) or 0
				doc.db_set("completed_orders", total, update_modified=False)
				doc.completed_orders = total
				doc.set_status()
				completed += 1
			except Exception:
				failed += 1
				_mark_job_name_failed(job, name)
				frappe.log_error(
					title=f"Patient Medication Order complete-by-date failed: {name}",
					message=frappe.get_traceback(),
				)

		frappe.db.commit()
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = cint(prev.get("processed", 0)) + len(names)
		_set_progress(
			job,
			processed,
			from_date=str(from_date),
			to_date=str(to_date),
			submitted=submitted + cint(prev.get("submitted", 0)),
			completed=completed + cint(prev.get("completed", 0)),
			errors=failed + cint(prev.get("errors", 0)),
		)

		if len(names) >= MEDICATION_ORDER_BATCH_SIZE:
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_pmo_complete_by_date_batch",
				queue="long",
				timeout=3600,
				job_name=f"healthcare_pmo_complete_by_date_{processed}",
			)
		else:
			prev = frappe.cache().get_value(_job_progress_key(job)) or {}
			_set_progress(job, processed, done=True)
			_release_lock(job)
			_clear_failed_job_names(job)
			frappe.cache().delete_value(_job_date_range_key(job))
			frappe.log_error(
				title="Healthcare Patient Medication Order complete-by-date migration complete",
				message=(
					f"Range {prev.get('from_date')} to {prev.get('to_date')}: "
					f"processed {processed} order(s). "
					f"Submitted {prev.get('submitted', 0)}; completed {prev.get('completed', 0)}; "
					f"{prev.get('errors', 0)} failed (see Error Log)."
				),
			)
	except Exception:
		frappe.db.rollback()
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		_set_progress(job, cint(prev.get("processed", 0)), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


def process_medication_order_complete_batch(offset: int = 0) -> None:
	try:
		failed_skip = frappe.cache().get_value(_failed_medication_orders_key()) or []
		filters: dict = {
			"docstatus": ["!=", 2],
			"status": ["not in", ["Completed", "Cancelled"]],
		}
		if failed_skip:
			filters["name"] = ["not in", failed_skip]

		names = frappe.get_all(
			"Patient Medication Order",
			filters=filters,
			pluck="name",
			order_by="name asc",
			limit_page_length=MEDICATION_ORDER_BATCH_SIZE,
		)

		submitted = 0
		completed = 0
		failed = 0
		for name in names:
			try:
				doc = frappe.get_doc("Patient Medication Order", name)
				if doc.docstatus == 2:
					continue
				if doc.docstatus == 0:
					doc.flags.ignore_mandatory = True
					doc.submit()
					submitted += 1
					doc.reload()

				total = doc.total_orders or len(doc.get("medication_orders") or []) or 0
				doc.db_set("completed_orders", total, update_modified=False)
				doc.completed_orders = total
				doc.set_status()
				completed += 1
			except Exception:
				failed += 1
				_mark_medication_order_failed(name)
				frappe.log_error(
					title=f"Patient Medication Order submit/complete failed: {name}",
					message=frappe.get_traceback(),
				)

		frappe.db.commit()
		prev = frappe.cache().get_value(_job_progress_key("medication_orders")) or {}
		processed = cint(prev.get("processed", 0)) + len(names)
		_set_progress("medication_orders", processed)

		if len(names) >= MEDICATION_ORDER_BATCH_SIZE:
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_medication_order_complete_batch",
				offset=0,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_complete_medication_orders_{processed}",
			)
		else:
			_set_progress("medication_orders", processed, done=True)
			_release_lock("medication_orders")
			_clear_failed_medication_orders()
			frappe.log_error(
				title="Healthcare Patient Medication Order migration complete",
				message=(
					f"Processed {processed} order(s). "
					f"Submitted {submitted} in final batch; marked {completed} Completed; "
					f"{failed} failed (see Error Log)."
				),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress("medication_orders", cint(offset), done=True, error=frappe.get_traceback())
		_release_lock("medication_orders")
		_clear_failed_medication_orders()
		raise


def _failed_discharges_key() -> str:
	return "healthcare:data_migration:discharges:failed"


def _mark_discharge_failed(name: str) -> None:
	failed = set(frappe.cache().get_value(_failed_discharges_key()) or [])
	failed.add(name)
	frappe.cache().set_value(_failed_discharges_key(), list(failed), expires_in_sec=JOB_LOCK_SECONDS)


def _clear_failed_discharges() -> None:
	frappe.cache().delete_value(_failed_discharges_key())


def process_discharge_submit_batch(offset: int = 0) -> None:
	"""Submit draft Discharge documents (docstatus 0) in batches via RQ."""
	try:
		failed_skip = frappe.cache().get_value(_failed_discharges_key()) or []
		filters: dict = {"docstatus": 0}
		if failed_skip:
			filters["name"] = ["not in", failed_skip]

		names = frappe.get_all(
			"Discharge",
			filters=filters,
			pluck="name",
			order_by="name asc",
			limit_page_length=DISCHARGE_BATCH_SIZE,
		)

		submitted = 0
		failed = 0
		for name in names:
			try:
				doc = frappe.get_doc("Discharge", name)
				if doc.docstatus != 0:
					continue
				doc.flags.ignore_mandatory = True
				doc.submit()
				submitted += 1
			except Exception:
				failed += 1
				_mark_discharge_failed(name)
				frappe.log_error(
					title=f"Discharge submit failed: {name}",
					message=frappe.get_traceback(),
				)

		frappe.db.commit()
		prev = frappe.cache().get_value(_job_progress_key("discharges")) or {}
		processed = cint(prev.get("processed", 0)) + len(names)
		_set_progress("discharges", processed)

		if len(names) >= DISCHARGE_BATCH_SIZE:
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_discharge_submit_batch",
				offset=0,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_submit_discharges_{processed}",
			)
		else:
			_set_progress("discharges", processed, done=True)
			_release_lock("discharges")
			_clear_failed_discharges()
			frappe.log_error(
				title="Healthcare Discharge submit migration complete",
				message=(
					f"Processed {processed} discharge(s). "
					f"Submitted {submitted} in final batch; "
					f"{failed} failed (see Error Log)."
				),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress("discharges", cint(offset), done=True, error=frappe.get_traceback())
		_release_lock("discharges")
		_clear_failed_discharges()
		raise


def process_patient_history_import_batch(offset: int = 0) -> None:
	from healthcare.api.patient_history_import import (
		_default_template_name,
		run_patient_history_import_batch,
	)

	job = "patient_history_import"
	try:
		admission_keys = frappe.cache().get_value(
			_patient_history_import_admissions_cache_key()
		)
		if admission_keys is None:
			_set_progress(job, cint(offset), done=True, error="missing admission list cache")
			_release_lock(job)
			return

		by_admission = frappe.cache().get_value(
			_patient_history_import_grouped_cache_key()
		)
		result = run_patient_history_import_batch(
			offset=offset,
			template_name=_default_template_name(),
			admission_keys=admission_keys,
			by_admission=by_admission,
		)
		processed = cint(result.get("processed") or 0)
		_set_progress(
			job,
			processed,
			total_admissions=result.get("total_admissions"),
			stats=result.get("stats"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_history_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_history_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True, stats=result.get("stats"))
			_release_lock(job)
			frappe.cache().delete_value(_patient_history_import_admissions_cache_key())
			frappe.cache().delete_value(_patient_history_import_grouped_cache_key())
			frappe.log_error(
				title="Healthcare Patient History import complete",
				message=frappe.as_json(result.get("stats") or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		frappe.cache().delete_value(_patient_history_import_admissions_cache_key())
		frappe.cache().delete_value(_patient_history_import_grouped_cache_key())
		raise


def process_patient_history_orphan_cleanup_batch(offset: int = 0) -> None:
	from healthcare.api.patient_history_orphan_cleanup import run_patient_history_orphan_cleanup_batch

	job = "patient_history_orphan_cleanup"
	try:
		result = run_patient_history_orphan_cleanup_batch(offset=offset)
		processed = cint(result.get("processed") or 0)
		stats = result.get("stats") or {}
		_set_progress(
			job,
			processed,
			ok=processed,
			errors=stats.get("errors") or 0,
			remaining=result.get("remaining"),
			stats=stats,
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_history_orphan_cleanup_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_history_orphan_cleanup_{processed}",
			)
		else:
			_set_progress(
				job,
				processed,
				done=True,
				ok=processed,
				errors=stats.get("errors") or 0,
				stats=stats,
			)
			_release_lock(job)
			frappe.log_error(
				title="Healthcare Patient History orphan cleanup complete",
				message=frappe.as_json(stats),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


def process_patient_history_date_backfill_batch(offset: int = 0) -> None:
	from healthcare.api.patient_history_date_backfill import run_patient_history_date_backfill_batch

	job = "patient_history_date_backfill"
	try:
		result = run_patient_history_date_backfill_batch(offset=offset)
		processed = cint(result.get("processed") or 0)
		_set_progress(
			job,
			processed,
			remaining=result.get("remaining"),
			stats=result.get("stats"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_history_date_backfill_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_history_date_backfill_{processed}",
			)
		else:
			_set_progress(job, processed, done=True, stats=result.get("stats"))
			_release_lock(job)
			frappe.log_error(
				title="Healthcare Patient History date backfill complete",
				message=frappe.as_json(
					{
						**(result.get("stats") or {}),
						"remaining": result.get("remaining"),
					}
				),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


def _resolve_item_00_01_name(code_value) -> str | None:
	"""Resolve ITEM_00_01 link name from incoming medicine code."""
	if code_value in (None, ""):
		return None
	code_str = str(code_value).strip()
	if not code_str:
		return None
	if frappe.db.exists("ITEM_00_01", code_str):
		return code_str
	stripped = code_str.lstrip("0")
	if stripped and stripped != code_str and frappe.db.exists("ITEM_00_01", stripped):
		return stripped
	return None


def _normalize_time_value(raw_time) -> str:
	"""Normalize imported time values to HH:MM:SS for MariaDB TIME column."""
	if raw_time in (None, ""):
		return "00:00:00"
	try:
		return str(get_time(str(raw_time).strip()))
	except Exception:
		return "00:00:00"


def _get_or_create_pmo_for_admission(admission_name: str, line_rows: list[dict]) -> tuple:
	"""Return PMO doc and created flag for one admission."""
	draft_name = frappe.db.get_value(
		"Patient Medication Order",
		{
			"inpatient_record": admission_name,
			"care_context": "Inpatient Admission",
			"docstatus": 0,
		},
		"name",
		order_by="modified desc",
	)
	if draft_name:
		return frappe.get_doc("Patient Medication Order", draft_name), False

	adm = frappe.db.get_value(
		"Inpatient Admission",
		admission_name,
		[
			"patient",
			"patient_name",
			"company",
			"primary_practitioner",
			"secondary_practitioner",
			"admission_date",
			"scheduled_date",
		],
		as_dict=True,
	)
	if not adm:
		frappe.throw(_("Inpatient Admission {0} not found").format(admission_name))

	doc = frappe.new_doc("Patient Medication Order")
	doc.trans_no = get_next_transaction_number("Patient Medication Order", fieldname="trans_no")
	doc.care_context = "Inpatient Admission"
	doc.inpatient_record = admission_name
	doc.patient = adm.get("patient")
	doc.patient_name = adm.get("patient_name")
	doc.company = adm.get("company")
	doc.practitioner = adm.get("primary_practitioner") or adm.get("secondary_practitioner")
	doc.posting_date = nowdate()
	doc.start_date = (
		line_rows[0].get("start_date")
		or adm.get("admission_date")
		or adm.get("scheduled_date")
		or nowdate()
	)
	doc.written_inpatient_admission = admission_name
	doc.old_admission_no = line_rows[0].get("old_admission_no")
	doc.ip_admission_rec_id = line_rows[0].get("ip_admission_rec_id")
	return doc, True


def process_ip_admission_medicine_link_batch(offset: int = 0) -> None:
	job = "ip_admission_medicine_link"
	try:
		admissions = frappe.db.sql(
			"""
			SELECT DISTINCT admission
			FROM `tabIP Admission Medicine`
			WHERE admission IS NOT NULL AND admission != ''
			ORDER BY admission
			LIMIT %s OFFSET %s
			""",
			(IP_ADMISSION_MEDICINE_BATCH_SIZE, offset),
			as_dict=True,
		)

		created_orders = 0
		updated_orders = 0
		linked_rows = 0
		skipped_rows = 0

		for adm_row in admissions:
			admission_name = adm_row.get("admission")
			line_rows = frappe.get_all(
				"IP Admission Medicine",
				filters={"admission": admission_name},
				fields=[
					"name",
					"medicine",
					"dose_notes",
					"dose_note",
					"notes",
					"route",
					"strength",
					"unit",
					"frequency",
					"duration",
					"duration_type",
					"qty",
					"start_date",
					"end_date",
					"trans_date",
					"trans_time",
					"status",
					"effective_status",
					"stop_reason",
					"stop_by",
					"stop_date",
					"old_admission_no",
					"ip_admission_rec_id",
				],
				order_by="trans_date asc, creation asc",
			)
			if not line_rows:
				continue

			doc, created = _get_or_create_pmo_for_admission(admission_name, line_rows)
			if created:
				created_orders += 1

			existing_trans_nums = {
				(c.trans_num or "").strip()
				for c in (doc.get("medication_orders") or [])
				if (c.trans_num or "").strip()
			}
			added_any = False

			for row in line_rows:
				trans_link = (row.get("name") or "").strip()
				if not trans_link:
					skipped_rows += 1
					continue
				if trans_link in existing_trans_nums:
					skipped_rows += 1
					continue

				old_code = _resolve_item_00_01_name(row.get("medicine"))
				old_name = None
				if old_code:
					old_name = frappe.db.get_value("ITEM_00_01", old_code, "item_nam")
				if not old_name:
					old_name = (row.get("medicine") or "").strip() or None

				entry = doc.append("medication_orders", {})
				entry.trans_num = trans_link
				entry.old_medicine_code = old_code
				entry.old_medicine_name = old_name
				entry.dosage = (
					(row.get("dose_notes") or "").strip()
					or (row.get("strength") or "").strip()
				)
				entry.uom = (row.get("unit") or "").strip()
				entry.no_of_days = cint(row.get("duration") or 0)
				entry.quantity = row.get("qty") or 0
				entry.instructions = (
					(row.get("notes") or "").strip()
					or (row.get("dose_note") or "").strip()
					or (row.get("dose_notes") or "").strip()
				)
				entry.date = row.get("start_date") or row.get("trans_date") or doc.start_date
				entry.end_date = row.get("end_date")
				entry.time = _normalize_time_value(row.get("trans_time"))
				entry.written_frequency = (row.get("frequency") or "").strip()
				entry.duration = str(row.get("duration") or "")
				entry.trans_type = (row.get("duration_type") or "").strip()
				entry.redundancy_type = (row.get("effective_status") or "").strip()
				entry.dc = (row.get("status") or "").strip()

				stopped_reason = (row.get("stop_reason") or "").strip()
				effective_status = (row.get("effective_status") or "").strip().lower()
				status = (row.get("status") or "").strip().lower()
				is_stopped = bool(
					stopped_reason
					or status == "stopped"
					or effective_status == "stopped"
				)
				entry.stopped = 1 if is_stopped else 0
				entry.reason_stopped = stopped_reason
				entry.stopped_date = row.get("stop_date")
				entry.stop_by = (row.get("stop_by") or "").strip() or None

				existing_trans_nums.add(trans_link)
				linked_rows += 1
				added_any = True

			if added_any:
				doc.flags.ignore_mandatory = True
				doc.save(ignore_permissions=True)
				if not created:
					updated_orders += 1

		frappe.db.commit()

		processed = offset + len(admissions)
		_set_progress(
			job,
			processed,
			created_orders=created_orders,
			updated_orders=updated_orders,
			linked_rows=linked_rows,
			skipped_rows=skipped_rows,
		)

		if len(admissions) >= IP_ADMISSION_MEDICINE_BATCH_SIZE:
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_admission_medicine_link_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_admission_medicine_link_{processed}",
			)
		else:
			_set_progress(
				job,
				processed,
				done=True,
				created_orders=created_orders,
				updated_orders=updated_orders,
				linked_rows=linked_rows,
				skipped_rows=skipped_rows,
			)
			_release_lock(job)
			frappe.log_error(
				title="IP Admission Medicine link migration complete",
				message=(
					f"Processed admissions: {processed}, created PMO: {created_orders}, "
					f"updated PMO: {updated_orders}, linked rows: {linked_rows}, skipped rows: {skipped_rows}"
				),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


def _normalize_doc_name(value) -> str:
	if value in (None, ""):
		return ""
	s = str(value).strip()
	if s.endswith(".0"):
		s = s[:-2]
	return s


def _resolve_item_code_for_given_tables(value) -> str | None:
	"""Return valid Item code for medicine_code if it exists; else None."""
	code = _normalize_doc_name(value)
	if not code:
		return None
	return code if frappe.db.exists("Item", code) else None


def _load_default_patient_assessment_template():
	template_name = (
		frappe.db.get_value("Patient Assessment Template", {"assessment_name": "Default Patient Evaluation"}, "name")
		or frappe.db.get_value("Patient Assessment Template", {"default": 1}, "name")
	)
	if not template_name:
		frappe.throw(_("Patient Assessment Template “Default Patient Evaluation” was not found."))
	return frappe.get_doc("Patient Assessment Template", template_name)


def process_ip_patient_assessment_map_batch(offset: int = 0) -> None:
	job = "ip_patient_assessment_map"
	try:
		template = _load_default_patient_assessment_template()
		template_name = template.name

		parameter_rows = frappe.get_all(
			"Patient Assessment Parameter",
			fields=["name", "parameter_abbrev"],
			limit_page_length=10000,
		)
		parameter_abbrev_by_name = {
			(p.get("name") or ""): (p.get("parameter_abbrev") or "").strip()
			for p in parameter_rows
		}

		ip_rows = frappe.get_all(
			"IP Patient Assessment",
			fields=["*"],
			order_by="name asc",
			limit_start=offset,
			limit_page_length=IP_PATIENT_ASSESSMENT_BATCH_SIZE,
		)

		created = 0
		submitted = 0
		skipped_existing = 0
		skipped_missing_admission = 0
		skipped_missing_patient = 0
		skipped_errors = 0

		for row in ip_rows:
			try:
				ip_name = str(row.get("name") or "").strip()
				if not ip_name:
					skipped_errors += 1
					continue

				if frappe.db.exists("Patient Assessment", {"ip_patient_assessment": ip_name, "docstatus": ["!=", 2]}):
					skipped_existing += 1
					continue

				admission = _normalize_doc_name(row.get("admission_num"))
				if not admission or not frappe.db.exists("Inpatient Admission", admission):
					skipped_missing_admission += 1
					continue

				inpatient = frappe.db.get_value(
					"Inpatient Admission",
					admission,
					["patient", "patient_name", "company", "primary_practitioner", "secondary_practitioner"],
					as_dict=True,
				) or {}
				patient = (inpatient.get("patient") or "").strip()
				if not patient:
					skipped_missing_patient += 1
					continue

				doc = frappe.new_doc("Patient Assessment")
				doc.patient = patient
				doc.patient_name = inpatient.get("patient_name")
				doc.assessment_template = template_name
				doc.reference_type = "Inpatient Admission"
				doc.encounter = admission
				doc.admission = admission
				doc.company = inpatient.get("company")
				doc.healthcare_practitioner = (
					inpatient.get("primary_practitioner") or inpatient.get("secondary_practitioner")
				)
				doc.assessment_datetime = _assessment_datetime_from_row(row)
				doc.ip_patient_assessment = ip_name
				doc.assessment_description = (
					(_row_value_for_abbrev(row, "history_dscp") or "").strip()
					or (_row_value_for_abbrev(row, "others") or "").strip()
				)
				assessment_time = _assessment_time_from_row(row)

				for detail in template.get("parameters") or []:
					param_name = (detail.get("assessment_parameter") or "").strip()
					if not param_name:
						continue
					abbrev = (parameter_abbrev_by_name.get(param_name) or "").strip()
					if not abbrev:
						continue

					flag_value = _row_value_for_abbrev(row, abbrev)
					yes_flag = _to_yes_no_flag(flag_value)

					desc_key = f"{_abbrev_to_row_key(abbrev)}_desc"
					comments = (_row_value_for_abbrev(row, desc_key) or "").strip()
					if not comments and _abbrev_to_row_key(abbrev) == "history_dscp":
						comments = (_row_value_for_abbrev(row, "history_dscp") or "").strip()

					child_row = {
						"parameter": param_name,
						"yes": yes_flag,
						"comments": comments if yes_flag else "",
					}
					if assessment_time:
						child_row["time"] = assessment_time

					doc.append("assessment_sheet", child_row)

				if _persist_and_submit_patient_assessment(doc, existing=False):
					submitted += 1
				created += 1
			except Exception:
				skipped_errors += 1
				frappe.log_error(
					title=f"IP Patient Assessment map row failed: {row.get('name')}",
					message=frappe.get_traceback(),
				)

		frappe.db.commit()

		processed = offset + len(ip_rows)
		_set_progress(
			job,
			processed,
			template=template_name,
			created=created,
			submitted=submitted,
			skipped_existing=skipped_existing,
			skipped_missing_admission=skipped_missing_admission,
			skipped_missing_patient=skipped_missing_patient,
			skipped_errors=skipped_errors,
		)

		if len(ip_rows) >= IP_PATIENT_ASSESSMENT_BATCH_SIZE:
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_patient_assessment_map_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_patient_assessment_map_{processed}",
			)
		else:
			_set_progress(
				job,
				processed,
				done=True,
				template=template_name,
				created=created,
				submitted=submitted,
				skipped_existing=skipped_existing,
				skipped_missing_admission=skipped_missing_admission,
				skipped_missing_patient=skipped_missing_patient,
				skipped_errors=skipped_errors,
			)
			_release_lock(job)
			frappe.log_error(
				title="IP Patient Assessment map migration complete",
				message=(
					f"Processed rows: {processed}, created: {created}, submitted: {submitted}, "
					f"skipped existing: {skipped_existing}, "
					f"skipped missing admission: {skipped_missing_admission}, "
					f"skipped missing patient: {skipped_missing_patient}, "
					f"skipped errors: {skipped_errors}"
				),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


def _normalize_clinical_note_diagnosis_flag(raw) -> str | None:
	if raw is None:
		return None
	value = str(raw).strip().upper()
	return value or None


def _nurse_medical_roles() -> set[str]:
	roles = set(
		frappe.get_all(
			"Medical Role",
			filters={"parent_medical_role": "Nurse"},
			pluck="name",
		)
		or []
	)
	roles.add("Nurse")
	return roles


def _target_clinical_note_type_from_row(
	diagnosis_flag,
	medical_role,
	inpatient_admission,
	*,
	nurse_roles: set[str],
) -> str | None:
	"""Resolve target Clinical Note Type name from legacy flags and IP nursing context."""
	flag = _normalize_clinical_note_diagnosis_flag(diagnosis_flag)
	if flag and flag in _DIAGNOSIS_FLAG_TO_NOTE_TYPE:
		return _DIAGNOSIS_FLAG_TO_NOTE_TYPE[flag]

	# IP nursing imports: only when flag is empty, admission present, and role is nursing.
	if not flag and (inpatient_admission or "").strip():
		role = (medical_role or "").strip()
		if role in nurse_roles:
			return "Nursing Note"

	return None


def process_clinical_note_type_from_flag_batch(offset: int = 0) -> None:
	from healthcare.api.clinical_note import _get_or_create_clinical_note_type

	job = "clinical_note_type_from_flag"
	try:
		nurse_roles = _nurse_medical_roles()
		rows = frappe.get_all(
			"Clinical Note",
			fields=["name", "diagnosis_flag", "clinical_note_type", "medical_role", "inpatient_admission"],
			filters={"docstatus": ["!=", 2]},
			order_by="name asc",
			limit_start=offset,
			limit_page_length=CLINICAL_NOTE_TYPE_BATCH_SIZE,
		)

		updated = 0
		skipped_unchanged = 0
		skipped_no_mapping = 0
		skipped_errors = 0

		for row in rows:
			try:
				target = _target_clinical_note_type_from_row(
					row.get("diagnosis_flag"),
					row.get("medical_role"),
					row.get("inpatient_admission"),
					nurse_roles=nurse_roles,
				)
				if not target:
					skipped_no_mapping += 1
					continue

				current = (row.get("clinical_note_type") or "").strip()
				if current == target:
					skipped_unchanged += 1
					continue

				_get_or_create_clinical_note_type(target)
				frappe.db.set_value(
					"Clinical Note",
					row.name,
					"clinical_note_type",
					target,
					update_modified=False,
				)
				updated += 1
			except Exception:
				skipped_errors += 1
				frappe.log_error(
					title=f"Clinical Note type map failed: {row.get('name')}",
					message=frappe.get_traceback(),
				)

		frappe.db.commit()

		processed = offset + len(rows)
		_set_progress(
			job,
			processed,
			updated=updated,
			skipped_unchanged=skipped_unchanged,
			skipped_no_mapping=skipped_no_mapping,
			skipped_errors=skipped_errors,
		)

		if len(rows) >= CLINICAL_NOTE_TYPE_BATCH_SIZE:
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_clinical_note_type_from_flag_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_clinical_note_type_from_flag_{processed}",
			)
		else:
			_set_progress(
				job,
				processed,
				done=True,
				updated=updated,
				skipped_unchanged=skipped_unchanged,
				skipped_no_mapping=skipped_no_mapping,
				skipped_errors=skipped_errors,
			)
			_release_lock(job)
			frappe.log_error(
				title="Clinical Note type from diagnosis_flag migration complete",
				message=(
					f"Processed: {processed}, updated: {updated}, "
					f"unchanged: {skipped_unchanged}, no mapping: {skipped_no_mapping}, "
					f"errors: {skipped_errors}"
				),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


def _fix_warning_message_legacy_genders() -> int:
	"""Bulk-fix Warning Message.gender rows still stored as 1 / 2."""
	from healthcare.api.patient_info_import import LEGACY_SEX_NAMES

	updated = 0
	for code, gender in LEGACY_SEX_NAMES.items():
		names = frappe.get_all("Warning Message", filters={"gender": code}, pluck="name")
		for name in names:
			frappe.db.set_value(
				"Warning Message",
				name,
				"gender",
				gender,
				update_modified=False,
			)
			updated += 1
	return updated


def process_patient_legacy_gender_fix_batch(offset: int = 0) -> None:
	from healthcare.api.patient_info_import import LEGACY_SEX_NAMES

	job = "patient_legacy_gender_fix"
	try:
		rows = frappe.get_all(
			"Patient",
			fields=["name", "sex"],
			filters={"sex": ["in", list(LEGACY_SEX_NAMES.keys())]},
			order_by="name asc",
			limit_start=offset,
			limit_page_length=PATIENT_LEGACY_GENDER_BATCH_SIZE,
		)

		updated = 0
		skipped_unchanged = 0
		skipped_errors = 0

		for row in rows:
			try:
				current = (row.get("sex") or "").strip()
				target = LEGACY_SEX_NAMES.get(current)
				if not target:
					skipped_unchanged += 1
					continue
				if current == target:
					skipped_unchanged += 1
					continue

				frappe.db.set_value(
					"Patient",
					row.name,
					"sex",
					target,
					update_modified=False,
				)
				frappe.db.sql(
					"""
					UPDATE `tabWarning Message`
					SET gender = %s
					WHERE patient = %s AND gender IN ('1', '2')
					""",
					(target, row.name),
				)
				updated += 1
			except Exception:
				skipped_errors += 1
				frappe.log_error(
					title=f"Patient legacy gender fix failed: {row.get('name')}",
					message=frappe.get_traceback(),
				)

		frappe.db.commit()

		processed = offset + len(rows)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		_set_progress(
			job,
			processed,
			updated=cint(prev.get("updated", 0)) + updated,
			skipped_unchanged=cint(prev.get("skipped_unchanged", 0)) + skipped_unchanged,
			skipped_errors=cint(prev.get("skipped_errors", 0)) + skipped_errors,
			patients_sex_1=prev.get("patients_sex_1"),
			patients_sex_2=prev.get("patients_sex_2"),
			warning_messages=prev.get("warning_messages"),
		)

		if len(rows) >= PATIENT_LEGACY_GENDER_BATCH_SIZE:
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_legacy_gender_fix_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_legacy_gender_fix_{processed}",
			)
		else:
			warning_updated = _fix_warning_message_legacy_genders()
			frappe.db.commit()
			prev = frappe.cache().get_value(_job_progress_key(job)) or {}
			_set_progress(
				job,
				processed,
				done=True,
				updated=prev.get("updated", 0),
				skipped_unchanged=prev.get("skipped_unchanged", 0),
				skipped_errors=prev.get("skipped_errors", 0),
				warning_messages_updated=warning_updated,
				patients_sex_1=prev.get("patients_sex_1"),
				patients_sex_2=prev.get("patients_sex_2"),
				warning_messages=prev.get("warning_messages"),
			)
			_release_lock(job)
			frappe.log_error(
				title="Patient legacy gender fix complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


def _resolve_ip_admission_medicine_doc(medi_trans_num) -> str | None:
	"""Resolve IP Admission Medicine document name from sheet medi_trans_num."""
	name_guess = _normalize_doc_name(medi_trans_num)
	if not name_guess:
		return None
	if frappe.db.exists("IP Admission Medicine", name_guess):
		return name_guess
	match = frappe.db.get_value("IP Admission Medicine", {"trans_no": name_guess}, "name")
	return match or None


def _resolve_patient_medication_order_for_ip_med(admission_name: str, ip_med_name: str | None) -> str | None:
	"""Find PMO for exact admission + imported IP medicine transaction."""
	if not admission_name or not ip_med_name:
		return None
	match = frappe.db.sql(
		"""
		SELECT pmo.name
		FROM `tabPatient Medication Order` pmo
		INNER JOIN `tabInpatient Medication Order Entry` child
			ON child.parent = pmo.name
		WHERE pmo.inpatient_record = %(admission)s
		  AND child.trans_num = %(trans_num)s
		  AND pmo.docstatus != 2
		ORDER BY pmo.modified DESC
		LIMIT 1
		""",
		{"admission": admission_name, "trans_num": ip_med_name},
		as_dict=True,
	)
	return match[0].name if match else None


def _get_admission_detail_for_sheet_row(admission_num, patient_num):
	"""Resolve or create Admission Detail using admission_num / patient_num."""
	adm = _normalize_doc_name(admission_num)
	patient = _normalize_doc_name(patient_num)

	if adm:
		doc_name = frappe.db.get_value("Admission Detail", {"admission": adm}, "name")
		if doc_name:
			return frappe.get_doc("Admission Detail", doc_name)

		# Auto-create Admission Detail when admission exists but detail row is missing.
		if frappe.db.exists("Inpatient Admission", adm):
			inpatient = frappe.db.get_value(
				"Inpatient Admission",
				adm,
				["patient", "patient_name"],
				as_dict=True,
			) or {}
			file_no = inpatient.get("patient") or patient
			patient_name = inpatient.get("patient_name") or (
				frappe.db.get_value("Patient", file_no, "patient_name") if file_no else None
			)
			if file_no and patient_name:
				new_detail = frappe.new_doc("Admission Detail")
				new_detail.admission = adm
				new_detail.file_no = file_no
				new_detail.patient_name = patient_name
				new_detail.flags.ignore_mandatory = True
				new_detail.insert(ignore_permissions=True)
				return new_detail

	if patient:
		doc_name = frappe.db.get_value(
			"Admission Detail",
			{"file_no": patient},
			"name",
			order_by="modified desc",
		)
		if doc_name:
			return frappe.get_doc("Admission Detail", doc_name)

	return None


def process_ip_admission_medicine_sheet_map_batch(offset: int = 0) -> None:
	job = "ip_admission_medicine_sheet_map"
	try:
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		prev_processed_rows = cint(prev.get("processed_rows", 0))
		prev_given_rows = cint(prev.get("given_rows", 0))
		prev_missed_rows = cint(prev.get("missed_rows", 0))
		prev_created_given = cint(prev.get("created_given", 0))
		prev_created_missed = cint(prev.get("created_missed", 0))
		prev_skipped_rows = cint(prev.get("skipped_rows", 0))
		prev_skip_no_admission_or_patient = cint(prev.get("skip_no_admission_or_patient", 0))
		prev_skip_no_admission_detail = cint(prev.get("skip_no_admission_detail", 0))
		prev_skip_already_mapped = cint(prev.get("skip_already_mapped", 0))
		prev_skip_error = cint(prev.get("skip_error", 0))
		prev_created_admission_detail = cint(prev.get("created_admission_detail", 0))
		prev_rows_without_pmo = cint(prev.get("rows_without_pmo", 0))
		prev_rows_without_ip_med = cint(prev.get("rows_without_ip_med", 0))

		rows = frappe.get_all(
			"IP Admission Medicine Sheet",
			fields=[
				"name",
				"trans_num",
				"medi_trans_num",
				"admission_num",
				"patient_num",
				"given_yn",
				"given_date",
				"remarks",
			],
			order_by="admission_num asc, trans_num asc",
			limit_start=offset,
			limit_page_length=IP_ADMISSION_MEDICINE_SHEET_BATCH_SIZE,
		)

		processed_rows = 0
		given_rows = 0
		missed_rows = 0
		skipped_rows = 0
		created_given = 0
		created_missed = 0
		skip_no_admission_or_patient = 0
		skip_no_admission_detail = 0
		skip_already_mapped = 0
		skip_error = 0
		created_admission_detail = 0
		rows_without_pmo = 0
		rows_without_ip_med = 0

		admission_cache: dict[str, object] = {}
		for row in rows:
			processed_rows += 1
			admission = _normalize_doc_name(row.get("admission_num"))
			patient_num = _normalize_doc_name(row.get("patient_num"))
			cache_key = f"{admission}|{patient_num}"
			if not admission and not patient_num:
				skipped_rows += 1
				skip_no_admission_or_patient += 1
				continue

			ad_detail = admission_cache.get(cache_key)
			if ad_detail is None:
				existed_before = bool(admission and frappe.db.exists("Admission Detail", {"admission": admission}))
				ad_detail = _get_admission_detail_for_sheet_row(admission, patient_num)
				if not ad_detail:
					skipped_rows += 1
					skip_no_admission_detail += 1
					continue
				if not existed_before and admission and (ad_detail.get("admission") == admission):
					created_admission_detail += 1
				admission_cache[cache_key] = ad_detail

			sheet_name = row.get("name")
			given_flag = (row.get("given_yn") or "").strip().upper()
			ip_med_name = _resolve_ip_admission_medicine_doc(row.get("medi_trans_num"))
			if not ip_med_name:
				rows_without_ip_med += 1
			ip_med_row = (
				frappe.db.get_value(
					"IP Admission Medicine",
					ip_med_name,
					["medicine", "dose_notes", "qty", "unit", "frequency"],
					as_dict=True,
				)
				if ip_med_name
				else None
			)

			legacy_code_name = _resolve_item_00_01_name((ip_med_row or {}).get("medicine"))
			legacy_name = (
				frappe.db.get_value("ITEM_00_01", legacy_code_name, "item_nam")
				if legacy_code_name
				else None
			)

			item_code = _resolve_item_code_for_given_tables((ip_med_row or {}).get("medicine"))
			item_name = (
				frappe.db.get_value("Item", item_code, "item_name")
				if item_code
				else (legacy_name or _normalize_doc_name((ip_med_row or {}).get("medicine")) or None)
			)
			pmo_name = _resolve_patient_medication_order_for_ip_med(
				admission or (ad_detail.get("admission") if ad_detail else ""),
				ip_med_name,
			)
			if not pmo_name:
				rows_without_pmo += 1

			date_val = None
			time_val = "00:00:00"
			if row.get("given_date"):
				date_val = getdate(row.get("given_date"))
				time_val = _normalize_time_value(row.get("given_date"))
			else:
				date_val = nowdate()

			common_payload = {
				"date": date_val,
				"time": time_val,
				"medicine_code": item_code,
				"medicine_name": item_name,
				"medication_order": pmo_name,
				"qty": (ip_med_row or {}).get("qty") or 0,
				"dose_notes": (row.get("remarks") or "").strip() or (ip_med_row or {}).get("dose_notes"),
				"medicine_given_timing": (ip_med_row or {}).get("frequency"),
				"user": frappe.session.user,
				"old_medicine_code": legacy_code_name,
				"old_medicine_name": legacy_name or item_name,
				"ip_admission_medicine": ip_med_name,
				"ip_admission_medicine_sheet": sheet_name,
				"patient_medication_order": pmo_name,
			}

			try:
				existing = any(
					(r.ip_admission_medicine_sheet or "") == sheet_name
					for r in (ad_detail.get("table_yrwe") or [])
				) or any(
					(r.ip_admission_medicine_sheet or "") == sheet_name
					for r in (ad_detail.get("missed_medicine") or [])
				)
				if existing:
					skipped_rows += 1
					skip_already_mapped += 1
					continue

				if given_flag == "N":
					ad_detail.append("missed_medicine", common_payload)
					missed_rows += 1
					created_missed += 1
				else:
					ad_detail.append("table_yrwe", common_payload)
					given_rows += 1
					created_given += 1
			except Exception:
				skipped_rows += 1
				skip_error += 1
				frappe.log_error(
					title=f"IP Medicine Sheet row map failed: {sheet_name}",
					message=frappe.get_traceback(),
				)

		for ad_doc in admission_cache.values():
			ad_doc.flags.ignore_mandatory = True
			ad_doc.save(ignore_permissions=True)

		frappe.db.commit()
		processed = offset + len(rows)
		total_processed_rows = prev_processed_rows + processed_rows
		total_given_rows = prev_given_rows + given_rows
		total_missed_rows = prev_missed_rows + missed_rows
		total_created_given = prev_created_given + created_given
		total_created_missed = prev_created_missed + created_missed
		total_skipped_rows = prev_skipped_rows + skipped_rows
		total_skip_no_admission_or_patient = prev_skip_no_admission_or_patient + skip_no_admission_or_patient
		total_skip_no_admission_detail = prev_skip_no_admission_detail + skip_no_admission_detail
		total_skip_already_mapped = prev_skip_already_mapped + skip_already_mapped
		total_skip_error = prev_skip_error + skip_error
		total_created_admission_detail = prev_created_admission_detail + created_admission_detail
		total_rows_without_pmo = prev_rows_without_pmo + rows_without_pmo
		total_rows_without_ip_med = prev_rows_without_ip_med + rows_without_ip_med
		_set_progress(
			job,
			processed,
			processed_rows=total_processed_rows,
			given_rows=total_given_rows,
			missed_rows=total_missed_rows,
			created_given=total_created_given,
			created_missed=total_created_missed,
			skipped_rows=total_skipped_rows,
			skip_no_admission_or_patient=total_skip_no_admission_or_patient,
			skip_no_admission_detail=total_skip_no_admission_detail,
			skip_already_mapped=total_skip_already_mapped,
			skip_error=total_skip_error,
			created_admission_detail=total_created_admission_detail,
			rows_without_pmo=total_rows_without_pmo,
			rows_without_ip_med=total_rows_without_ip_med,
		)

		if len(rows) >= IP_ADMISSION_MEDICINE_SHEET_BATCH_SIZE:
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_admission_medicine_sheet_map_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_admission_medicine_sheet_map_{processed}",
			)
		else:
			_set_progress(
				job,
				processed,
				done=True,
				processed_rows=total_processed_rows,
				given_rows=total_given_rows,
				missed_rows=total_missed_rows,
				created_given=total_created_given,
				created_missed=total_created_missed,
				skipped_rows=total_skipped_rows,
				skip_no_admission_or_patient=total_skip_no_admission_or_patient,
				skip_no_admission_detail=total_skip_no_admission_detail,
				skip_already_mapped=total_skip_already_mapped,
				skip_error=total_skip_error,
				created_admission_detail=total_created_admission_detail,
				rows_without_pmo=total_rows_without_pmo,
				rows_without_ip_med=total_rows_without_ip_med,
			)
			_release_lock(job)
			frappe.log_error(
				title="IP Admission Medicine Sheet map migration complete",
				message=(
					f"Processed rows: {total_processed_rows}, created given: {total_created_given}, "
					f"created missed: {total_created_missed}, skipped: {total_skipped_rows}, "
					f"skip(no admission+patient): {total_skip_no_admission_or_patient}, "
					f"skip(no admission detail): {total_skip_no_admission_detail}, "
					f"skip(already mapped): {total_skip_already_mapped}, "
					f"skip(row error): {total_skip_error}, "
					f"created admission detail: {total_created_admission_detail}, "
					f"rows without IP med link: {total_rows_without_ip_med}, "
					f"rows without PMO link: {total_rows_without_pmo}"
				),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


def process_ip_admission_medicine_sheet_given_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_admission_medicine_sheet_given_import import (
		run_ip_admission_medicine_sheet_given_import_batch,
	)

	job = "ip_admission_medicine_sheet_given_import"
	try:
		result = run_ip_admission_medicine_sheet_given_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			staging_created=cint(prev.get("staging_created", 0)) + cint(result.get("staging_created", 0)),
			staging_updated=cint(prev.get("staging_updated", 0)) + cint(result.get("staging_updated", 0)),
			created_given=cint(prev.get("created_given", 0)) + cint(result.get("created_given", 0)),
			created_admission_detail=cint(prev.get("created_admission_detail", 0))
			+ cint(result.get("created_admission_detail", 0)),
			skip_not_given=cint(prev.get("skip_not_given", 0)) + cint(result.get("skip_not_given", 0)),
			skip_no_admission_detail=cint(prev.get("skip_no_admission_detail", 0))
			+ cint(result.get("skip_no_admission_detail", 0)),
			skip_already_mapped=cint(prev.get("skip_already_mapped", 0))
			+ cint(result.get("skip_already_mapped", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			raw_excel_rows=prev.get("raw_excel_rows"),
			admissions=prev.get("admissions"),
			given_rows=prev.get("given_rows"),
			not_given_rows=prev.get("not_given_rows"),
			staging_existing=prev.get("staging_existing"),
			staging_new=prev.get("staging_new"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_admission_medicine_sheet_given_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_admission_medicine_sheet_given_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="IP Admission Medicine Sheet given import complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Discharge checklist Excel import (Oracle IP_ADMISSION_04) ─────────────────


@frappe.whitelist()
def start_discharge_checklist_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.discharge_checklist_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload an Excel file first."))

	job = "discharge_checklist_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_admissions=summary.get("admissions"),
		resolvable_admissions=summary.get("resolvable_admissions"),
		excel_rows=summary.get("excel_rows"),
		unresolved_rows=summary.get("unresolved_rows"),
		template=summary.get("template"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_discharge_checklist_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_discharge_checklist_import",
	)
	return {
		"ok": True,
		"message": _(
			"Discharge checklist import started ({0} admissions in file, {1} can be matched to Discharge)."
		).format(
			summary.get("admissions") or 0,
			summary.get("resolvable_admissions") or 0,
		),
	}


def process_discharge_checklist_import_batch(offset: int = 0) -> None:
	from healthcare.api.discharge_checklist_import import run_discharge_checklist_import_batch

	job = "discharge_checklist_import"
	try:
		result = run_discharge_checklist_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			ok=cint(prev.get("ok", 0)) + cint(result.get("ok", 0)),
			skip_no_admission=cint(prev.get("skip_no_admission", 0))
			+ cint(result.get("skip_no_admission", 0)),
			skip_no_discharge=cint(prev.get("skip_no_discharge", 0))
			+ cint(result.get("skip_no_discharge", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_admissions=prev.get("total_admissions"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_discharge_checklist_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_discharge_checklist_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Discharge checklist import complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Patient Medication Order import (Oracle CSV / Excel) ──────────────────────


@frappe.whitelist()
def start_patient_medication_order_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.patient_medication_order_import import parse_and_cache_file

	if not (file_url or "").strip():
		frappe.throw(_("Please upload a CSV or Excel file first."))

	job = "patient_medication_order_import"
	_acquire_lock(job)
	summary = parse_and_cache_file(file_url)
	_set_progress(
		job,
		0,
		total_admissions=summary.get("admissions"),
		resolvable_admissions=summary.get("resolvable_admissions"),
		file_rows=summary.get("file_rows"),
		medicine_lines=summary.get("medicine_lines"),
		unresolved_rows=summary.get("unresolved_rows"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_medication_order_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_medication_order_import",
	)
	return {
		"ok": True,
		"message": _(
			"Patient Medication Order import started ({0} admissions, {1} medicine lines, {2} resolvable admissions)."
		).format(
			summary.get("admissions") or 0,
			summary.get("medicine_lines") or 0,
			summary.get("resolvable_admissions") or 0,
		),
	}


def process_patient_medication_order_import_batch(offset: int = 0) -> None:
	from healthcare.api.patient_medication_order_import import run_patient_medication_order_import_batch

	job = "patient_medication_order_import"
	try:
		result = run_patient_medication_order_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			ok=cint(prev.get("ok", 0)) + cint(result.get("ok", 0)),
			skip_no_admission=cint(prev.get("skip_no_admission", 0))
			+ cint(result.get("skip_no_admission", 0)),
			skip_no_lines=cint(prev.get("skip_no_lines", 0)) + cint(result.get("skip_no_lines", 0)),
			skip_no_new_lines=cint(prev.get("skip_no_new_lines", 0))
			+ cint(result.get("skip_no_new_lines", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_admissions=prev.get("total_admissions"),
			medicine_lines=prev.get("medicine_lines"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_medication_order_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_medication_order_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Patient Medication Order import complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── OP Injection Prescription import (Oracle VISIT_00_04) ─────────────────────


@frappe.whitelist()
def start_op_injection_prescription_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.op_injection_prescription_import import parse_and_cache_file

	if not (file_url or "").strip():
		frappe.throw(_("Please upload an Excel file first."))

	job = "op_injection_prescription_import"
	_acquire_lock(job)
	summary = parse_and_cache_file(file_url)
	_set_progress(
		job,
		0,
		total_groups=summary.get("medicine_groups"),
		resolvable_groups=summary.get("resolvable_groups"),
		file_rows=summary.get("file_rows"),
		give_out_lines=summary.get("give_out_lines"),
		skipped_rows=summary.get("skipped_rows"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_op_injection_prescription_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_op_injection_prescription_import",
	)
	return {
		"ok": True,
		"message": _(
			"OP Injection Prescription import started ({0} patient/medicine groups, {1} give-out rows, {2} resolvable groups)."
		).format(
			summary.get("medicine_groups") or 0,
			summary.get("give_out_lines") or 0,
			summary.get("resolvable_groups") or 0,
		),
	}


def process_op_injection_prescription_import_batch(offset: int = 0) -> None:
	from healthcare.api.op_injection_prescription_import import run_op_injection_prescription_import_batch

	job = "op_injection_prescription_import"
	try:
		result = run_op_injection_prescription_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			ok=cint(prev.get("ok", 0)) + cint(result.get("ok", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0)) + cint(result.get("skip_no_patient", 0)),
			skip_no_new_giveouts=cint(prev.get("skip_no_new_giveouts", 0))
			+ cint(result.get("skip_no_new_giveouts", 0)),
			skip_other=cint(prev.get("skip_other", 0)) + cint(result.get("skip_other", 0)),
			errors=cint(prev.get("errors", 0)) + len(result.get("errors") or []),
			total_groups=prev.get("total_groups"),
			give_out_lines=prev.get("give_out_lines"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_op_injection_prescription_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_op_injection_prescription_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="OP Injection Prescription import complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Legacy lab test Excel import (Oracle C LAB_00_03 + C-I LAB_00_04) ─────────


@frappe.whitelist()
def start_legacy_lab_import_migration(header_file_url: str, detail_file_url: str) -> dict:
	_require_admin()
	from healthcare.api.lab_test_legacy_import import parse_and_cache_excel

	if not (header_file_url or "").strip():
		frappe.throw(_("Please upload the lab header Excel file (C LAB_00_03)."))
	if not (detail_file_url or "").strip():
		frappe.throw(_("Please upload the lab detail Excel file (C-I LAB_00_04)."))

	job = "legacy_lab_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(header_file_url, detail_file_url)
	_set_progress(
		job,
		0,
		total_transactions=summary.get("transactions"),
		resolvable_patient=summary.get("resolvable_patient"),
		resolvable_template=summary.get("resolvable_template"),
		standalone_transactions=summary.get("standalone_transactions"),
		header_rows=summary.get("header_rows"),
		detail_rows=summary.get("detail_rows"),
		batch_id=summary.get("batch_id"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_legacy_lab_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_legacy_lab_import",
	)
	return {
		"ok": True,
		"message": _(
			"Legacy lab import started ({0} transactions: {1} with header/patient, {2} standalone from detail only, {3} with matching template)."
		).format(
			summary.get("transactions") or 0,
			summary.get("resolvable_patient") or 0,
			summary.get("standalone_transactions") or 0,
			summary.get("resolvable_template") or 0,
		),
	}


def process_legacy_lab_import_batch(offset: int = 0) -> None:
	from healthcare.api.lab_test_legacy_import import run_legacy_lab_import_batch

	job = "legacy_lab_import"
	try:
		result = run_legacy_lab_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			ok=cint(prev.get("ok", 0)) + cint(result.get("ok", 0)),
			standalone_ok=cint(prev.get("standalone_ok", 0)) + cint(result.get("standalone_ok", 0)),
			patients_created=cint(prev.get("patients_created", 0))
			+ cint(result.get("patients_created", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0))
			+ cint(result.get("skip_no_patient", 0)),
			skip_no_template=cint(prev.get("skip_no_template", 0))
			+ cint(result.get("skip_no_template", 0)),
			skip_no_header=cint(prev.get("skip_no_header", 0))
			+ cint(result.get("skip_no_header", 0)),
			skip_already_imported=cint(prev.get("skip_already_imported", 0))
			+ cint(result.get("skip_already_imported", 0)),
			skip_existing_non_legacy=cint(prev.get("skip_existing_non_legacy", 0))
			+ cint(result.get("skip_existing_non_legacy", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_transactions=prev.get("total_transactions"),
			batch_id=prev.get("batch_id"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_legacy_lab_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_legacy_lab_import_{processed}",
			)
		else:
			final = frappe.cache().get_value(_job_progress_key(job)) or {}
			final.update({"processed": processed, "done": True, "error": None, "updated_at": str(now_datetime())})
			frappe.cache().set_value(_job_progress_key(job), final, expires_in_sec=JOB_LOCK_SECONDS)
			_release_lock(job)
			from healthcare.api.lab_test_legacy_import import build_legacy_lab_import_summary, log_legacy_lab_import_completion

			summary = log_legacy_lab_import_completion(final)
			final.update(
				{
					"in_database": summary.get("in_database"),
					"missing_from_database": summary.get("missing_from_database"),
					"failure_count": summary.get("failure_count"),
				}
			)
			frappe.cache().set_value(_job_progress_key(job), final, expires_in_sec=JOB_LOCK_SECONDS)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Nursing discharge checklist Excel import (Oracle IP_ADMISSION_04_NUR) ─────


@frappe.whitelist()
def start_nursing_checklist_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.nursing_checklist_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload an Excel file first."))

	job = "nursing_checklist_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_admissions=summary.get("admissions"),
		resolvable_admissions=summary.get("resolvable_admissions"),
		excel_rows=summary.get("excel_rows"),
		unresolved_rows=summary.get("unresolved_rows"),
		template=summary.get("template"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_nursing_checklist_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_nursing_checklist_import",
	)
	return {
		"ok": True,
		"message": _(
			"Nursing checklist import started ({0} admissions in file, {1} can be matched to Discharge)."
		).format(
			summary.get("admissions") or 0,
			summary.get("resolvable_admissions") or 0,
		),
	}


def process_nursing_checklist_import_batch(offset: int = 0) -> None:
	from healthcare.api.nursing_checklist_import import run_nursing_checklist_import_batch

	job = "nursing_checklist_import"
	try:
		result = run_nursing_checklist_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			ok=cint(prev.get("ok", 0)) + cint(result.get("ok", 0)),
			skip_no_admission=cint(prev.get("skip_no_admission", 0))
			+ cint(result.get("skip_no_admission", 0)),
			skip_no_discharge=cint(prev.get("skip_no_discharge", 0))
			+ cint(result.get("skip_no_discharge", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_admissions=prev.get("total_admissions"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_nursing_checklist_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_nursing_checklist_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Nursing checklist import complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


def process_morse_fall_scale_detail_import_batch(offset: int = 0) -> None:
	from healthcare.api.morse_fall_scale_detail_import import run_morse_fall_scale_detail_import_batch

	job = "morse_fall_scale_detail"
	counter_fields = [
		"updated",
		"skipped_empty_details",
		"unresolved_missing_patient_or_admission",
		"unresolved_morse_not_found",
	]
	try:
		result = run_morse_fall_scale_detail_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		extra = {field: cint(prev.get(field, 0)) + cint(result.get(field, 0)) for field in counter_fields}
		_set_progress(job, processed, **extra)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_morse_fall_scale_detail_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_morse_fall_scale_detail_{processed}",
			)
		else:
			_set_progress(job, processed, done=True, **extra)
			_release_lock(job)
			frappe.log_error(
				title="Morse Fall Scale detail backfill complete",
				message=frappe.as_json({"processed": processed, "done": True, **extra}),
			)
	except Exception:
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


def process_morse_fall_scale_detail_dedupe_batch(offset: int = 0) -> None:
	from healthcare.api.morse_fall_scale_detail_dedupe import run_morse_fall_scale_detail_dedupe_batch

	job = "morse_fall_scale_detail_dedupe"
	counter_fields = [
		"parents_processed",
		"rows_deleted",
		"parents_total_updated",
		"errors",
	]
	try:
		result = run_morse_fall_scale_detail_dedupe_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		batch_count = cint(result.get("batch_count", 0))
		processed = cint(prev.get("processed", 0)) + batch_count
		extra = {field: cint(prev.get(field, 0)) + cint(result.get(field, 0)) for field in counter_fields}
		_set_progress(job, processed, **extra)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_morse_fall_scale_detail_dedupe_batch",
				offset=0,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_morse_fall_scale_detail_dedupe_{processed}",
			)
		else:
			_set_progress(job, processed, done=True, **extra)
			_release_lock(job)
			frappe.log_error(
				title="Morse Fall Scale detail dedupe complete",
				message=frappe.as_json({"processed": processed, "done": True, **extra}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Normalize comma legacy IDs (1,415 → 1415) ─────────────────────────────────


def _accumulate_comma_job_progress(job: str, result: dict, counter_fields: list[str]) -> dict:
	"""Merge batch counters into job progress; keep total/remaining accurate."""
	prev = frappe.cache().get_value(_job_progress_key(job)) or {}
	batch_count = cint(result.get("batch_count", 0))
	processed = cint(prev.get("processed", 0)) + batch_count
	remaining = cint(result.get("remaining", 0))
	total = cint(prev.get("total")) or (processed + remaining)
	if remaining:
		total = max(total, processed + remaining)

	extra = {
		"total": total,
		"remaining": remaining,
	}
	for field in counter_fields:
		extra[field] = cint(prev.get(field, 0)) + cint(result.get(field, 0))

	_set_progress(job, processed, **extra)
	return {"processed": processed, **extra}


def _finish_comma_job(job: str, title: str, counter_fields: list[str]) -> None:
	prev = frappe.cache().get_value(_job_progress_key(job)) or {}
	processed = cint(prev.get("processed", 0))
	extra = {
		"remaining": 0,
		"total": cint(prev.get("total")) or processed,
	}
	for field in counter_fields:
		extra[field] = prev.get(field, 0)
	_set_progress(job, processed, done=True, **extra)
	_release_lock(job)
	frappe.log_error(title=title, message=frappe.as_json({"processed": processed, "done": True, **extra}))


@frappe.whitelist()
def start_comma_admission_id_migration() -> dict:
	_require_admin()
	from healthcare.api.legacy_id_normalize import _comma_inpatient_admission_names

	job = "comma_admission_ids"
	_acquire_lock(job)
	names = _comma_inpatient_admission_names()
	_set_progress(job, 0, total=len(names), remaining=len(names))
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_comma_admission_id_batch",
		queue="long",
		timeout=3600,
		job_name="healthcare_comma_admission_ids",
	)
	return {
		"ok": True,
		"message": _("Comma admission ID cleanup started ({0} records).").format(len(names)),
	}


def process_comma_admission_id_batch() -> None:
	from healthcare.api.legacy_id_normalize import run_comma_admission_batch_next

	job = "comma_admission_ids"
	counter_fields = ["ok", "case_no_fixed", "skip", "errors"]
	try:
		result = run_comma_admission_batch_next()
		_accumulate_comma_job_progress(job, result, counter_fields)
		if not result.get("done"):
			processed = cint(
				(frappe.cache().get_value(_job_progress_key(job)) or {}).get("processed", 0)
			)
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_comma_admission_id_batch",
				queue="long",
				timeout=3600,
				job_name=f"healthcare_comma_admission_ids_{processed}",
			)
		else:
			_finish_comma_job(job, "Comma admission ID cleanup complete", counter_fields)
	except Exception:
		frappe.db.rollback()
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		_set_progress(
			job,
			cint(prev.get("processed", 0)),
			done=True,
			error=frappe.get_traceback(),
			total=prev.get("total"),
		)
		_release_lock(job)
		raise


@frappe.whitelist()
def start_comma_discharge_id_migration() -> dict:
	_require_admin()
	from healthcare.api.legacy_id_normalize import _comma_discharge_names

	job = "comma_discharge_ids"
	_acquire_lock(job)
	names = _comma_discharge_names()
	_set_progress(job, 0, total=len(names), remaining=len(names))
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_comma_discharge_id_batch",
		queue="long",
		timeout=3600,
		job_name="healthcare_comma_discharge_ids",
	)
	return {
		"ok": True,
		"message": _("Comma discharge ID cleanup started ({0} records).").format(len(names)),
	}


def process_comma_discharge_id_batch() -> None:
	from healthcare.api.legacy_id_normalize import run_comma_discharge_batch_next

	job = "comma_discharge_ids"
	counter_fields = ["ok", "admission_fixed", "skip", "errors"]
	try:
		result = run_comma_discharge_batch_next()
		_accumulate_comma_job_progress(job, result, counter_fields)
		if not result.get("done"):
			processed = cint(
				(frappe.cache().get_value(_job_progress_key(job)) or {}).get("processed", 0)
			)
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_comma_discharge_id_batch",
				queue="long",
				timeout=3600,
				job_name=f"healthcare_comma_discharge_ids_{processed}",
			)
		else:
			_finish_comma_job(job, "Comma discharge ID cleanup complete", counter_fields)
	except Exception:
		frappe.db.rollback()
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		_set_progress(
			job,
			cint(prev.get("processed", 0)),
			done=True,
			error=frappe.get_traceback(),
			total=prev.get("total"),
		)
		_release_lock(job)
		raise


# ── Sync Visit Diagnosis → Patient Visit / Inpatient Admission child tables ───


@frappe.whitelist()
def start_visit_diagnosis_sync_migration() -> dict:
	_require_admin()
	from healthcare.api.visit_diagnosis_sync import CACHE_NAMES, CACHE_TTL, _visit_diagnosis_names

	job = "visit_diagnosis_sync"
	_acquire_lock(job)
	names = _visit_diagnosis_names()
	frappe.cache().set_value(CACHE_NAMES, names, expires_in_sec=CACHE_TTL)
	_set_progress(job, 0, total=len(names), remaining=len(names))
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_visit_diagnosis_sync_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_visit_diagnosis_sync",
	)
	return {
		"ok": True,
		"message": _("Visit Diagnosis sync started ({0} staging rows).").format(len(names)),
	}


def process_visit_diagnosis_sync_batch(offset: int = 0) -> None:
	from healthcare.api.visit_diagnosis_sync import (
		CACHE_NAMES,
		CACHE_TTL,
		_visit_diagnosis_names,
		run_visit_diagnosis_sync_batch,
	)

	job = "visit_diagnosis_sync"
	counter_fields = [
		"appended_visit",
		"appended_admission",
		"duplicate",
		"skip",
		"errors",
	]
	try:
		names = frappe.cache().get_value(CACHE_NAMES)
		if not names:
			names = _visit_diagnosis_names()
			frappe.cache().set_value(CACHE_NAMES, names, expires_in_sec=CACHE_TTL)

		result = run_visit_diagnosis_sync_batch(names, offset=offset)
		_accumulate_comma_job_progress(job, result, counter_fields)
		if not result.get("done"):
			processed = cint(
				(frappe.cache().get_value(_job_progress_key(job)) or {}).get("processed", 0)
			)
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_visit_diagnosis_sync_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_visit_diagnosis_sync_{processed}",
			)
		else:
			frappe.cache().delete_value(CACHE_NAMES)
			_finish_comma_job(job, "Visit Diagnosis sync complete", counter_fields)
	except Exception:
		frappe.db.rollback()
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		_set_progress(
			job,
			cint(prev.get("processed", 0)),
			done=True,
			error=frappe.get_traceback(),
			total=prev.get("total"),
		)
		_release_lock(job)
		frappe.cache().delete_value(CACHE_NAMES)
		raise


# ── Patient Excel import (Oracle PATIENT_INFO_01) ─────────────────────────────


@frappe.whitelist()
def start_patient_info_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.patient_info_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload an Excel file first."))

	job = "patient_info_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_patients=summary.get("patients"),
		excel_rows=summary.get("excel_rows"),
		existing_patients=summary.get("existing_patients"),
		new_patients=summary.get("new_patients"),
		with_allergies=summary.get("with_allergies"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_info_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_info_import",
	)
	return {
		"ok": True,
		"message": _(
			"Patient import started ({0} rows, {1} to create, {2} to update, {3} with allergies)."
		).format(
			summary.get("patients") or 0,
			summary.get("new_patients") or 0,
			summary.get("existing_patients") or 0,
			summary.get("with_allergies") or 0,
		),
	}


def process_patient_info_import_batch(offset: int = 0) -> None:
	from healthcare.api.patient_info_import import run_patient_info_import_batch

	job = "patient_info_import"
	try:
		result = run_patient_info_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_name=cint(prev.get("skip_no_name", 0)) + cint(result.get("skip_no_name", 0)),
			skip_no_gender=cint(prev.get("skip_no_gender", 0))
			+ cint(result.get("skip_no_gender", 0)),
			allergy_warnings_created=cint(prev.get("allergy_warnings_created", 0))
			+ cint(result.get("allergy_warnings_created", 0)),
			allergy_warnings_updated=cint(prev.get("allergy_warnings_updated", 0))
			+ cint(result.get("allergy_warnings_updated", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_patients=prev.get("total_patients"),
			excel_rows=prev.get("excel_rows"),
			with_allergies=prev.get("with_allergies"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_info_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_info_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Patient import (PATIENT_INFO_01) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Patient allergy Warning Message import (PATIENT_INFO_01 allergies only) ───


@frappe.whitelist()
def start_patient_allergy_warning_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.patient_allergy_warning_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload an Excel file first."))

	job = "patient_allergy_warning_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_patients=summary.get("patients"),
		excel_rows=summary.get("excel_rows"),
		with_allergies=summary.get("with_allergies"),
		patients_found=summary.get("patients_found"),
		patients_missing=summary.get("patients_missing"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_allergy_warning_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_allergy_warning_import",
	)
	return {
		"ok": True,
		"message": _(
			"Patient allergy import started ({0} rows with allergies, {1} patients in system)."
		).format(
			summary.get("with_allergies") or 0,
			summary.get("patients_found") or 0,
		),
	}


def process_patient_allergy_warning_import_batch(offset: int = 0) -> None:
	from healthcare.api.patient_allergy_warning_import import run_patient_allergy_warning_import_batch

	job = "patient_allergy_warning_import"
	try:
		result = run_patient_allergy_warning_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_empty_allergy=cint(prev.get("skip_empty_allergy", 0))
			+ cint(result.get("skip_empty_allergy", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0))
			+ cint(result.get("skip_no_patient", 0)),
			skip_unchanged=cint(prev.get("skip_unchanged", 0))
			+ cint(result.get("skip_unchanged", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_patients=prev.get("total_patients"),
			excel_rows=prev.get("excel_rows"),
			with_allergies=prev.get("with_allergies"),
			patients_found=prev.get("patients_found"),
			patients_missing=prev.get("patients_missing"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_allergy_warning_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_allergy_warning_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Patient allergy Warning Message import (PATIENT_INFO_01) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Patient blacklist sync from PATIENT_INFO_01 (1 = yes, 2 = no) ─────────────


@frappe.whitelist()
def start_patient_blacklist_sync_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.patient_blacklist_sync import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload an Excel file first."))

	job = "patient_blacklist_sync"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_patients=summary.get("patients"),
		excel_rows=summary.get("excel_rows"),
		excel_blacklisted=summary.get("excel_blacklisted"),
		excel_not_blacklisted=summary.get("excel_not_blacklisted"),
		patients_found=summary.get("patients_found"),
		patients_missing=summary.get("patients_missing"),
		needs_update=summary.get("needs_update"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_blacklist_sync_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_blacklist_sync",
	)
	return {
		"ok": True,
		"message": _(
			"Patient blacklist sync started ({0} Excel rows, {1} need update: "
			"{2} blacklisted / {3} not blacklisted in file)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("needs_update") or 0,
			summary.get("excel_blacklisted") or 0,
			summary.get("excel_not_blacklisted") or 0,
		),
	}


def process_patient_blacklist_sync_batch(offset: int = 0) -> None:
	from healthcare.api.patient_blacklist_sync import run_patient_blacklist_sync_batch

	job = "patient_blacklist_sync"
	try:
		result = run_patient_blacklist_sync_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			set_blacklisted=cint(prev.get("set_blacklisted", 0))
			+ cint(result.get("set_blacklisted", 0)),
			cleared=cint(prev.get("cleared", 0)) + cint(result.get("cleared", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0))
			+ cint(result.get("skip_no_patient", 0)),
			skip_unchanged=cint(prev.get("skip_unchanged", 0))
			+ cint(result.get("skip_unchanged", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_patients=prev.get("total_patients"),
			excel_rows=prev.get("excel_rows"),
			excel_blacklisted=prev.get("excel_blacklisted"),
			excel_not_blacklisted=prev.get("excel_not_blacklisted"),
			patients_found=prev.get("patients_found"),
			patients_missing=prev.get("patients_missing"),
			needs_update=prev.get("needs_update"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_blacklist_sync_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_blacklist_sync_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Patient blacklist sync (PATIENT_INFO_01) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── IP Admission + Discharge Excel import (Oracle IP_ADMISSION_01) ────────────


@frappe.whitelist()
def start_ip_admission_discharge_import_migration(
	file_url: str,
	nursing_file_url: str | None = None,
	discharge_checklist_file_url: str | None = None,
) -> dict:
	_require_admin()
	from healthcare.api.ip_admission_discharge_import import (
		parse_and_cache_bundle,
		parse_and_cache_excel,
	)

	if not (file_url or "").strip():
		frappe.throw(_("Please upload an Excel file first."))

	job = "ip_admission_discharge_import"
	_acquire_lock(job)
	if nursing_file_url or discharge_checklist_file_url:
		summary = parse_and_cache_bundle(
			file_url,
			nursing_file_url or None,
			discharge_checklist_file_url or None,
		)
	else:
		summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_admissions=summary.get("admissions"),
		excel_rows=summary.get("excel_rows"),
		existing_admissions=summary.get("existing_admissions"),
		existing_discharges=summary.get("existing_discharges"),
		missing_patients=summary.get("missing_patients"),
		discharged_rows=summary.get("discharged_rows"),
		admitted_rows=summary.get("admitted_rows"),
		nursing_rows=summary.get("nursing_rows"),
		nursing_admissions=summary.get("nursing_admissions"),
		discharge_checklist_rows=summary.get("discharge_checklist_rows"),
		discharge_checklist_admissions=summary.get("discharge_checklist_admissions"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_admission_discharge_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_admission_discharge_import",
	)
	checklist_note = ""
	if summary.get("nursing_admissions") or summary.get("discharge_checklist_admissions"):
		checklist_note = _(
			" Nursing checklist: {0} admissions ({1} rows). Discharge checklist: {2} admissions ({3} rows)."
		).format(
			summary.get("nursing_admissions") or 0,
			summary.get("nursing_rows") or 0,
			summary.get("discharge_checklist_admissions") or 0,
			summary.get("discharge_checklist_rows") or 0,
		)
	return {
		"ok": True,
		"message": _(
			"IP Admission/Discharge import started ({0} rows: {1} discharged, {2} admitted).{3}"
		).format(
			summary.get("admissions") or 0,
			summary.get("discharged_rows") or 0,
			summary.get("admitted_rows") or 0,
			checklist_note,
		),
	}


def process_ip_admission_discharge_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_admission_discharge_import import run_ip_admission_discharge_import_batch

	job = "ip_admission_discharge_import"
	try:
		result = run_ip_admission_discharge_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0))
			+ cint(result.get("skip_no_patient", 0)),
			discharges_created=cint(prev.get("discharges_created", 0))
			+ cint(result.get("discharges_created", 0)),
			discharges_updated=cint(prev.get("discharges_updated", 0))
			+ cint(result.get("discharges_updated", 0)),
			discharges_submitted=cint(prev.get("discharges_submitted", 0))
			+ cint(result.get("discharges_submitted", 0)),
			nursing_ok=cint(prev.get("nursing_ok", 0)) + cint(result.get("nursing_ok", 0)),
			nursing_skip=cint(prev.get("nursing_skip", 0)) + cint(result.get("nursing_skip", 0)),
			discharge_cl_ok=cint(prev.get("discharge_cl_ok", 0))
			+ cint(result.get("discharge_cl_ok", 0)),
			discharge_cl_skip=cint(prev.get("discharge_cl_skip", 0))
			+ cint(result.get("discharge_cl_skip", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_admissions=prev.get("total_admissions"),
			discharged_rows=prev.get("discharged_rows"),
			admitted_rows=prev.get("admitted_rows"),
			missing_patients=prev.get("missing_patients"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_admission_discharge_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_admission_discharge_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="IP Admission/Discharge import (IP_ADMISSION_01) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Patient Visit Excel import (Oracle VISIT_00_01) ───────────────────────────


@frappe.whitelist()
def start_patient_visit_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.patient_visit_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the VISIT_00_01 Excel file."))

	job = "patient_visit_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_visits=summary.get("visits"),
		excel_rows=summary.get("excel_rows"),
		existing_visits=summary.get("existing_visits"),
		patients_to_create=summary.get("patients_to_create"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_visit_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_visit_import",
	)
	return {
		"ok": True,
		"message": _(
			"Patient Visit import started ({0} visits, {1} existing, {2} patients will be auto-created)."
		).format(
			summary.get("visits") or 0,
			summary.get("existing_visits") or 0,
			summary.get("patients_to_create") or 0,
		),
	}


def process_patient_visit_import_batch(offset: int = 0) -> None:
	from healthcare.api.patient_visit_import import run_patient_visit_import_batch

	job = "patient_visit_import"
	try:
		result = run_patient_visit_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0))
			+ cint(result.get("skip_no_patient", 0)),
			skip_no_date=cint(prev.get("skip_no_date", 0)) + cint(result.get("skip_no_date", 0)),
			submitted=cint(prev.get("submitted", 0)) + cint(result.get("submitted", 0)),
			patients_created=cint(prev.get("patients_created", 0))
			+ cint(result.get("patients_created", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_visits=prev.get("total_visits"),
			excel_rows=prev.get("excel_rows"),
			patients_to_create=prev.get("patients_to_create"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_visit_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_visit_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Patient Visit import (VISIT_00_01) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Daily Patient Visit Setup Excel import (Oracle DAILY_PATIENTS_01) ─────────


@frappe.whitelist()
def start_daily_patient_visit_setup_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.daily_patient_visit_setup_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the DAILY_PATIENTS_01 Excel file."))

	job = "daily_patient_visit_setup_import"
	_acquire_lock(job)
	from healthcare.api.daily_patient_visit_setup_import import (
		_build_preview_summary,
		_cache_is_warm,
		_load_cached_rows,
	)

	if _cache_is_warm(file_url):
		summary = _build_preview_summary(list(_load_cached_rows().values()))
	else:
		summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_setups=summary.get("setups"),
		excel_rows=summary.get("excel_rows"),
		existing_setups=summary.get("existing_setups"),
		patients_to_create=summary.get("patients_to_create"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_daily_patient_visit_setup_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_daily_patient_visit_setup_import",
	)
	return {
		"ok": True,
		"message": _(
			"Daily Patient Visit Setup import started ({0} setups, {1} existing, {2} patients will be auto-created)."
		).format(
			summary.get("setups") or 0,
			summary.get("existing_setups") or 0,
			summary.get("patients_to_create") or 0,
		),
	}


def process_daily_patient_visit_setup_import_batch(offset: int = 0) -> None:
	from healthcare.api.daily_patient_visit_setup_import import run_daily_patient_visit_setup_import_batch

	job = "daily_patient_visit_setup_import"
	try:
		result = run_daily_patient_visit_setup_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skipped=cint(prev.get("skipped", 0)) + cint(result.get("skipped", 0)),
			total_setups=prev.get("total_setups"),
			excel_rows=prev.get("excel_rows"),
			patients_to_create=prev.get("patients_to_create"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_daily_patient_visit_setup_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_daily_patient_visit_setup_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Daily Patient Visit Setup import (DAILY_PATIENTS_01) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Daily Auto Visit Excel import (Oracle DAILY_PATIENTS_02) ──────────────────


@frappe.whitelist()
def start_daily_auto_visit_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.daily_auto_visit_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the DAILY_PATIENTS_02 Excel file."))

	job = "daily_auto_visit_import"
	_acquire_lock(job)
	from healthcare.api.daily_auto_visit_import import _build_preview_summary, _cache_is_warm, _load_cached_rows

	if _cache_is_warm(file_url):
		summary = _build_preview_summary(list(_load_cached_rows().values()))
	else:
		summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_visits=summary.get("visits"),
		excel_rows=summary.get("excel_rows"),
		existing_visits=summary.get("existing_visits"),
		patients_to_create=summary.get("patients_to_create"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_daily_auto_visit_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_daily_auto_visit_import",
	)
	return {
		"ok": True,
		"message": _(
			"Daily Auto Visit import started ({0} visits, {1} existing, {2} patients will be auto-created)."
		).format(
			summary.get("visits") or 0,
			summary.get("existing_visits") or 0,
			summary.get("patients_to_create") or 0,
		),
	}


def process_daily_auto_visit_import_batch(offset: int = 0) -> None:
	from healthcare.api.daily_auto_visit_import import run_daily_auto_visit_import_batch

	job = "daily_auto_visit_import"
	try:
		result = run_daily_auto_visit_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skipped=cint(prev.get("skipped", 0)) + cint(result.get("skipped", 0)),
			submitted=cint(prev.get("submitted", 0)) + cint(result.get("submitted", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0)) + cint(result.get("skip_no_patient", 0)),
			skip_no_date=cint(prev.get("skip_no_date", 0)) + cint(result.get("skip_no_date", 0)),
			skip_no_case_no=cint(prev.get("skip_no_case_no", 0)) + cint(result.get("skip_no_case_no", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_visits=prev.get("total_visits"),
			excel_rows=prev.get("excel_rows"),
			patients_to_create=prev.get("patients_to_create"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_daily_auto_visit_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_daily_auto_visit_import_{processed}",
			)
		else:
			stats = frappe.cache().get_value(_job_progress_key(job)) or {}
			_set_progress(
				job,
				processed,
				done=True,
				created=stats.get("created", 0),
				updated=stats.get("updated", 0),
				skipped=stats.get("skipped", 0),
				submitted=stats.get("submitted", 0),
				skip_no_patient=stats.get("skip_no_patient", 0),
				skip_no_date=stats.get("skip_no_date", 0),
				skip_no_case_no=stats.get("skip_no_case_no", 0),
				errors=stats.get("errors", 0),
				total_visits=stats.get("total_visits"),
				excel_rows=stats.get("excel_rows"),
				patients_to_create=stats.get("patients_to_create"),
			)
			_release_lock(job)
			frappe.log_error(
				title="Daily Auto Visit import (DAILY_PATIENTS_02) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Legacy Sales Transactions master (SALES_DATA_MASTER) ─────────────────────


@frappe.whitelist()
def start_legacy_sales_master_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.legacy_sales_master_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the SALES_DATA_MASTER Excel file."))

	job = "legacy_sales_master_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_records=summary.get("new_records"),
		existing_records=summary.get("existing_records"),
		resolved_visits=summary.get("resolved_visits"),
		resolved_patients=summary.get("resolved_patients"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_legacy_sales_master_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_legacy_sales_master_import",
	)
	return {
		"ok": True,
		"message": _(
			"Legacy Sales Transactions master import started ({0} rows, {1} new)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_records") or 0,
		),
	}


def process_legacy_sales_master_import_batch(offset: int = 0) -> None:
	from healthcare.api.legacy_sales_master_import import run_legacy_sales_master_import_batch

	job = "legacy_sales_master_import"
	try:
		result = run_legacy_sales_master_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skipped=cint(prev.get("skipped", 0)) + cint(result.get("skipped", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=result.get("total_rows") or prev.get("total_rows"),
			new_records=prev.get("new_records"),
			existing_records=prev.get("existing_records"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_legacy_sales_master_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_legacy_sales_master_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Legacy Sales master import (SALES_DATA_MASTER) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Legacy Sales Transactions detail (SALES_DATA_DETAILS) ────────────────────


@frappe.whitelist()
def start_legacy_sales_detail_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.legacy_sales_detail_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the SALES_DATA_DETAILS Excel file."))

	job = "legacy_sales_detail_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("transactions"),
		excel_rows=summary.get("excel_rows"),
		linked_parents=summary.get("linked_parents"),
		missing_parents=summary.get("missing_parents"),
		resolved_items=summary.get("resolved_items"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_legacy_sales_detail_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_legacy_sales_detail_import",
	)
	return {
		"ok": True,
		"message": _(
			"Legacy Sales Transactions detail import started ({0} lines across {1} transactions)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("transactions") or 0,
		),
	}


def process_legacy_sales_detail_import_batch(offset: int = 0) -> None:
	from healthcare.api.legacy_sales_detail_import import run_legacy_sales_detail_import_batch

	job = "legacy_sales_detail_import"
	try:
		result = run_legacy_sales_detail_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			ok=cint(prev.get("ok", 0)) + cint(result.get("ok", 0)),
			parents_created=cint(prev.get("parents_created", 0))
			+ cint(result.get("parents_created", 0)),
			skip_no_parent=0,
			skip_no_lines=cint(prev.get("skip_no_lines", 0)) + cint(result.get("skip_no_lines", 0)),
			items_added=cint(prev.get("items_added", 0)) + cint(result.get("items_added", 0)),
			items_updated=cint(prev.get("items_updated", 0))
			+ cint(result.get("items_updated", 0)),
			items_skipped=cint(prev.get("items_skipped", 0))
			+ cint(result.get("items_skipped", 0)),
			items_resolved=cint(prev.get("items_resolved", 0))
			+ cint(result.get("items_resolved", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			excel_rows=prev.get("excel_rows"),
			linked_parents=prev.get("linked_parents"),
			missing_parents=prev.get("missing_parents"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_legacy_sales_detail_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_legacy_sales_detail_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Legacy Sales detail import (SALES_DATA_DETAILS) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_legacy_sales_item_link_backfill_migration() -> dict:
	"""Backfill blank Item links on Legacy Sales Transaction Item from item_num → ITEM_00_01."""
	from healthcare.api.legacy_sales_item_link_backfill import start_legacy_sales_item_link_backfill

	return start_legacy_sales_item_link_backfill()


# ── Service Request Excel import (Oracle VISIT_00_02) ───────────────────────


@frappe.whitelist()
def start_service_request_visit_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.service_request_visit_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the VISIT_00_02 Excel file."))

	job = "service_request_visit_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("service_requests"),
		excel_rows=summary.get("excel_rows"),
		unique_visits=summary.get("unique_visits"),
		visits_to_create=summary.get("visits_to_create"),
		existing_service_requests=summary.get("existing_service_requests"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_service_request_visit_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_service_request_visit_import",
	)
	return {
		"ok": True,
		"message": _(
			"Service Request import started ({0} rows, {1} visits to create, {2} existing service requests)."
		).format(
			summary.get("service_requests") or 0,
			summary.get("visits_to_create") or 0,
			summary.get("existing_service_requests") or 0,
		),
	}


def process_service_request_visit_import_batch(offset: int = 0) -> None:
	from healthcare.api.service_request_visit_import import run_service_request_visit_import_batch

	job = "service_request_visit_import"
	try:
		result = run_service_request_visit_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_visit=cint(prev.get("skip_no_visit", 0)) + cint(result.get("skip_no_visit", 0)),
			skip_no_template=cint(prev.get("skip_no_template", 0))
			+ cint(result.get("skip_no_template", 0)),
			visits_created=cint(prev.get("visits_created", 0)) + cint(result.get("visits_created", 0)),
			patients_created=cint(prev.get("patients_created", 0))
			+ cint(result.get("patients_created", 0)),
			submitted=cint(prev.get("submitted", 0)) + cint(result.get("submitted", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			excel_rows=prev.get("excel_rows"),
			unique_visits=prev.get("unique_visits"),
			visits_to_create=prev.get("visits_to_create"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_service_request_visit_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_service_request_visit_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Service Request import (VISIT_00_02) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Legacy IP Service Excel import (Oracle SRV_00_03 + SRV_00_04) ────────────


@frappe.whitelist()
def start_legacy_ip_service_import_migration(header_file_url: str, detail_file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_service_legacy_import import parse_and_cache_excel

	if not (header_file_url or "").strip():
		frappe.throw(_("Please upload the SRV_00_03 Excel file (header / parent)."))
	if not (detail_file_url or "").strip():
		frappe.throw(_("Please upload the SRV_00_04 Excel file (detail lines)."))

	job = "legacy_ip_service_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(header_file_url, detail_file_url)
	_set_progress(
		job,
		0,
		total_transactions=summary.get("transactions"),
		visits_to_create=summary.get("visits_to_create"),
		standalone_transactions=summary.get("standalone_transactions"),
		header_rows=summary.get("header_rows"),
		detail_rows=summary.get("detail_rows"),
		batch_id=summary.get("batch_id"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_legacy_ip_service_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_legacy_ip_service_import",
	)
	return {
		"ok": True,
		"message": _(
			"Legacy IP Service import started ({0} transactions, {1} visits to create, {2} standalone from detail only)."
		).format(
			summary.get("transactions") or 0,
			summary.get("visits_to_create") or 0,
			summary.get("standalone_transactions") or 0,
		),
	}


def process_legacy_ip_service_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_service_legacy_import import run_legacy_ip_service_import_batch

	job = "legacy_ip_service_import"
	try:
		result = run_legacy_ip_service_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			ok=cint(prev.get("ok", 0)) + cint(result.get("ok", 0)),
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			standalone_ok=cint(prev.get("standalone_ok", 0)) + cint(result.get("standalone_ok", 0)),
			visits_created=cint(prev.get("visits_created", 0)) + cint(result.get("visits_created", 0)),
			patients_created=cint(prev.get("patients_created", 0))
			+ cint(result.get("patients_created", 0)),
			submitted=cint(prev.get("submitted", 0)) + cint(result.get("submitted", 0)),
			skip_no_template=cint(prev.get("skip_no_template", 0))
			+ cint(result.get("skip_no_template", 0)),
			skip_no_lines=cint(prev.get("skip_no_lines", 0)) + cint(result.get("skip_no_lines", 0)),
			skip_no_data=cint(prev.get("skip_no_data", 0)) + cint(result.get("skip_no_data", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_transactions=prev.get("total_transactions"),
			batch_id=prev.get("batch_id"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_legacy_ip_service_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_legacy_ip_service_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="IP Service import (SRV_00_03 + SRV_00_04) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Lab Test Patient Visit Excel import (Oracle VISIT_00_03) ─────────────────


@frappe.whitelist()
def start_lab_test_visit_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.lab_test_visit_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the VISIT_00_03 Excel file."))

	job = "lab_test_visit_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("lab_tests"),
		excel_rows=summary.get("excel_rows"),
		unique_visits=summary.get("unique_visits"),
		visits_to_create=summary.get("visits_to_create"),
		existing_lab_tests=summary.get("existing_lab_tests"),
		matching_templates=summary.get("matching_templates"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_lab_test_visit_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_lab_test_visit_import",
	)
	return {
		"ok": True,
		"message": _(
			"Lab Test VISIT_00_03 import started ({0} rows, {1} visits to create, {2} existing lab tests)."
		).format(
			summary.get("lab_tests") or 0,
			summary.get("visits_to_create") or 0,
			summary.get("existing_lab_tests") or 0,
		),
	}


def process_lab_test_visit_import_batch(offset: int = 0) -> None:
	from healthcare.api.lab_test_visit_import import run_lab_test_visit_import_batch

	job = "lab_test_visit_import"
	try:
		result = run_lab_test_visit_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_visit=cint(prev.get("skip_no_visit", 0)) + cint(result.get("skip_no_visit", 0)),
			skip_existing_non_legacy=cint(prev.get("skip_existing_non_legacy", 0))
			+ cint(result.get("skip_existing_non_legacy", 0)),
			visits_created=cint(prev.get("visits_created", 0)) + cint(result.get("visits_created", 0)),
			patients_created=cint(prev.get("patients_created", 0))
			+ cint(result.get("patients_created", 0)),
			submitted=cint(prev.get("submitted", 0)) + cint(result.get("submitted", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			excel_rows=prev.get("excel_rows"),
			unique_visits=prev.get("unique_visits"),
			visits_to_create=prev.get("visits_to_create"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_lab_test_visit_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_lab_test_visit_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Lab Test import (VISIT_00_03) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Patient Appointment Excel import (Oracle APPOINTMENTS_INFO_01) ───────────


@frappe.whitelist()
def start_patient_appointment_info_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.patient_appointment_info_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the APPOINTMENTS_INFO_01 Excel file."))

	job = "patient_appointment_info_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_appointments=summary.get("new_appointments"),
		existing_appointments=summary.get("existing_appointments"),
		patients_to_create=summary.get("patients_to_create"),
		walk_ins=summary.get("walk_ins"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_appointment_info_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_appointment_info_import",
	)
	return {
		"ok": True,
		"message": _(
			"Patient Appointment APPOINTMENTS_INFO_01 import started ({0} rows, {1} new, {2} existing, {3} patients to create)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_appointments") or 0,
			summary.get("existing_appointments") or 0,
			summary.get("patients_to_create") or 0,
		),
	}


def process_patient_appointment_info_import_batch(offset: int = 0) -> None:
	from healthcare.api.patient_appointment_info_import import run_patient_appointment_info_import_batch

	job = "patient_appointment_info_import"
	try:
		result = run_patient_appointment_info_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_date=cint(prev.get("skip_no_date", 0)) + cint(result.get("skip_no_date", 0)),
			patients_created=cint(prev.get("patients_created", 0))
			+ cint(result.get("patients_created", 0)),
			practitioners_created=cint(prev.get("practitioners_created", 0))
			+ cint(result.get("practitioners_created", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_appointments=prev.get("new_appointments"),
			existing_appointments=prev.get("existing_appointments"),
			patients_to_create=prev.get("patients_to_create"),
			walk_ins=prev.get("walk_ins"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_appointment_info_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_appointment_info_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Patient Appointment import (APPOINTMENTS_INFO_01) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Medical Diagnosis Entry Excel import (Oracle VISIT_DIAGNOSES_01) ─────────


@frappe.whitelist()
def start_visit_diagnoses_op_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.visit_diagnoses_op_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the VISIT_DIAGNOSES_01 Excel file."))

	job = "visit_diagnoses_op_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_entries=summary.get("new_entries"),
		existing_entries=summary.get("existing_entries"),
		matched_diagnosis=summary.get("matched_diagnosis"),
		skip_no_diagnosis=summary.get("skip_no_diagnosis"),
		patients_to_create=summary.get("patients_to_create"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_visit_diagnoses_op_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_visit_diagnoses_op_import",
	)
	return {
		"ok": True,
		"message": _(
			"Diagnosis OP VISIT_DIAGNOSES_01 import started ({0} rows, {1} new, {2} matched diagnosis codes)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_entries") or 0,
			summary.get("matched_diagnosis") or 0,
		),
	}


def process_visit_diagnoses_op_import_batch(offset: int = 0) -> None:
	from healthcare.api.visit_diagnoses_op_import import run_visit_diagnoses_op_import_batch

	job = "visit_diagnoses_op_import"
	try:
		result = run_visit_diagnoses_op_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_diagnosis=cint(prev.get("skip_no_diagnosis", 0))
			+ cint(result.get("skip_no_diagnosis", 0)),
			skip_unresolved_diagnosis=cint(prev.get("skip_unresolved_diagnosis", 0))
			+ cint(result.get("skip_unresolved_diagnosis", 0)),
			patients_created=cint(prev.get("patients_created", 0))
			+ cint(result.get("patients_created", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_entries=prev.get("new_entries"),
			existing_entries=prev.get("existing_entries"),
			matched_diagnosis=prev.get("matched_diagnosis"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_visit_diagnoses_op_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_visit_diagnoses_op_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Diagnosis OP import (VISIT_DIAGNOSES_01) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Medical Diagnosis Entry Excel import (Oracle IP_ADMISSION_DIAGNOSES) ─────


@frappe.whitelist()
def start_ip_admission_diagnoses_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_admission_diagnoses_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_ADMISSION_DIAGNOSES Excel file."))

	job = "ip_admission_diagnoses_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_entries=summary.get("new_entries"),
		existing_entries=summary.get("existing_entries"),
		resolved_admissions=summary.get("resolved_admissions"),
		unresolved_admissions=summary.get("unresolved_admissions"),
		skip_no_details=summary.get("skip_no_details"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_admission_diagnoses_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_admission_diagnoses_import",
	)
	return {
		"ok": True,
		"message": _(
			"Diagnosis IP IP_ADMISSION_DIAGNOSES import started ({0} rows, {1} new, {2} admissions resolved)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_entries") or 0,
			summary.get("resolved_admissions") or 0,
		),
	}


def process_ip_admission_diagnoses_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_admission_diagnoses_import import run_ip_admission_diagnoses_import_batch

	job = "ip_admission_diagnoses_import"
	try:
		result = run_ip_admission_diagnoses_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_details=cint(prev.get("skip_no_details", 0))
			+ cint(result.get("skip_no_details", 0)),
			admissions_resolved=cint(prev.get("admissions_resolved", 0))
			+ cint(result.get("admissions_resolved", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_entries=prev.get("new_entries"),
			existing_entries=prev.get("existing_entries"),
			resolved_admissions=prev.get("resolved_admissions"),
			unresolved_admissions=prev.get("unresolved_admissions"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_admission_diagnoses_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_admission_diagnoses_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Diagnosis IP import (IP_ADMISSION_DIAGNOSES) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Doctor Order Excel import (Oracle IP_DOCTOR_REQUEST_01) ───────────────────


@frappe.whitelist()
def start_ip_doctor_request_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_doctor_request_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_DOCTOR_REQUEST_01 Excel file."))

	job = "ip_doctor_request_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_orders=summary.get("new_orders"),
		existing_orders=summary.get("existing_orders"),
		resolved_admissions=summary.get("resolved_admissions"),
		patients_to_create=summary.get("patients_to_create"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_doctor_request_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_doctor_request_import",
	)
	return {
		"ok": True,
		"message": _(
			"Doctor Order IP_DOCTOR_REQUEST_01 import started ({0} rows, {1} new)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_orders") or 0,
		),
	}


def process_ip_doctor_request_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_doctor_request_import import run_ip_doctor_request_import_batch

	job = "ip_doctor_request_import"
	try:
		result = run_ip_doctor_request_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			placeholder_description=cint(prev.get("placeholder_description", 0))
			+ cint(result.get("placeholder_description", 0)),
			patients_created=cint(prev.get("patients_created", 0))
			+ cint(result.get("patients_created", 0)),
			practitioners_created=cint(prev.get("practitioners_created", 0))
			+ cint(result.get("practitioners_created", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_orders=prev.get("new_orders"),
			existing_orders=prev.get("existing_orders"),
			resolved_admissions=prev.get("resolved_admissions"),
			patients_to_create=prev.get("patients_to_create"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_doctor_request_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_doctor_request_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Doctor Order import (IP_DOCTOR_REQUEST_01) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Patient Assessment Excel import (Oracle IP_PATIENT_ASSESSMENT) ───────────


@frappe.whitelist()
def start_ip_patient_assessment_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_patient_assessment_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_PATIENT_ASSESSMENT Excel file."))

	job = "ip_patient_assessment_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("assessments"),
		new_assessments=summary.get("new_assessments"),
		existing_assessments=summary.get("existing_assessments"),
		assessment_template=summary.get("assessment_template"),
		resolved_admissions=summary.get("resolved_admissions"),
		duplicate_admission_rows=summary.get("duplicate_admission_rows"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_patient_assessment_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_patient_assessment_import",
	)
	return {
		"ok": True,
		"message": _(
			"Patient Assessment IP_PATIENT_ASSESSMENT import started ({0} admissions, {1} new, template {2})."
		).format(
			summary.get("assessments") or 0,
			summary.get("new_assessments") or 0,
			summary.get("assessment_template") or "",
		),
	}


def process_ip_patient_assessment_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_patient_assessment_import import run_ip_patient_assessment_import_batch

	job = "ip_patient_assessment_import"
	try:
		result = run_ip_patient_assessment_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			submitted=cint(prev.get("submitted", 0)) + cint(result.get("submitted", 0)),
			skip_no_admission=cint(prev.get("skip_no_admission", 0))
			+ cint(result.get("skip_no_admission", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0))
			+ cint(result.get("skip_no_patient", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_assessments=prev.get("new_assessments"),
			existing_assessments=prev.get("existing_assessments"),
			assessment_template=prev.get("assessment_template"),
			resolved_admissions=prev.get("resolved_admissions"),
			duplicate_admission_rows=prev.get("duplicate_admission_rows"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_patient_assessment_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_patient_assessment_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Patient Assessment import (IP_PATIENT_ASSESSMENT) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Vital Signs Excel import (Oracle IP_PATIENT_VITALS) ─────────────────────


@frappe.whitelist()
def start_ip_patient_vitals_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_patient_vitals_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_PATIENT_VITALS Excel file."))

	job = "ip_patient_vitals_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_vitals=summary.get("new_vitals"),
		existing_vitals=summary.get("existing_vitals"),
		resolved_admissions=summary.get("resolved_admissions"),
		patients_to_create=summary.get("patients_to_create"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_patient_vitals_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_patient_vitals_import",
	)
	return {
		"ok": True,
		"message": _(
			"Vital Signs IP_PATIENT_VITALS import started ({0} rows, {1} new)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_vitals") or 0,
		),
	}


def process_ip_patient_vitals_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_patient_vitals_import import run_ip_patient_vitals_import_batch

	job = "ip_patient_vitals_import"
	try:
		result = run_ip_patient_vitals_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			submitted=cint(prev.get("submitted", 0)) + cint(result.get("submitted", 0)),
			skip_no_admission=cint(prev.get("skip_no_admission", 0))
			+ cint(result.get("skip_no_admission", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0))
			+ cint(result.get("skip_no_patient", 0)),
			patients_created=cint(prev.get("patients_created", 0))
			+ cint(result.get("patients_created", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_vitals=prev.get("new_vitals"),
			existing_vitals=prev.get("existing_vitals"),
			resolved_admissions=prev.get("resolved_admissions"),
			patients_to_create=prev.get("patients_to_create"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_patient_vitals_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_patient_vitals_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Vital Signs import (IP_PATIENT_VITALS) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Observation Excel import (Oracle IP_OBSERVATION_LEVEL) ──────────────────


@frappe.whitelist()
def start_ip_observation_level_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_observation_level_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_OBSERVATION_LEVEL Excel file."))

	job = "ip_observation_level_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_observations=summary.get("new_observations"),
		existing_observations=summary.get("existing_observations"),
		resolved_admissions=summary.get("resolved_admissions"),
		unknown_obs_code_rows=summary.get("unknown_obs_code_rows"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_observation_level_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_observation_level_import",
	)
	return {
		"ok": True,
		"message": _(
			"Observation IP_OBSERVATION_LEVEL import started ({0} rows, {1} new)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_observations") or 0,
		),
	}


def process_ip_observation_level_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_observation_level_import import run_ip_observation_level_import_batch

	job = "ip_observation_level_import"
	try:
		result = run_ip_observation_level_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			submitted=cint(prev.get("submitted", 0)) + cint(result.get("submitted", 0)),
			skip_no_admission=cint(prev.get("skip_no_admission", 0))
			+ cint(result.get("skip_no_admission", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_observations=prev.get("new_observations"),
			existing_observations=prev.get("existing_observations"),
			resolved_admissions=prev.get("resolved_admissions"),
			unknown_obs_code_rows=prev.get("unknown_obs_code_rows"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_observation_level_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_observation_level_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Observation import (IP_OBSERVATION_LEVEL) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Morse Fall Scale Excel import (Oracle MORSE_FALL_SCALE_01) ──────────────


@frappe.whitelist()
def start_morse_fall_scale_excel_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.morse_fall_scale_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the MORSE_FALL_SCALE_01 Excel file."))

	job = "morse_fall_scale_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_scales=summary.get("new_scales"),
		existing_scales=summary.get("existing_scales"),
		resolved_admissions=summary.get("resolved_admissions"),
		patients_to_create=summary.get("patients_to_create"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_morse_fall_scale_excel_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_morse_fall_scale_import",
	)
	return {
		"ok": True,
		"message": _(
			"Morse Fall Scale MORSE_FALL_SCALE_01 import started ({0} rows, {1} new)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_scales") or 0,
		),
	}


def process_morse_fall_scale_excel_import_batch(offset: int = 0) -> None:
	from healthcare.api.morse_fall_scale_import import run_morse_fall_scale_import_batch

	job = "morse_fall_scale_import"
	try:
		result = run_morse_fall_scale_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_admission=cint(prev.get("skip_no_admission", 0))
			+ cint(result.get("skip_no_admission", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0))
			+ cint(result.get("skip_no_patient", 0)),
			skip_empty_details=cint(prev.get("skip_empty_details", 0))
			+ cint(result.get("skip_empty_details", 0)),
			patients_created=cint(prev.get("patients_created", 0))
			+ cint(result.get("patients_created", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_scales=prev.get("new_scales"),
			existing_scales=prev.get("existing_scales"),
			resolved_admissions=prev.get("resolved_admissions"),
			patients_to_create=prev.get("patients_to_create"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_morse_fall_scale_excel_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_morse_fall_scale_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Morse Fall Scale import (MORSE_FALL_SCALE_01) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Physical Examination Excel import (Oracle IP_ADMISSION_PHY_EXAM) ────────


@frappe.whitelist()
def start_ip_admission_phy_exam_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_admission_phy_exam_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_ADMISSION_PHY_EXAM Excel file."))

	job = "ip_admission_phy_exam_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_examinations=summary.get("new_examinations"),
		existing_examinations=summary.get("existing_examinations"),
		resolved_admissions=summary.get("resolved_admissions"),
		patients_to_create=summary.get("patients_to_create"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_admission_phy_exam_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_admission_phy_exam_import",
	)
	return {
		"ok": True,
		"message": _(
			"Physical Examination IP_ADMISSION_PHY_EXAM import started ({0} rows, {1} new)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_examinations") or 0,
		),
	}


def process_ip_admission_phy_exam_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_admission_phy_exam_import import run_ip_admission_phy_exam_import_batch

	job = "ip_admission_phy_exam_import"
	try:
		result = run_ip_admission_phy_exam_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_admission=cint(prev.get("skip_no_admission", 0))
			+ cint(result.get("skip_no_admission", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0))
			+ cint(result.get("skip_no_patient", 0)),
			patients_created=cint(prev.get("patients_created", 0))
			+ cint(result.get("patients_created", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_examinations=prev.get("new_examinations"),
			existing_examinations=prev.get("existing_examinations"),
			resolved_admissions=prev.get("resolved_admissions"),
			patients_to_create=prev.get("patients_to_create"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_admission_phy_exam_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_admission_phy_exam_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Physical Examination import (IP_ADMISSION_PHY_EXAM) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── IP Admission Transfer import (Oracle IP_ADMISSION_TRANSFER) ─────────────


@frappe.whitelist()
def start_ip_admission_transfer_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_admission_transfer_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_ADMISSION_TRANSFER Excel file."))

	job = "ip_admission_transfer_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_transfers=summary.get("new_transfers"),
		existing_transfers=summary.get("existing_transfers"),
		resolved_new_admissions=summary.get("resolved_new_admissions"),
		unresolved_new_admissions=summary.get("unresolved_new_admissions"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_admission_transfer_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_admission_transfer_import",
	)
	return {
		"ok": True,
		"message": _(
			"Admission Transfer IP_ADMISSION_TRANSFER import started ({0} rows, {1} new)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_transfers") or 0,
		),
	}


def process_ip_admission_transfer_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_admission_transfer_import import run_ip_admission_transfer_import_batch

	job = "ip_admission_transfer_import"
	try:
		result = run_ip_admission_transfer_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0))
			+ cint(result.get("skip_no_patient", 0)),
			skip_no_new_admission=cint(prev.get("skip_no_new_admission", 0))
			+ cint(result.get("skip_no_new_admission", 0)),
			skip_patient_mismatch=cint(prev.get("skip_patient_mismatch", 0))
			+ cint(result.get("skip_patient_mismatch", 0)),
			skip_no_cost_center=cint(prev.get("skip_no_cost_center", 0))
			+ cint(result.get("skip_no_cost_center", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_transfers=prev.get("new_transfers"),
			existing_transfers=prev.get("existing_transfers"),
			resolved_new_admissions=prev.get("resolved_new_admissions"),
			unresolved_new_admissions=prev.get("unresolved_new_admissions"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_admission_transfer_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_admission_transfer_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Admission Transfer import (IP_ADMISSION_TRANSFER) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Fall Risk Assessment Excel import (Oracle FALL_RISK_ASSESSMENT) ───────────


@frappe.whitelist()
def start_fall_risk_assessment_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.fall_risk_assessment_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the FALL_RISK_ASSESSMENT Excel file."))

	job = "fall_risk_assessment_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_assessments=summary.get("new_assessments"),
		existing_assessments=summary.get("existing_assessments"),
		resolved_admissions=summary.get("resolved_admissions"),
		unresolved_admissions=summary.get("unresolved_admissions"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_fall_risk_assessment_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_fall_risk_assessment_import",
	)
	return {
		"ok": True,
		"message": _(
			"Fall Risk Assessment FALL_RISK_ASSESSMENT import started ({0} rows, {1} new)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_assessments") or 0,
		),
	}


def process_fall_risk_assessment_import_batch(offset: int = 0) -> None:
	from healthcare.api.fall_risk_assessment_import import run_fall_risk_assessment_import_batch

	job = "fall_risk_assessment_import"
	try:
		result = run_fall_risk_assessment_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_admission=cint(prev.get("skip_no_admission", 0))
			+ cint(result.get("skip_no_admission", 0)),
			skip_no_trans_date=cint(prev.get("skip_no_trans_date", 0))
			+ cint(result.get("skip_no_trans_date", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_assessments=prev.get("new_assessments"),
			existing_assessments=prev.get("existing_assessments"),
			resolved_admissions=prev.get("resolved_admissions"),
			unresolved_admissions=prev.get("unresolved_admissions"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_fall_risk_assessment_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_fall_risk_assessment_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Fall Risk Assessment import (FALL_RISK_ASSESSMENT) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── IP Admission Transfer Balance import (Oracle IP_ADMISSION_TRANSFER_BAL) ──


@frappe.whitelist()
def start_ip_admission_transfer_bal_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_admission_transfer_bal_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_ADMISSION_TRANSFER_BAL Excel file."))

	job = "ip_admission_transfer_bal_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_transfers=summary.get("new_transfers"),
		existing_transfers=summary.get("existing_transfers"),
		resolved_new_admissions=summary.get("resolved_new_admissions"),
		unresolved_new_admissions=summary.get("unresolved_new_admissions"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_admission_transfer_bal_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_admission_transfer_bal_import",
	)
	return {
		"ok": True,
		"message": _(
			"Admission Transfer Balance IP_ADMISSION_TRANSFER_BAL import started ({0} rows, {1} new)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_transfers") or 0,
		),
	}


def process_ip_admission_transfer_bal_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_admission_transfer_bal_import import run_ip_admission_transfer_bal_import_batch

	job = "ip_admission_transfer_bal_import"
	try:
		result = run_ip_admission_transfer_bal_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0))
			+ cint(result.get("skip_no_patient", 0)),
			skip_no_new_admission=cint(prev.get("skip_no_new_admission", 0))
			+ cint(result.get("skip_no_new_admission", 0)),
			skip_patient_mismatch=cint(prev.get("skip_patient_mismatch", 0))
			+ cint(result.get("skip_patient_mismatch", 0)),
			skip_no_cost_center=cint(prev.get("skip_no_cost_center", 0))
			+ cint(result.get("skip_no_cost_center", 0)),
			skip_no_trans_date=cint(prev.get("skip_no_trans_date", 0))
			+ cint(result.get("skip_no_trans_date", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_transfers=prev.get("new_transfers"),
			existing_transfers=prev.get("existing_transfers"),
			resolved_new_admissions=prev.get("resolved_new_admissions"),
			unresolved_new_admissions=prev.get("unresolved_new_admissions"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_admission_transfer_bal_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_admission_transfer_bal_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Admission Transfer Balance import (IP_ADMISSION_TRANSFER_BAL) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_ip_admission_form_rules_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_admission_form_rules_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_ADMISSION_FORM_RULES Excel file."))

	job = "ip_admission_form_rules_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_rules=summary.get("new_rules"),
		existing_rules=summary.get("existing_rules"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_admission_form_rules_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_admission_form_rules_import",
	)
	return {
		"ok": True,
		"message": _(
			"Admission Form Rules IP_ADMISSION_FORM_RULES import started ({0} rows, {1} new)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_rules") or 0,
		),
	}


def process_ip_admission_form_rules_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_admission_form_rules_import import run_ip_admission_form_rules_import_batch

	job = "ip_admission_form_rules_import"
	try:
		result = run_ip_admission_form_rules_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_rules=prev.get("new_rules"),
			existing_rules=prev.get("existing_rules"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_admission_form_rules_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_admission_form_rules_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Admission Form Rules import (IP_ADMISSION_FORM_RULES) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_ip_admission_03_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_admission_03_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_ADMISSION_03 Excel file."))

	job = "ip_admission_03_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_services=summary.get("new_services"),
		existing_services=summary.get("existing_services"),
		resolved_admissions=summary.get("resolved_admissions"),
		unresolved_admissions=summary.get("unresolved_admissions"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_admission_03_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_admission_03_import",
	)
	return {
		"ok": True,
		"message": _(
			"IP Service 2 IP_ADMISSION_03 import started ({0} transactions, {1} new)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_services") or 0,
		),
	}


def process_ip_admission_03_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_admission_03_import import run_ip_admission_03_import_batch

	job = "ip_admission_03_import"
	try:
		result = run_ip_admission_03_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			submitted=cint(prev.get("submitted", 0)) + cint(result.get("submitted", 0)),
			skip_no_admission=cint(prev.get("skip_no_admission", 0))
			+ cint(result.get("skip_no_admission", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0))
			+ cint(result.get("skip_no_patient", 0)),
			skip_patient_mismatch=cint(prev.get("skip_patient_mismatch", 0))
			+ cint(result.get("skip_patient_mismatch", 0)),
			skip_no_lines=cint(prev.get("skip_no_lines", 0)) + cint(result.get("skip_no_lines", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_services=prev.get("new_services"),
			existing_services=prev.get("existing_services"),
			resolved_admissions=prev.get("resolved_admissions"),
			unresolved_admissions=prev.get("unresolved_admissions"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_admission_03_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_admission_03_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="IP Service 2 import (IP_ADMISSION_03) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_visit_positive_finding_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.visit_positive_finding_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the VISIT_POSITIVE_FINDING_01 Excel file."))

	job = "visit_positive_finding_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_findings=summary.get("new_findings"),
		existing_findings=summary.get("existing_findings"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_visit_positive_finding_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_visit_positive_finding_import",
	)
	return {
		"ok": True,
		"message": _(
			"Visit Positive Finding VISIT_POSITIVE_FINDING_01 import started ({0} rows, {1} new)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_findings") or 0,
		),
	}


def process_visit_positive_finding_import_batch(offset: int = 0) -> None:
	from healthcare.api.visit_positive_finding_import import run_visit_positive_finding_import_batch

	job = "visit_positive_finding_import"
	try:
		result = run_visit_positive_finding_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_findings=prev.get("new_findings"),
			existing_findings=prev.get("existing_findings"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_visit_positive_finding_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_visit_positive_finding_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Visit Positive Finding import (VISIT_POSITIVE_FINDING_01) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_ip_admission_02_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_admission_02_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_ADMISSION_02 Excel file."))

	job = "ip_admission_02_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_admissions=summary.get("admissions"),
		excel_rows=summary.get("excel_rows"),
		resolvable_admissions=summary.get("resolvable_admissions"),
		unresolved_admissions=summary.get("unresolved_admissions"),
		existing_histories=summary.get("existing_histories"),
		new_histories=summary.get("new_histories"),
		template=summary.get("template"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_admission_02_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_admission_02_import",
	)
	return {
		"ok": True,
		"message": _(
			"Patient History IP_ADMISSION_02 import started ({0} admissions, {1} new histories)."
		).format(
			summary.get("admissions") or 0,
			summary.get("new_histories") or 0,
		),
	}


def process_ip_admission_02_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_admission_02_import import run_ip_admission_02_import_batch

	job = "ip_admission_02_import"
	try:
		result = run_ip_admission_02_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		stats = result.get("stats") or {}
		prev_stats = prev.get("stats") or {}
		merged_stats = {
			"created": cint(prev_stats.get("created", 0)) + cint(stats.get("created", 0)),
			"updated": cint(prev_stats.get("updated", 0)) + cint(stats.get("updated", 0)),
			"skipped_lines": cint(prev_stats.get("skipped_lines", 0))
			+ cint(stats.get("skipped_lines", 0)),
			"unresolved_groups": cint(prev_stats.get("unresolved_groups", 0))
			+ cint(stats.get("unresolved_groups", 0)),
			"dates_set": cint(prev_stats.get("dates_set", 0)) + cint(stats.get("dates_set", 0)),
		}
		_set_progress(
			job,
			processed,
			total_admissions=result.get("total_admissions") or prev.get("total_admissions"),
			stats=merged_stats,
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors_in_batch", 0)),
			excel_rows=prev.get("excel_rows"),
			resolvable_admissions=prev.get("resolvable_admissions"),
			unresolved_admissions=prev.get("unresolved_admissions"),
			existing_histories=prev.get("existing_histories"),
			new_histories=prev.get("new_histories"),
			template=prev.get("template"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_admission_02_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_admission_02_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True, stats=merged_stats)
			_release_lock(job)
			frappe.log_error(
				title="Patient History import (IP_ADMISSION_02) complete",
				message=frappe.as_json(merged_stats),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_ip_risk_analysis_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_risk_analysis_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_RISK_ANALYSIS Excel file."))

	job = "ip_risk_analysis_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_analyses=summary.get("new_analyses"),
		existing_analyses=summary.get("existing_analyses"),
		resolved_admissions=summary.get("resolved_admissions"),
		unresolved_admissions=summary.get("unresolved_admissions"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_risk_analysis_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_risk_analysis_import",
	)
	return {
		"ok": True,
		"message": _(
			"IP Risk Analysis IP_RISK_ANALYSIS import started ({0} admissions, {1} new)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_analyses") or 0,
		),
	}


def process_ip_risk_analysis_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_risk_analysis_import import run_ip_risk_analysis_import_batch

	job = "ip_risk_analysis_import"
	try:
		result = run_ip_risk_analysis_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_admission=cint(prev.get("skip_no_admission", 0))
			+ cint(result.get("skip_no_admission", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_analyses=prev.get("new_analyses"),
			existing_analyses=prev.get("existing_analyses"),
			resolved_admissions=prev.get("resolved_admissions"),
			unresolved_admissions=prev.get("unresolved_admissions"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_risk_analysis_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_risk_analysis_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="IP Risk Analysis import (IP_RISK_ANALYSIS) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_main_nursing_note_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.main_nursing_note_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the nursing Excel file."))

	job = "main_nursing_note_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_notes=summary.get("new_notes"),
		existing_notes=summary.get("existing_notes"),
		resolved_admissions=summary.get("resolved_admissions"),
		unresolved_admissions=summary.get("unresolved_admissions"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_main_nursing_note_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_main_nursing_note_import",
	)
	return {
		"ok": True,
		"message": _(
			"Main Nursing Note import started ({0} rows, {1} new)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_notes") or 0,
		),
	}


def process_main_nursing_note_import_batch(offset: int = 0) -> None:
	from healthcare.api.main_nursing_note_import import run_main_nursing_note_import_batch

	job = "main_nursing_note_import"
	try:
		result = run_main_nursing_note_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_admission=cint(prev.get("skip_no_admission", 0))
			+ cint(result.get("skip_no_admission", 0)),
			skip_no_notes=cint(prev.get("skip_no_notes", 0)) + cint(result.get("skip_no_notes", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_notes=prev.get("new_notes"),
			existing_notes=prev.get("existing_notes"),
			resolved_admissions=prev.get("resolved_admissions"),
			unresolved_admissions=prev.get("unresolved_admissions"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_main_nursing_note_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_main_nursing_note_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Main Nursing Note import (nursing) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Clinical Note Excel import (Oracle IP_ADMISSION_DIAGNOSES) ────────────────


@frappe.whitelist()
def start_ip_admission_clinical_note_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_admission_clinical_note_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_ADMISSION_DIAGNOSES Excel file."))

	job = "ip_admission_clinical_note_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_notes=summary.get("new_notes"),
		existing_notes=summary.get("existing_notes"),
		resolved_admissions=summary.get("resolved_admissions"),
		unresolved_admissions=summary.get("unresolved_admissions"),
		skip_no_note=summary.get("skip_no_note"),
		mapped_note_types=summary.get("mapped_note_types"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_admission_clinical_note_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_admission_clinical_note_import",
	)
	return {
		"ok": True,
		"message": _(
			"Clinical Note IP_ADMISSION_DIAGNOSES import started ({0} rows, {1} new, {2} admissions resolved)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_notes") or 0,
			summary.get("resolved_admissions") or 0,
		),
	}


def process_ip_admission_clinical_note_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_admission_clinical_note_import import run_ip_admission_clinical_note_import_batch

	job = "ip_admission_clinical_note_import"
	try:
		result = run_ip_admission_clinical_note_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_no_note=cint(prev.get("skip_no_note", 0)) + cint(result.get("skip_no_note", 0)),
			admissions_resolved=cint(prev.get("admissions_resolved", 0))
			+ cint(result.get("admissions_resolved", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_notes=prev.get("new_notes"),
			existing_notes=prev.get("existing_notes"),
			resolved_admissions=prev.get("resolved_admissions"),
			unresolved_admissions=prev.get("unresolved_admissions"),
			mapped_note_types=prev.get("mapped_note_types"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_admission_clinical_note_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_admission_clinical_note_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Clinical Note import (IP_ADMISSION_DIAGNOSES) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Warning Message Excel import (Oracle PATIENT_WARNING_MESSAGES) ────────────


@frappe.whitelist()
def start_patient_warning_message_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.patient_warning_message_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the PATIENT_WARNING_MESSAGES Excel file."))

	job = "patient_warning_message_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_warnings=summary.get("new_warnings"),
		existing_warnings=summary.get("existing_warnings"),
		resolved_patients=summary.get("resolved_patients"),
		unresolved_patients=summary.get("unresolved_patients"),
		organisation_rows=summary.get("organisation_rows"),
		empty_warning_rows=summary.get("empty_warning_rows"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_warning_message_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_warning_message_import",
	)
	return {
		"ok": True,
		"message": _(
			"Warning Message import started ({0} rows, {1} new, {2} patients resolved)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_warnings") or 0,
			summary.get("resolved_patients") or 0,
		),
	}


def process_patient_warning_message_import_batch(offset: int = 0) -> None:
	from healthcare.api.patient_warning_message_import import run_patient_warning_message_import_batch

	job = "patient_warning_message_import"
	try:
		result = run_patient_warning_message_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_warnings=prev.get("new_warnings"),
			existing_warnings=prev.get("existing_warnings"),
			resolved_patients=prev.get("resolved_patients"),
			unresolved_patients=prev.get("unresolved_patients"),
			organisation_rows=prev.get("organisation_rows"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_warning_message_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_warning_message_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Warning Message import (PATIENT_WARNING_MESSAGES) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Patient Medical Report Excel import (Oracle PATIENT_MEDICAL_REPORT_01) ────


@frappe.whitelist()
def start_patient_medical_report_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.patient_medical_report_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the PATIENT_MEDICAL_REPORT_01 Excel file."))

	job = "patient_medical_report_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		existing_records=summary.get("existing_records"),
		resolved_patients=summary.get("resolved_patients"),
		resolved_admissions=summary.get("resolved_admissions"),
		resolved_visits=summary.get("resolved_visits"),
		with_report_text=summary.get("with_report_text"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_medical_report_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_medical_report_import",
	)
	return {
		"ok": True,
		"message": _(
			"Patient Medical Report import started ({0} rows, {1} patients resolved)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("resolved_patients") or 0,
		),
	}


def process_patient_medical_report_import_batch(offset: int = 0) -> None:
	from healthcare.api.patient_medical_report_import import run_patient_medical_report_import_batch

	job = "patient_medical_report_import"
	try:
		result = run_patient_medical_report_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			existing_records=prev.get("existing_records"),
			resolved_patients=prev.get("resolved_patients"),
			resolved_admissions=prev.get("resolved_admissions"),
			resolved_visits=prev.get("resolved_visits"),
			with_report_text=prev.get("with_report_text"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_medical_report_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_medical_report_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Patient Medical Report import (PATIENT_MEDICAL_REPORT_01) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Patient Visit Prescription HIS import (Oracle PATIENT_VISIT_PRESCRIPTION_HIS) ─


@frappe.whitelist()
def start_patient_visit_prescription_his_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.patient_visit_prescription_his_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the PATIENT_VISIT_PRESCRIPTION_HIS Excel file."))

	job = "patient_visit_prescription_his_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_visits=summary.get("visits"),
		medicine_lines=summary.get("medicine_lines"),
		existing_records=summary.get("existing_records"),
		resolvable_patients=summary.get("resolvable_patients"),
		resolvable_visits=summary.get("resolvable_visits"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_visit_prescription_his_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_visit_prescription_his_import",
	)
	return {
		"ok": True,
		"message": _(
			"Patient Medication Order (OP visit) import started ({0} visits, {1} medicine lines)."
		).format(
			summary.get("visits") or 0,
			summary.get("medicine_lines") or 0,
		),
	}


def _progress_snapshot(job: str) -> dict:
	"""Counters accumulated so far, safe to carry into a fresh _set_progress payload."""
	prev = frappe.cache().get_value(_job_progress_key(job)) or {}
	skip = (
		"processed",
		"done",
		"error",
		"updated_at",
		"incomplete",
		# Set only on the final write; carrying them over would duplicate the kwarg.
		"duplicates_remaining",
		"line_duplicates_remaining",
		"groups_remaining",
		"extra_copies_remaining",
	)
	return {
		key: value
		for key, value in prev.items()
		if key not in skip and not key.startswith("verified_")
	}


def _fail_legacy_visit_import(job: str, processed: int, message: str) -> None:
	"""Abort loudly instead of silently reporting a short run as complete."""
	_set_progress(job, cint(processed), done=True, error=message, incomplete=1, **_progress_snapshot(job))
	_release_lock(job)
	frappe.log_error(title=f"{job}: import aborted", message=message)
	raise frappe.ValidationError(message)


def _verify_and_finish_legacy_visit_import(job: str, processed: int, verify) -> None:
	"""Confirm every queued visit now has a prescription before reporting success."""
	verification = verify() or {}
	missing = cint(verification.get("missing", 0))
	queued = cint(verification.get("queued", 0))
	if missing:
		_fail_legacy_visit_import(
			job,
			processed,
			_(
				"{0} stopped short: {1} of {2} queued visits still have no Patient Medication Order. "
				"Re-run the job to import the remaining visits. Sample: {3}"
			).format(
				job,
				missing,
				queued,
				", ".join(str(value) for value in (verification.get("sample_missing") or [])[:10])
				or "-",
			),
		)
	_set_progress(
		job,
		cint(processed),
		done=True,
		verified_visited=queued,
		verified_missing=0,
		**_progress_snapshot(job),
	)
	_release_lock(job)
	frappe.log_error(
		title=f"{job}: complete ({queued} visits verified)",
		message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
	)


def process_patient_visit_prescription_his_import_batch(offset: int = 0) -> None:
	from healthcare.api.patient_visit_prescription_his_import import (
		_verify_queue_coverage,
		run_patient_visit_prescription_his_import_batch,
	)

	job = "patient_visit_prescription_his_import"
	try:
		result = run_patient_visit_prescription_his_import_batch(offset=offset)
		if result.get("error"):
			_fail_legacy_visit_import(job, cint(result.get("processed", offset)), result["error"])
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skipped=cint(prev.get("skipped", 0)) + cint(result.get("skipped", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			lines_imported=cint(prev.get("lines_imported", 0)) + cint(result.get("lines_imported", 0)),
			total_visits=prev.get("total_visits") or result.get("total"),
			medicine_lines=prev.get("medicine_lines"),
			existing_records=prev.get("existing_records"),
			resolvable_patients=prev.get("resolvable_patients"),
			resolvable_visits=prev.get("resolvable_visits"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_visit_prescription_his_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_visit_prescription_his_import_{processed}",
			)
		else:
			_verify_and_finish_legacy_visit_import(job, processed, _verify_queue_coverage)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Patient Visit Prescription import (Oracle PATIENT_VISIT_PRESCRIPTION) ─────


@frappe.whitelist()
def start_patient_visit_prescription_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.patient_visit_prescription_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the PATIENT_VISIT_PRESCRIPTION Excel file."))

	job = "patient_visit_prescription_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_visits=summary.get("visits"),
		medicine_lines=summary.get("medicine_lines"),
		existing_records=summary.get("existing_records"),
		resolvable_patients=summary.get("resolvable_patients"),
		resolvable_visits=summary.get("resolvable_visits"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_visit_prescription_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_visit_prescription_import",
	)
	return {
		"ok": True,
		"message": _(
			"Patient Medication Order (PATIENT_VISIT_PRESCRIPTION) import started ({0} visits, {1} medicine lines)."
		).format(
			summary.get("visits") or 0,
			summary.get("medicine_lines") or 0,
		),
	}


def process_patient_visit_prescription_import_batch(offset: int = 0) -> None:
	from healthcare.api.patient_visit_prescription_import import (
		_verify_queue_coverage,
		run_patient_visit_prescription_import_batch,
	)

	job = "patient_visit_prescription_import"
	try:
		result = run_patient_visit_prescription_import_batch(offset=offset)
		if result.get("error"):
			_fail_legacy_visit_import(job, cint(result.get("processed", offset)), result["error"])
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skipped=cint(prev.get("skipped", 0)) + cint(result.get("skipped", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			lines_imported=cint(prev.get("lines_imported", 0)) + cint(result.get("lines_imported", 0)),
			total_visits=prev.get("total_visits") or result.get("total"),
			medicine_lines=prev.get("medicine_lines"),
			existing_records=prev.get("existing_records"),
			resolvable_patients=prev.get("resolvable_patients"),
			resolvable_visits=prev.get("resolvable_visits"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_visit_prescription_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_visit_prescription_import_{processed}",
			)
		else:
			_verify_and_finish_legacy_visit_import(job, processed, _verify_queue_coverage)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── OP prescription repair (duplicate PATIENT_VISIT_PRESCRIPTION / _HIS PMOs) ─


def process_op_prescription_duplicate_cleanup_batch(offset: int = 0) -> None:
	from healthcare.api.op_prescription_repair import DEDUPE_JOB, run_duplicate_cleanup_batch

	job = DEDUPE_JOB
	try:
		result = run_duplicate_cleanup_batch(offset=offset)
		if result.get("error"):
			_fail_legacy_visit_import(job, cint(result.get("processed", offset)), result["error"])
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			removed=cint(prev.get("removed", 0)) + cint(result.get("removed", 0)),
			skipped=cint(prev.get("skipped", 0)) + cint(result.get("skipped", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_duplicates=prev.get("total_duplicates") or result.get("total"),
			keep_rule=prev.get("keep_rule"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_op_prescription_duplicate_cleanup_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_op_prescription_duplicate_cleanup_{processed}",
			)
		else:
			remaining = 0
			try:
				from healthcare.api.patient_visit_prescription_common import (
					duplicate_legacy_visit_pmos,
				)

				remaining = cint(duplicate_legacy_visit_pmos().get("duplicate_groups"))
			except Exception:
				frappe.log_error(title=f"{job}: duplicate recount failed")
			_set_progress(
				job,
				processed,
				done=True,
				duplicates_remaining=remaining,
				**_progress_snapshot(job),
			)
			_release_lock(job)
			frappe.log_error(
				title="OP prescription duplicate cleanup complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Clinical Note duplicate merge (one transaction, one note) ──

CLINICAL_NOTE_DUPLICATE_JOB = "clinical_note_duplicate_cleanup"


@frappe.whitelist()
def start_clinical_note_duplicate_cleanup_migration(
	scope: str = "visits",
	include_legacy_inpatient=0,
	match_posting_time=1,
	dry_run=0,
	batch_size: int = 500,
) -> dict:
	"""Merge identical Clinical Notes of one transaction (Healthcare Settings button)."""
	_require_admin()
	from healthcare.api.clinical_note_duplicate_cleanup import (
		SCOPES,
		_extra_copies,
		_group_count,
	)

	job = CLINICAL_NOTE_DUPLICATE_JOB
	if scope not in SCOPES:
		frappe.throw(_("Unknown scope {0}; expected one of {1}.").format(scope, ", ".join(SCOPES)))

	_acquire_lock(job)
	groups = _group_count(scope)
	extras = _extra_copies(scope)
	_set_progress(
		job,
		0,
		scope=scope,
		dry_run=cint(dry_run),
		include_legacy_inpatient=cint(include_legacy_inpatient),
		match_posting_time=cint(match_posting_time),
		batch_size=max(cint(batch_size), 1),
		groups_total=groups,
		extra_copies_total=extras,
		groups_scanned=0,
		groups_merged=0,
		notes_deleted=0,
		skipped_inpatient_legacy=0,
		skipped_locked=0,
		skipped_attachment=0,
		skipped_variance=0,
		skipped_submitted=0,
		errors=0,
		last_signature=None,
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_clinical_note_duplicate_cleanup_batch",
		queue="long",
		timeout=3600,
		job_name="healthcare_clinical_note_duplicate_cleanup_0",
	)
	return {
		"ok": True,
		"job": job,
		"groups_total": groups,
		"extra_copies_total": extras,
		"message": _(
			"Clinical note duplicate merge started: {0} group(s), {1} extra copy(ies){2}."
		).format(groups, extras, _(" (dry run)") if cint(dry_run) else ""),
	}


def _duplicate_job_config(prev: dict) -> dict:
	"""Run settings that every batch must inherit from the progress record."""
	return {
		"scope": prev.get("scope") or "visits",
		"dry_run": cint(prev.get("dry_run")),
		"include_legacy_inpatient": cint(prev.get("include_legacy_inpatient")),
		"match_posting_time": cint(prev.get("match_posting_time")),
		"batch_size": cint(prev.get("batch_size")) or 500,
		"groups_total": prev.get("groups_total"),
		"extra_copies_total": prev.get("extra_copies_total"),
	}


def process_clinical_note_duplicate_cleanup_batch() -> None:
	from healthcare.api.clinical_note_duplicate_cleanup import run_cleanup_batch

	job = CLINICAL_NOTE_DUPLICATE_JOB
	prev = frappe.cache().get_value(_job_progress_key(job)) or {}
	config = _duplicate_job_config(prev)
	processed = cint(prev.get("processed"))
	try:
		if _stop_requested(job):
			_set_progress(job, processed, done=True, stopped=True, stop_requested=True, **config)
			_release_lock(job)
			return

		result = run_cleanup_batch(
			offset=processed,
			after_signature=prev.get("last_signature"),
			batch_size=config["batch_size"],
			scope=config["scope"],
			include_legacy_inpatient=config["include_legacy_inpatient"],
			match_posting_time=config["match_posting_time"],
			dry_run=config["dry_run"],
		)
		processed = cint(result.get("processed"))
		_renew_lock(job)
		_set_progress(
			job,
			processed,
			last_signature=result.get("last_signature"),
			groups_scanned=cint(prev.get("groups_scanned")) + cint(result.get("groups_scanned")),
			groups_merged=cint(prev.get("groups_merged")) + cint(result.get("groups_merged")),
			notes_deleted=cint(prev.get("notes_deleted")) + cint(result.get("notes_deleted")),
			skipped_inpatient_legacy=cint(prev.get("skipped_inpatient_legacy"))
			+ cint(result.get("skipped_inpatient_legacy")),
			skipped_locked=cint(prev.get("skipped_locked")) + cint(result.get("skipped_locked")),
			skipped_attachment=cint(prev.get("skipped_attachment"))
			+ cint(result.get("skipped_attachment")),
			skipped_variance=cint(prev.get("skipped_variance")) + cint(result.get("skipped_variance")),
			skipped_submitted=cint(prev.get("skipped_submitted"))
			+ cint(result.get("skipped_submitted")),
			errors=cint(prev.get("errors")) + cint(result.get("errors")),
			**config,
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_clinical_note_duplicate_cleanup_batch",
				queue="long",
				timeout=3600,
				job_name=f"healthcare_clinical_note_duplicate_cleanup_{processed}",
			)
			return

		from healthcare.api.clinical_note_duplicate_cleanup import _extra_copies, _group_count

		_set_progress(
			job,
			processed,
			done=True,
			groups_remaining=_group_count(config["scope"]),
			extra_copies_remaining=_extra_copies(config["scope"]),
			**_progress_snapshot(job),
		)
		_release_lock(job)
		frappe.log_error(
			title="Clinical note duplicate merge complete",
			message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
		)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, processed, done=True, error=frappe.get_traceback(), **config)
		_release_lock(job)
		raise


def process_op_prescription_line_cleanup_batch(offset: int = 0) -> None:
	from healthcare.api.op_prescription_repair import (
		LINE_CLEANUP_JOB,
		line_duplicate_summary,
		run_line_cleanup_batch,
	)

	job = LINE_CLEANUP_JOB
	try:
		result = run_line_cleanup_batch(offset=offset)
		if result.get("error"):
			_fail_legacy_visit_import(job, cint(result.get("processed", offset)), result["error"])
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = cint(prev.get("processed", 0)) + cint(result.get("batch_count", 0))
		counters = {
			"visits_cleaned": cint(prev.get("visits_cleaned", 0))
			+ cint(result.get("visits_cleaned", 0)),
			"lines_removed": cint(prev.get("lines_removed", 0))
			+ cint(result.get("lines_removed", 0)),
			"skipped": cint(prev.get("skipped", 0)) + cint(result.get("skipped", 0)),
			"errors": cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
		}
		_set_progress(
			job,
			processed,
			total_visits=prev.get("total_visits"),
			total_lines=prev.get("total_lines"),
			lines_expected=prev.get("lines_expected"),
			**counters,
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_op_prescription_line_cleanup_batch",
				offset=0,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_op_prescription_line_cleanup_{processed}",
			)
		else:
			remaining = line_duplicate_summary()
			_set_progress(
				job,
				processed,
				done=True,
				line_duplicates_remaining=cint(remaining.get("repeated_lines")),
				**_progress_snapshot(job),
			)
			_release_lock(job)
			frappe.log_error(
				title="OP prescription line cleanup complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── IP Patient Relatives Excel import (Oracle IP_PATIENT_RELATIVES) ───────────

@frappe.whitelist()
def start_ip_patient_relatives_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_patient_relatives_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_PATIENT_RELATIVES Excel file."))

	job = "ip_patient_relatives_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_admissions=summary.get("admissions"),
		relative_lines=summary.get("relative_lines"),
		resolvable_admissions=summary.get("resolvable_admissions"),
		unresolved_admissions=summary.get("unresolved_admissions"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_patient_relatives_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_patient_relatives_import",
	)
	return {
		"ok": True,
		"message": _(
			"IP Patient Relatives import started ({0} relative lines across {1} admissions, {2} admissions resolved)."
		).format(
			summary.get("relative_lines") or 0,
			summary.get("admissions") or 0,
			summary.get("resolvable_admissions") or 0,
		),
	}


def process_ip_patient_relatives_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_patient_relatives_import import run_ip_patient_relatives_import_batch

	job = "ip_patient_relatives_import"
	try:
		result = run_ip_patient_relatives_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			ok=cint(prev.get("ok", 0)) + cint(result.get("ok", 0)),
			skip_no_admission=cint(prev.get("skip_no_admission", 0))
			+ cint(result.get("skip_no_admission", 0)),
			skip_no_lines=cint(prev.get("skip_no_lines", 0)) + cint(result.get("skip_no_lines", 0)),
			relatives_added=cint(prev.get("relatives_added", 0)) + cint(result.get("relatives_added", 0)),
			relatives_updated=cint(prev.get("relatives_updated", 0))
			+ cint(result.get("relatives_updated", 0)),
			relatives_skipped=cint(prev.get("relatives_skipped", 0))
			+ cint(result.get("relatives_skipped", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_admissions=prev.get("total_admissions"),
			relative_lines=prev.get("relative_lines"),
			resolvable_admissions=prev.get("resolvable_admissions"),
			unresolved_admissions=prev.get("unresolved_admissions"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_patient_relatives_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_patient_relatives_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="IP Patient Relatives import (IP_PATIENT_RELATIVES) complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_visit_00_01_history_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.visit_00_01_history_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the VISIT_00_01_HISTORY Excel file."))

	job = "visit_00_01_history_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		existing_records=summary.get("existing_records"),
		resolved_patients=summary.get("resolved_patients"),
		resolved_visits=summary.get("resolved_visits"),
		with_diagnosis=summary.get("with_diagnosis"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_visit_00_01_history_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_visit_00_01_history_import",
	)
	return {
		"ok": True,
		"message": _(
			"VISIT_00_01_HISTORY import started ({0} rows, {1} patients resolved)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("resolved_patients") or 0,
		),
	}


def process_visit_00_01_history_import_batch(offset: int = 0) -> None:
	from healthcare.api.visit_00_01_history_import import run_visit_00_01_history_import_batch

	job = "visit_00_01_history_import"
	try:
		result = run_visit_00_01_history_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			existing_records=prev.get("existing_records"),
			resolved_patients=prev.get("resolved_patients"),
			resolved_visits=prev.get("resolved_visits"),
			with_diagnosis=prev.get("with_diagnosis"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_visit_00_01_history_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_visit_00_01_history_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="VISIT_00_01_HISTORY import complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_visit_00_05_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.visit_00_05_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the VISIT_00_05 Excel file."))

	job = "visit_00_05_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		existing_records=summary.get("existing_records"),
		resolved_patients=summary.get("resolved_patients"),
		resolved_visits=summary.get("resolved_visits"),
		resolved_templates=summary.get("resolved_templates"),
		with_doc_remarks=summary.get("with_doc_remarks"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_visit_00_05_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_visit_00_05_import",
	)
	return {
		"ok": True,
		"message": _(
			"VISIT_00_05 Session Schedule import started ({0} rows, {1} with session notes)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("with_doc_remarks") or 0,
		),
	}


def process_visit_00_05_import_batch(offset: int = 0) -> None:
	from healthcare.api.visit_00_05_import import run_visit_00_05_import_batch

	job = "visit_00_05_import"
	try:
		result = run_visit_00_05_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skipped=cint(prev.get("skipped", 0)) + cint(result.get("skipped", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			existing_records=prev.get("existing_records"),
			resolved_patients=prev.get("resolved_patients"),
			resolved_visits=prev.get("resolved_visits"),
			resolved_templates=prev.get("resolved_templates"),
			with_doc_remarks=prev.get("with_doc_remarks"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_visit_00_05_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_visit_00_05_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="VISIT_00_05 Session Schedule import complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_visit_complain_01_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.visit_complain_01_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the VISIT_COMPLAIN_01 Excel file."))

	job = "visit_complain_01_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		new_records=summary.get("new_records"),
		existing_records=summary.get("existing_records"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_visit_complain_01_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_visit_complain_01_import",
	)
	return {
		"ok": True,
		"message": _(
			"VISIT_COMPLAIN_01 import started ({0} rows, {1} new)."
		).format(
			summary.get("excel_rows") or 0,
			summary.get("new_records") or 0,
		),
	}


def process_visit_complain_01_import_batch(offset: int = 0) -> None:
	from healthcare.api.visit_complain_01_import import run_visit_complain_01_import_batch

	job = "visit_complain_01_import"
	try:
		result = run_visit_complain_01_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			new_records=prev.get("new_records"),
			existing_records=prev.get("existing_records"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_visit_complain_01_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_visit_complain_01_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="VISIT_COMPLAIN_01 import complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_ect_details_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ect_details_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the ECT_00_01 Excel file."))

	job = "ect_details_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		existing_records=summary.get("existing_records"),
		resolved_patients=summary.get("resolved_patients"),
		resolved_admissions=summary.get("resolved_admissions"),
		resolved_visits=summary.get("resolved_visits"),
		resolved_practitioners=summary.get("resolved_practitioners"),
		op_rows=summary.get("op_rows"),
		ip_rows=summary.get("ip_rows"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ect_details_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ect_details_import",
	)
	return {
		"ok": True,
		"message": _("ECT Details import started ({0} rows, {1} existing).").format(
			summary.get("excel_rows") or 0,
			summary.get("existing_records") or 0,
		),
	}


def process_ect_details_import_batch(offset: int = 0) -> None:
	from healthcare.api.ect_details_import import run_ect_details_import_batch

	job = "ect_details_import"
	try:
		result = run_ect_details_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skipped=cint(prev.get("skipped", 0)) + cint(result.get("skipped", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			existing_records=prev.get("existing_records"),
			resolved_patients=prev.get("resolved_patients"),
			resolved_admissions=prev.get("resolved_admissions"),
			resolved_visits=prev.get("resolved_visits"),
			resolved_practitioners=prev.get("resolved_practitioners"),
			op_rows=prev.get("op_rows"),
			ip_rows=prev.get("ip_rows"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ect_details_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ect_details_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="ECT Details import complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_ect_details_attribute_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ect_details_attribute_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the ECT_00_02 Excel file."))

	job = "ect_details_attribute_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		parents=summary.get("parents"),
		existing_parents=summary.get("existing_parents"),
		missing_parents=summary.get("missing_parents"),
		matching_template_rows=summary.get("matching_template_rows"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ect_details_attribute_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ect_details_attribute_import",
	)
	return {
		"ok": True,
		"message": _("ECT Details Attribute import started ({0} rows, {1} parent records).").format(
			summary.get("excel_rows") or 0,
			summary.get("parents") or 0,
		),
	}


def process_ect_details_attribute_import_batch(offset: int = 0) -> None:
	from healthcare.api.ect_details_attribute_import import run_ect_details_attribute_import_batch

	job = "ect_details_attribute_import"
	try:
		result = run_ect_details_attribute_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skipped=cint(prev.get("skipped", 0)) + cint(result.get("skipped", 0)),
			appended_rows=cint(prev.get("appended_rows", 0)) + cint(result.get("appended_rows", 0)),
			updated_rows=cint(prev.get("updated_rows", 0)) + cint(result.get("updated_rows", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			parents=prev.get("parents"),
			existing_parents=prev.get("existing_parents"),
			missing_parents=prev.get("missing_parents"),
			matching_template_rows=prev.get("matching_template_rows"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ect_details_attribute_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ect_details_attribute_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="ECT Details Attribute import complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_ect_details_to_procedure_transfer() -> dict:
	"""Transfer every ECT Details row into an ECT Procedure (batched, idempotent)."""
	_require_admin()
	from healthcare.api.ect_details_to_procedure import preview_ect_details_to_procedure_transfer

	job = "ect_details_to_procedure_transfer"
	_acquire_lock(job)

	preview = preview_ect_details_to_procedure_transfer()
	_set_progress(
		job,
		0,
		total_records=preview.get("total_details"),
		already_transferred=preview.get("already_transferred"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ect_details_to_procedure_transfer_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ect_details_to_procedure_transfer",
	)
	return {
		"ok": True,
		"message": _("ECT Details → ECT Procedure transfer started ({0} ECT Details, {1} already transferred).").format(
			preview.get("total_details") or 0,
			preview.get("already_transferred") or 0,
		),
	}


def process_ect_details_to_procedure_transfer_batch(offset: int = 0) -> None:
	from healthcare.api.ect_details_to_procedure import run_ect_details_to_procedure_transfer_batch

	job = "ect_details_to_procedure_transfer"
	try:
		result = run_ect_details_to_procedure_transfer_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		merged = {
			"created": cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			"updated": cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			"skipped": cint(prev.get("skipped", 0)) + cint(result.get("skipped", 0)),
			"errors": cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			"total_records": prev.get("total_records"),
			"already_transferred": prev.get("already_transferred"),
		}
		_set_progress(job, processed, **merged)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ect_details_to_procedure_transfer_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ect_details_to_procedure_transfer_{processed}",
			)
		else:
			_set_progress(job, processed, done=True, **merged)
			_release_lock(job)
			frappe.log_error(
				title="ECT Details → ECT Procedure transfer complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_ip_grooming_chart_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.ip_grooming_chart_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_GROOMING_CHART Excel file."))

	job = "ip_grooming_chart_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		existing_records=summary.get("existing_records"),
		new_records=summary.get("new_records"),
		resolved_admissions=summary.get("resolved_admissions"),
		skip_no_admission=summary.get("skip_no_admission"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_ip_grooming_chart_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_ip_grooming_chart_import",
	)
	return {
		"ok": True,
		"message": _("IP Grooming Chart import started ({0} rows, {1} existing).").format(
			summary.get("excel_rows") or 0,
			summary.get("existing_records") or 0,
		),
	}


def process_ip_grooming_chart_import_batch(offset: int = 0) -> None:
	from healthcare.api.ip_grooming_chart_import import run_ip_grooming_chart_import_batch

	job = "ip_grooming_chart_import"
	try:
		result = run_ip_grooming_chart_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skipped=cint(prev.get("skipped", 0)) + cint(result.get("skipped", 0)),
			skip_no_admission=cint(prev.get("skip_no_admission", 0)) + cint(result.get("skip_no_admission", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0)) + cint(result.get("skip_no_patient", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			existing_records=prev.get("existing_records"),
			new_records=prev.get("new_records"),
			resolved_admissions=prev.get("resolved_admissions"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_ip_grooming_chart_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_ip_grooming_chart_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="IP Grooming Chart import complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


@frappe.whitelist()
def start_sleeping_pattern_import_migration(file_url: str) -> dict:
	_require_admin()
	from healthcare.api.sleeping_pattern_import import parse_and_cache_excel

	if not (file_url or "").strip():
		frappe.throw(_("Please upload the IP_SLEEPING_PATTERN Excel file."))

	job = "sleeping_pattern_import"
	_acquire_lock(job)
	summary = parse_and_cache_excel(file_url)
	_set_progress(
		job,
		0,
		total_rows=summary.get("excel_rows"),
		existing_records=summary.get("existing_records"),
		new_records=summary.get("new_records"),
		resolved_admissions=summary.get("resolved_admissions"),
		skip_no_admission=summary.get("skip_no_admission"),
		skip_no_patient=summary.get("skip_no_patient"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_sleeping_pattern_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_sleeping_pattern_import",
	)
	return {
		"ok": True,
		"message": _("Sleeping Pattern import started ({0} rows, {1} existing).").format(
			summary.get("excel_rows") or 0,
			summary.get("existing_records") or 0,
		),
	}


# ── Patient CPR photo folder import ───────────────────────────────────────────


@frappe.whitelist()
def start_patient_cpr_photo_import_migration(items=None, replace_existing=1) -> dict:
	"""Import CPR front/back images uploaded from a local folder."""
	_require_admin()
	from healthcare.api.patient_cpr_photo_import import cache_import_items

	if isinstance(items, str):
		import json

		items = json.loads(items) if items.strip() else []
	if not isinstance(items, list) or not items:
		frappe.throw(_("No uploaded images to import."))

	job = "patient_cpr_photo_import"
	_acquire_lock(job)
	summary = cache_import_items(items, replace_existing=cint(replace_existing))
	total_items = (summary.get("front_images") or 0) + (summary.get("back_images") or 0)
	_set_progress(
		job,
		0,
		total_items=total_items,
		front_images=summary.get("front_images"),
		back_images=summary.get("back_images"),
		patients_found=summary.get("patients_found"),
		patients_missing=summary.get("patients_missing"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_cpr_photo_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_cpr_photo_import",
	)
	return {
		"ok": True,
		"message": _(
			"CPR photo import started ({0} front, {1} back, {2} patients found)."
		).format(
			summary.get("front_images") or 0,
			summary.get("back_images") or 0,
			summary.get("patients_found") or 0,
		),
	}


def process_patient_cpr_photo_import_batch(offset: int = 0) -> None:
	from healthcare.api.patient_cpr_photo_import import run_patient_cpr_photo_import_batch

	job = "patient_cpr_photo_import"
	try:
		result = run_patient_cpr_photo_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			uploaded_front=cint(prev.get("uploaded_front", 0)) + cint(result.get("uploaded_front", 0)),
			uploaded_back=cint(prev.get("uploaded_back", 0)) + cint(result.get("uploaded_back", 0)),
			skip_invalid=cint(prev.get("skip_invalid", 0)) + cint(result.get("skip_invalid", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0))
			+ cint(result.get("skip_no_patient", 0)),
			skip_existing=cint(prev.get("skip_existing", 0)) + cint(result.get("skip_existing", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_items=prev.get("total_items"),
			front_images=prev.get("front_images"),
			back_images=prev.get("back_images"),
			patients_found=prev.get("patients_found"),
			patients_missing=prev.get("patients_missing"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_cpr_photo_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_cpr_photo_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Patient CPR photo import complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Patient / Admission legacy signature folder import ────────────────────────


@frappe.whitelist()
def start_patient_legacy_signature_import_migration(items=None, replace_existing=1) -> dict:
	"""Import legacy signature images uploaded from a local folder."""
	_require_admin()
	from healthcare.api.patient_legacy_signature_import import cache_import_items

	if isinstance(items, str):
		import json

		items = json.loads(items) if items.strip() else []
	if not isinstance(items, list) or not items:
		frappe.throw(_("No uploaded images to import."))

	job = "patient_legacy_signature_import"
	_acquire_lock(job)
	summary = cache_import_items(items, replace_existing=cint(replace_existing))
	total_items = summary.get("valid_signatures") or 0
	_set_progress(
		job,
		0,
		total_items=total_items,
		valid_signatures=summary.get("valid_signatures"),
		patients_found=summary.get("patients_found"),
		patients_missing=summary.get("patients_missing"),
		admissions_found=summary.get("admissions_found"),
		admissions_missing=summary.get("admissions_missing"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_patient_legacy_signature_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_patient_legacy_signature_import",
	)
	return {
		"ok": True,
		"message": _(
			"Legacy signature import started ({0} images, {1} patients found, {2} admissions found)."
		).format(
			summary.get("valid_signatures") or 0,
			summary.get("patients_found") or 0,
			summary.get("admissions_found") or 0,
		),
	}


def process_patient_legacy_signature_import_batch(offset: int = 0) -> None:
	from healthcare.api.patient_legacy_signature_import import (
		run_patient_legacy_signature_import_batch,
	)

	job = "patient_legacy_signature_import"
	try:
		result = run_patient_legacy_signature_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			uploaded_admission=cint(prev.get("uploaded_admission", 0))
			+ cint(result.get("uploaded_admission", 0)),
			uploaded_patient=cint(prev.get("uploaded_patient", 0))
			+ cint(result.get("uploaded_patient", 0)),
			skip_invalid=cint(prev.get("skip_invalid", 0)) + cint(result.get("skip_invalid", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0))
			+ cint(result.get("skip_no_patient", 0)),
			skip_existing=cint(prev.get("skip_existing", 0)) + cint(result.get("skip_existing", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_items=prev.get("total_items"),
			valid_signatures=prev.get("valid_signatures"),
			patients_found=prev.get("patients_found"),
			patients_missing=prev.get("patients_missing"),
			admissions_found=prev.get("admissions_found"),
			admissions_missing=prev.get("admissions_missing"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_patient_legacy_signature_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_patient_legacy_signature_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Patient legacy signature import complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


# ── Legacy Visit Document (Patient Documentation) folder import ───────────────


@frappe.whitelist()
def start_legacy_visit_document_import_migration(
	items=None, replace_existing=1, default_document_type=None
) -> dict:
	"""Import DOC_{visit}_{code}.pdf/.jpg/… files into Legacy Visit Document."""
	_require_admin()
	from healthcare.api.legacy_visit_document_import import cache_import_items

	if isinstance(items, str):
		import json

		items = json.loads(items) if items.strip() else []
	if not isinstance(items, list) or not items:
		frappe.throw(_("No uploaded documents to import."))

	job = "legacy_visit_document_import"
	_acquire_lock(job)
	summary = cache_import_items(
		items,
		replace_existing=cint(replace_existing),
		default_document_type=default_document_type,
	)
	total_items = summary.get("valid_documents") or 0
	_set_progress(
		job,
		0,
		total_items=total_items,
		valid_documents=summary.get("valid_documents"),
		unique_legacy_visits=summary.get("unique_legacy_visits"),
		default_document_type=summary.get("default_document_type"),
	)
	frappe.enqueue(
		"healthcare.api.data_migration_jobs.process_legacy_visit_document_import_batch",
		offset=0,
		queue="long",
		timeout=3600,
		job_name="healthcare_legacy_visit_document_import",
	)
	return {
		"ok": True,
		"message": _(
			"Legacy visit document import started ({0} files, {1} unique legacy visits)."
		).format(
			summary.get("valid_documents") or 0,
			summary.get("unique_legacy_visits") or 0,
		),
	}


def process_legacy_visit_document_import_batch(offset: int = 0) -> None:
	from healthcare.api.legacy_visit_document_import import (
		run_legacy_visit_document_import_batch,
	)

	job = "legacy_visit_document_import"
	try:
		result = run_legacy_visit_document_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skip_invalid=cint(prev.get("skip_invalid", 0)) + cint(result.get("skip_invalid", 0)),
			skip_existing=cint(prev.get("skip_existing", 0)) + cint(result.get("skip_existing", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_items=prev.get("total_items"),
			valid_documents=prev.get("valid_documents"),
			unique_legacy_visits=prev.get("unique_legacy_visits"),
			default_document_type=prev.get("default_document_type"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_legacy_visit_document_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_legacy_visit_document_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Legacy visit document import complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise


def process_sleeping_pattern_import_batch(offset: int = 0) -> None:
	from healthcare.api.sleeping_pattern_import import run_sleeping_pattern_import_batch

	job = "sleeping_pattern_import"
	try:
		result = run_sleeping_pattern_import_batch(offset=offset)
		prev = frappe.cache().get_value(_job_progress_key(job)) or {}
		processed = result.get("processed", offset)
		_set_progress(
			job,
			processed,
			created=cint(prev.get("created", 0)) + cint(result.get("created", 0)),
			updated=cint(prev.get("updated", 0)) + cint(result.get("updated", 0)),
			skipped=cint(prev.get("skipped", 0)) + cint(result.get("skipped", 0)),
			skip_no_admission=cint(prev.get("skip_no_admission", 0)) + cint(result.get("skip_no_admission", 0)),
			skip_no_patient=cint(prev.get("skip_no_patient", 0)) + cint(result.get("skip_no_patient", 0)),
			errors=cint(prev.get("errors", 0)) + cint(result.get("errors", 0)),
			total_rows=prev.get("total_rows"),
			existing_records=prev.get("existing_records"),
			new_records=prev.get("new_records"),
			resolved_admissions=prev.get("resolved_admissions"),
		)

		if not result.get("done"):
			frappe.enqueue(
				"healthcare.api.data_migration_jobs.process_sleeping_pattern_import_batch",
				offset=processed,
				queue="long",
				timeout=3600,
				job_name=f"healthcare_sleeping_pattern_import_{processed}",
			)
		else:
			_set_progress(job, processed, done=True)
			_release_lock(job)
			frappe.log_error(
				title="Sleeping Pattern import complete",
				message=frappe.as_json(frappe.cache().get_value(_job_progress_key(job)) or {}),
			)
	except Exception:
		frappe.db.rollback()
		_set_progress(job, cint(offset), done=True, error=frappe.get_traceback())
		_release_lock(job)
		raise
