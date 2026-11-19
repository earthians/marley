# Copyright (c) 2026, healthcare contributors
"""OP clinical timeline: visit → progress notes + prescriptions side by side."""

from __future__ import annotations

import re

import frappe
from frappe import _
from frappe.utils import cstr, getdate, strip_html

from healthcare.api.clinical_note import _enrich_clinical_note_row
from healthcare.api.patient_admission_clinical_bundle import _user_can_read_bundle
from healthcare.api.patient_medication_order import get_medication_orders
from healthcare.api.patient_visit_type_legacy import apply_legacy_visit_type_fallback


def _date_key(val) -> str | None:
	if not val:
		return None
	try:
		return str(getdate(val))
	except Exception:
		return None


def _normalize_note_text(value) -> str:
	"""Collapse HTML/whitespace so duplicate Visit History versions compare equal."""
	text = strip_html(cstr(value or ""))
	text = text.replace("\r\n", "\n").replace("\r", "\n")
	text = re.sub(r"[ \t]+", " ", text)
	text = re.sub(r"\n{2,}", "\n", text)
	return text.strip().lower()


def _dedupe_progress_notes(notes: list[dict]) -> list[dict]:
	"""Display-only collapse of same-day notes with the same (or nested) text.

	Stored Clinical Notes / Visit History rows stay untouched. Used for Patient
	Visit episodes, legacy Visit History, and orphan date buckets so Oracle
	version churn does not repeat in Clinical Summary.
	"""
	kept: list[tuple[str, str, dict]] = []  # (day, normalized body, note)
	for note in notes or []:
		day = _date_key(note.get("posting_date") or note.get("creation")) or ""
		body = _normalize_note_text(note.get("note"))
		drop = False
		supersede: list[int] = []
		for i, (kday, kbody, _knote) in enumerate(kept):
			if kday != day:
				continue
			if body == kbody:
				drop = True
				break
			# Same context: shorter version wholly contained in a kept note
			if body and kbody and body in kbody:
				drop = True
				break
			# Newer/longer version supersedes a shorter kept note
			if body and kbody and kbody in body:
				supersede.append(i)
		if drop:
			continue
		for i in reversed(supersede):
			kept.pop(i)
		kept.append((day, body, note))
	return [note for _day, _body, note in kept]


def _visits_for_patient(patient: str, limit: int = 100) -> list[dict]:
	rows = frappe.get_all(
		"Patient Visit",
		filters={"patient": patient},
		fields=[
			"name",
			"patient",
			"patient_name",
			"encounter_date",
			"status",
			"visit_type",
			"old_visit_type_",
			"practitioner",
			"practitioner_name",
			"cost_center",
		],
		order_by="encounter_date desc, creation desc",
		limit_page_length=limit,
	)
	apply_legacy_visit_type_fallback(rows)
	# Prefer display name from link if blank
	for row in rows:
		if not row.get("practitioner_name") and row.get("practitioner"):
			row["practitioner_name"] = (
				frappe.db.get_value("Healthcare Practitioner", row["practitioner"], "practitioner_name")
				or row["practitioner"]
			)
	return rows


def _progress_notes_for_patient(patient: str, limit: int = 200) -> list[dict]:
	note_type = "Doctor Progress Note"
	if not frappe.db.exists("Clinical Note Type", note_type):
		note_type = None
	filters: dict = {"patient": patient}
	if note_type:
		filters["clinical_note_type"] = note_type
	# Prefer OP-linked notes; still load all patient progress notes so orphans can match by date
	notes = frappe.get_all(
		"Clinical Note",
		filters=filters,
		fields=[
			"name",
			"patient",
			"posting_date",
			"practitioner",
			"user",
			"username",
			"clinical_note_type",
			"note",
			"reference_doctype",
			"reference_document",
			"inpatient_admission",
			"creation",
		],
		order_by="posting_date desc, creation desc",
		limit_page_length=limit,
	)
	# Drop IP-admission scoped notes from OP timeline
	out = []
	for note in notes:
		if note.get("inpatient_admission"):
			continue
		if note.get("reference_doctype") == "Inpatient Admission":
			continue
		_enrich_clinical_note_row(note)
		out.append(note)
	return out


def _prescriptions_for_patient(patient: str, limit: int = 200) -> list[dict]:
	"""Visit-linked / OP medication orders with child lines."""
	orders = get_medication_orders(limit=limit, offset=0, patient=patient) or []
	out = []
	for o in orders:
		if o.get("care_context") == "Inpatient Admission":
			continue
		if o.get("inpatient_record") and not o.get("patient_encounter"):
			continue
		out.append(o)
	return out


def _visit_history_for_patient(patient: str, limit: int = 300) -> list[dict]:
	"""Oracle VISIT_00_01_HISTORY staging rows for this patient (diagnosis versions)."""
	if not frappe.db.exists("DocType", "VISIT_00_01_HISTORY"):
		return []
	return frappe.get_all(
		"VISIT_00_01_HISTORY",
		filters={"patient": patient},
		fields=[
			"name",
			"visit_num",
			"visit_date",
			"patient_visit",
			"visit_diagnosis_detail",
			"cr_date",
			"cr_id",
			"legacy",
		],
		order_by="visit_date desc, cr_date desc, creation desc",
		limit_page_length=limit,
	)


def _synthetic_note_from_history(row: dict) -> dict:
	"""Build a progress-note-shaped payload from a Visit History diagnosis row."""
	text = (row.get("visit_diagnosis_detail") or "").strip()
	posting = row.get("cr_date") or row.get("visit_date")
	return {
		"name": f"VH-{row.get('name')}",
		"posting_date": posting,
		"practitioner": None,
		"practitioner_name": None,
		"username": row.get("cr_id"),
		"user": None,
		"clinical_note_type": "Doctor Progress Note",
		"note": text,
		"reference_document": row.get("name"),
		"reference_doctype": "VISIT_00_01_HISTORY",
		"from_visit_history": True,
	}


def _legacy_history_episode_buckets(
	history_rows: list[dict],
	visit_dates: set[str],
) -> dict[tuple[str, str], dict]:
	"""Group Visit History by (date, visit_num) when that date has no Patient Visit.

	Same-day Patient Visit wins — history for overlapping dates is omitted.
	"""
	buckets: dict[tuple[str, str], dict] = {}
	for row in history_rows or []:
		dk = _date_key(row.get("visit_date"))
		if not dk or dk in visit_dates:
			continue
		visit_num = (row.get("visit_num") or "").strip()
		key = (dk, visit_num)
		bucket = buckets.get(key)
		if not bucket:
			bucket = {
				"visit": None,
				"visit_history": row.get("name"),
				"visit_num": visit_num or None,
				"encounter_date": dk,
				"status": "Legacy",
				"visit_type": "Legacy Visit History",
				"practitioner": None,
				"practitioner_name": None,
				"patient_name": None,
				"cost_center": None,
				"progress_notes": [],
				"prescriptions": [],
				"has_clinical": False,
				"is_legacy": True,
				"legacy": True,
				"_history_names": set(),
				"_history_rows": [],
			}
			buckets[key] = bucket
		bucket["_history_names"].add(row.get("name"))
		bucket["_history_rows"].append(row)
		# Prefer a stable display id: oracle visit num, else first history name
		if visit_num:
			bucket["visit_history"] = visit_num
		elif not bucket.get("visit_history"):
			bucket["visit_history"] = row.get("name")
	return buckets


def _serialize_prescription(order: dict) -> dict:
	meds = []
	for e in order.get("medication_orders") or []:
		meds.append(
			{
				"drug": e.get("drug"),
				"drug_name": e.get("drug_name") or e.get("drug"),
				"dosage": e.get("dosage") or e.get("dose"),
				"uom": e.get("uom"),
				"frequency": e.get("patient_frequency") or e.get("written_frequency") or e.get("frequency"),
				"instructions": e.get("instructions") or e.get("comment"),
				"status": e.get("status"),
			}
		)
	return {
		"name": order.get("name"),
		"posting_date": order.get("posting_date"),
		"status": order.get("status"),
		"practitioner": order.get("practitioner") or order.get("healthcare_practitioner"),
		"healthcare_practitioner_name": order.get("healthcare_practitioner_name")
		or order.get("practitioner"),
		"patient_encounter": order.get("patient_encounter"),
		"care_context": order.get("care_context"),
		"medications": meds,
	}


@frappe.whitelist()
def get_op_clinical_timeline(patient=None, limit=100):
	"""Visit-aligned OP clinical history: each episode has progress notes + prescriptions."""
	if not _user_can_read_bundle():
		frappe.throw(_("Not permitted to view clinical history"), frappe.PermissionError)

	patient = (patient or "").strip()
	if not patient:
		frappe.throw(_("Patient is required"))
	if not frappe.db.exists("Patient", patient):
		frappe.throw(_("Patient {0} not found").format(patient))

	limit = cint_safe(limit, 100)
	visits = _visits_for_patient(patient, limit=limit)
	notes = _progress_notes_for_patient(patient, limit=max(limit * 2, 200))
	prescriptions = _prescriptions_for_patient(patient, limit=max(limit * 2, 200))
	history_rows = _visit_history_for_patient(patient, limit=max(limit * 3, 300))

	visit_ids = {v["name"] for v in visits}
	visit_date = {v["name"]: _date_key(v.get("encounter_date")) for v in visits}
	date_to_visits: dict[str, list[str]] = {}
	for vid, d in visit_date.items():
		if d:
			date_to_visits.setdefault(d, []).append(vid)
	visit_dates = set(date_to_visits.keys())

	# Visit History on dates that already have a Patient Visit are suppressed —
	# the live visit episode is the source of truth for that day.
	legacy_buckets = _legacy_history_episode_buckets(history_rows, visit_dates)
	history_name_to_bucket: dict[str, tuple[str, str]] = {}
	legacy_date_to_keys: dict[str, list[tuple[str, str]]] = {}
	for key, bucket in legacy_buckets.items():
		dk, _visit_num = key
		legacy_date_to_keys.setdefault(dk, []).append(key)
		for hname in bucket.get("_history_names") or []:
			if hname:
				history_name_to_bucket[hname] = key

	notes_by_visit: dict[str, list[dict]] = {v["name"]: [] for v in visits}
	rx_by_visit: dict[str, list[dict]] = {v["name"]: [] for v in visits}
	orphan_notes: list[dict] = []
	orphan_rx: list[dict] = []

	def _attach_note_to_legacy(note: dict) -> bool:
		ref_doc = (note.get("reference_document") or note.get("reference_name") or "").strip()
		ref_dt = (note.get("reference_doctype") or note.get("reference_doc") or "").strip()
		if ref_dt == "VISIT_00_01_HISTORY" and ref_doc in history_name_to_bucket:
			legacy_buckets[history_name_to_bucket[ref_doc]]["progress_notes"].append(note)
			return True
		if ref_doc in history_name_to_bucket:
			legacy_buckets[history_name_to_bucket[ref_doc]]["progress_notes"].append(note)
			return True
		dk = _date_key(note.get("posting_date") or note.get("creation"))
		keys = legacy_date_to_keys.get(dk or "", [])
		if len(keys) == 1:
			legacy_buckets[keys[0]]["progress_notes"].append(note)
			return True
		if keys:
			# Prefer matching oracle visit_num prefix on history reference / trans
			trans = (note.get("trans_no") or "").strip()
			for key in keys:
				vnum = key[1]
				if vnum and (ref_doc.startswith(f"{vnum}-") or f"-{vnum}-" in f"-{trans}-"):
					legacy_buckets[key]["progress_notes"].append(note)
					return True
			legacy_buckets[keys[0]]["progress_notes"].append(note)
			return True
		return False

	for note in notes:
		ref_doc = (note.get("reference_document") or "").strip()
		ref_dt = (note.get("reference_doctype") or "").strip()
		attached = False
		if ref_doc and ref_doc in visit_ids and (not ref_dt or ref_dt == "Patient Visit"):
			notes_by_visit[ref_doc].append(note)
			attached = True
		elif ref_doc and ref_doc in visit_ids:
			notes_by_visit[ref_doc].append(note)
			attached = True
		if attached:
			continue
		# Date fallback onto a Patient Visit for that day (wins over Visit History)
		dk = _date_key(note.get("posting_date") or note.get("creation"))
		candidates = date_to_visits.get(dk or "", [])
		if len(candidates) == 1:
			notes_by_visit[candidates[0]].append(note)
			continue
		if candidates:
			prac = (note.get("practitioner") or "").strip()
			matched = None
			for vid in candidates:
				v = next((x for x in visits if x["name"] == vid), None)
				if v and prac and v.get("practitioner") == prac:
					matched = vid
					break
			notes_by_visit[matched or candidates[0]].append(note)
			continue
		# No Patient Visit that day → fold into legacy Visit History episode when present
		if _attach_note_to_legacy(note):
			continue
		orphan_notes.append(note)

	for order in prescriptions:
		enc = (order.get("patient_encounter") or "").strip()
		ser = _serialize_prescription(order)
		if enc and enc in visit_ids:
			rx_by_visit[enc].append(ser)
			continue
		dk = _date_key(order.get("posting_date") or order.get("creation"))
		candidates = date_to_visits.get(dk or "", [])
		if candidates:
			rx_by_visit[candidates[0]].append(ser)
			continue
		legacy_keys = legacy_date_to_keys.get(dk or "", [])
		if legacy_keys:
			legacy_buckets[legacy_keys[0]]["prescriptions"].append(ser)
			continue
		orphan_rx.append(ser)

	episodes: list[dict] = []
	for v in visits:
		vid = v["name"]
		nlist = notes_by_visit.get(vid) or []
		nlist.sort(key=lambda n: str(n.get("posting_date") or ""), reverse=True)
		nlist = _dedupe_progress_notes(nlist)
		rlist = rx_by_visit.get(vid) or []
		episodes.append(
			{
				"visit": vid,
				"encounter_date": v.get("encounter_date"),
				"status": v.get("status"),
				"visit_type": v.get("visit_type"),
				"practitioner": v.get("practitioner"),
				"practitioner_name": v.get("practitioner_name"),
				"patient_name": v.get("patient_name"),
				"cost_center": v.get("cost_center"),
				"progress_notes": nlist,
				"prescriptions": rlist,
				"has_clinical": bool(nlist or rlist),
				"is_legacy": False,
			}
		)

	# Finalize legacy Visit History episodes (dates with no Patient Visit)
	for key, bucket in legacy_buckets.items():
		# If reconciled Clinical Notes did not cover every history version, add raw text
		covered = {
			(n.get("reference_document") or "").strip()
			for n in bucket["progress_notes"]
			if (n.get("reference_doctype") or "") == "VISIT_00_01_HISTORY"
			or (n.get("reference_document") or "") in (bucket.get("_history_names") or set())
		}
		for hrow in bucket.get("_history_rows") or []:
			hname = (hrow.get("name") or "").strip()
			if hname and hname in covered:
				continue
			if not (hrow.get("visit_diagnosis_detail") or "").strip():
				continue
			bucket["progress_notes"].append(_synthetic_note_from_history(hrow))
		# Newest diagnosis version first; collapse identical text on the same day for display
		bucket["progress_notes"].sort(
			key=lambda n: str(n.get("posting_date") or ""),
			reverse=True,
		)
		bucket["progress_notes"] = _dedupe_progress_notes(bucket["progress_notes"])
		bucket["has_clinical"] = bool(bucket["progress_notes"] or bucket["prescriptions"])
		bucket.pop("_history_names", None)
		bucket.pop("_history_rows", None)
		episodes.append(bucket)

	# Synthetic date-only episodes for remaining orphans (no visit, no history)
	orphan_by_date: dict[str, dict] = {}
	for note in orphan_notes:
		dk = _date_key(note.get("posting_date") or note.get("creation")) or "unknown"
		bucket = orphan_by_date.setdefault(
			dk,
			{
				"visit": None,
				"encounter_date": dk if dk != "unknown" else None,
				"status": None,
				"visit_type": None,
				"practitioner": None,
				"practitioner_name": None,
				"patient_name": None,
				"cost_center": None,
				"progress_notes": [],
				"prescriptions": [],
				"has_clinical": True,
				"orphan": True,
				"is_legacy": False,
			},
		)
		bucket["progress_notes"].append(note)
	for ser in orphan_rx:
		dk = _date_key(ser.get("posting_date")) or "unknown"
		bucket = orphan_by_date.setdefault(
			dk,
			{
				"visit": None,
				"encounter_date": dk if dk != "unknown" else None,
				"status": None,
				"visit_type": None,
				"practitioner": None,
				"practitioner_name": None,
				"patient_name": None,
				"cost_center": None,
				"progress_notes": [],
				"prescriptions": [],
				"has_clinical": True,
				"orphan": True,
				"is_legacy": False,
			},
		)
		bucket["prescriptions"].append(ser)

	for dk, bucket in sorted(orphan_by_date.items(), key=lambda x: x[0] or "", reverse=True):
		bucket["progress_notes"] = _dedupe_progress_notes(bucket.get("progress_notes") or [])
		bucket["has_clinical"] = bool(bucket["progress_notes"] or bucket.get("prescriptions"))
		episodes.append(bucket)

	def _sort_key(ep: dict):
		d = _date_key(ep.get("encounter_date")) or ""
		# Patient Visit before legacy on rare same-date edge cases
		kind = "0" if ep.get("visit") else ("1" if ep.get("is_legacy") else "2")
		return (d, kind, ep.get("visit") or ep.get("visit_history") or "")

	episodes.sort(key=_sort_key, reverse=True)

	patient_name = None
	if visits:
		patient_name = visits[0].get("patient_name")
	if not patient_name:
		patient_name = frappe.db.get_value("Patient", patient, "patient_name") or patient

	return {
		"patient": patient,
		"patient_name": patient_name,
		"episodes": episodes,
		"episode_count": len(episodes),
		"has_data": bool(episodes),
	}


def cint_safe(val, default=0) -> int:
	try:
		return int(val)
	except (TypeError, ValueError):
		return default
