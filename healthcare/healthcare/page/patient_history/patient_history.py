# Copyright (c) 2018, ESS LLP and contributors
# For license information, please see license.txt

import json
import re
from html import unescape
from collections import defaultdict
from datetime import datetime, time

import frappe
from frappe.utils import cint, flt, get_datetime, get_time, getdate, strip_html_tags


def _clean_text(value, max_length=160):
	if value in (None, ""):
		return ""
	text = unescape(str(value)).replace("\xa0", " ")
	text = re.sub(r"(?i)<br\s*/?>|</p\s*>", ". ", text)
	text = strip_html_tags(text)
	text = strip_html_tags(unescape(text)).replace("<", "").replace(">", "")
	text = re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()
	if len(text) > max_length:
		text = text[: max_length - 1].rstrip() + "…"
	return text


def _as_list(value):
	if not value:
		return []
	if isinstance(value, str):
		try:
			value = json.loads(value)
		except (TypeError, json.JSONDecodeError):
			return [value]
	return value if isinstance(value, (list, tuple)) else [value]


def get_filters(name, document_types=None, date_range=None):
	filters = {"patient": name}
	document_types = _as_list(document_types)
	if document_types:
		filters["reference_doctype"] = ["in", document_types]
	date_range = _as_list(date_range)
	if len(date_range) == 2 and date_range[0] and date_range[1]:
		date_from, date_to = date_range
		if isinstance(date_from, str) and len(date_from) == 10:
			date_from += " 00:00:00"
		if isinstance(date_to, str) and len(date_to) == 10:
			date_to += " 23:59:59"
		filters["communication_date"] = ["between", [date_from, date_to]]
	return filters


def _reference_details(record):
	doctype = record.reference_doctype
	name = record.reference_name
	if not doctype or not name or not frappe.db.exists(doctype, name):
		return {}

	try:
		doc = frappe.get_doc(doctype, name)
	except (frappe.DoesNotExistError, frappe.PermissionError):
		return {}

	fields = doc.as_dict()
	practitioner = fields.get("practitioner_name") or fields.get("healthcare_practitioner_name")
	practitioner_id = fields.get("practitioner") or fields.get("healthcare_practitioner")
	if not practitioner and practitioner_id:
		practitioner = frappe.db.get_value(
			"Healthcare Practitioner", practitioner_id, "practitioner_name"
		) or frappe.db.get_value("Healthcare Practitioner", practitioner_id, "name")
	department = fields.get("medical_department") or fields.get("department") or fields.get("requesting_department")

	date_value = record.communication_date
	date_field = time_field = None
	if doctype == "Patient Encounter":
		date_field, time_field = "encounter_date", "encounter_time"
	elif doctype == "Vital Signs":
		date_field, time_field = "signs_date", "signs_time"
	elif doctype == "Clinical Procedure":
		date_field, time_field = "start_date", "start_time"
	elif doctype == "Therapy Session":
		date_field, time_field = "start_date", "start_time"
	elif doctype == "Lab Test":
		date_field, time_field = "date", "time"
	elif doctype == "Observation":
		date_field, time_field = "posting_date", "time_of_result"

	if date_field and fields.get(date_field):
		candidate_date = fields.get(date_field)
		candidate_time = fields.get(time_field) if time_field else None
		try:
			current = get_datetime(date_value) if date_value else None
			if not current or current.time() == time.min:
				fallback_time = candidate_time or fields.get("creation")
				ref_time = get_time(fallback_time) if fallback_time else time.min
				date_value = datetime.combine(getdate(candidate_date), ref_time)
		except (TypeError, ValueError):
			pass

	result = {
		"practitioner_name": practitioner,
		"department": department,
		"communication_date": str(date_value) if date_value else None,
	}
	if doctype == "Patient Encounter":
		symptoms = [row.get("complaint") or row.get("symptom") or row.get("description") for row in fields.get("symptoms", [])]
		diagnoses = [row.get("diagnosis") for row in fields.get("diagnosis", [])]
		result["summary"] = " · ".join(filter(None, [
			", ".join(filter(None, symptoms)) and f"Symptoms: {', '.join(filter(None, symptoms))}",
			", ".join(filter(None, diagnoses)) and f"Diagnosis: {', '.join(filter(None, diagnoses))}",
		]))
	elif doctype == "Vital Signs":
		parts = []
		for label, key, suffix in (("Temp", "temperature", "°C"), ("Pulse", "pulse", "bpm"), ("BP", "bp", "mmHg"), ("SpO2", "spo2", "%"), ("Weight", "weight", "kg")):
			value = fields.get(key)
			if value is None and key == "spo2":
				for candidate in ("spo2", "sp_o2", "oxygen_saturation", "blood_oxygen_saturation"):
					if frappe.get_meta(doctype).has_field(candidate):
						value = fields.get(candidate)
						break
			if key == "bp" and not value and fields.get("bp_systolic") and fields.get("bp_diastolic"):
				value = f"{fields['bp_systolic']}/{fields['bp_diastolic']}"
			if value not in (None, ""):
				parts.append(f"{label} {value} {suffix}".strip())
		result["summary"] = " · ".join(parts)
	elif doctype == "Observation":
		name_part = fields.get("preferred_display_name") or fields.get("description") or fields.get("observation_template") or doctype
		if fields.get("observation_template"):
			name_part = frappe.db.get_value("Observation Template", fields.get("observation_template"), "preferred_display_name") or frappe.db.get_value("Observation Template", fields.get("observation_template"), "observation") or name_part
		result_value = fields.get("result")
		flag = fields.get("result_flag") or fields.get("result_interpretation")
		result["result_flag"] = flag
		result["summary"] = " · ".join(filter(None, [str(name_part), str(result_value) if result_value else "", str(flag) if flag else ""]))
	elif doctype == "Lab Test":
		name_part = fields.get("lab_test_name") or fields.get("template") or doctype
		items = fields.get("normal_test_items") or fields.get("descriptive_test_items") or []
		key_result = next((row for row in items if row.get("result_value")), None)
		result_text = ""
		if key_result:
			result_text = " ".join(filter(None, [str(key_result.get("lab_test_name") or key_result.get("lab_test_particulars") or ""), str(key_result.get("result_value")), str(key_result.get("lab_test_uom") or "")]))
		result["summary"] = " · ".join(filter(None, [str(name_part), result_text]))
	elif doctype == "Clinical Procedure":
		result["summary"] = " · ".join(filter(None, [fields.get("procedure_template"), fields.get("service_unit"), fields.get("body_part")]))
	else:
		result["summary"] = fields.get("subject") or fields.get("title") or fields.get("description") or record.subject
	return result


@frappe.whitelist()
def get_feed(
	name: str,
	document_types: str | None = None,
	date_range: str | None = None,
	start: int = 0,
	page_length: int = 20,
) -> list:
	frappe.has_permission("Patient", "read", name, throw=True)
	filters = get_filters(name, document_types, date_range)
	result = frappe.get_list(
		"Patient Medical Record",
		fields=["name", "owner", "communication_date", "reference_doctype", "reference_name", "subject"],
		filters=filters,
		order_by="communication_date desc, creation desc",
		limit_page_length=cint(page_length),
		limit_start=cint(start),
	)
	for record in result:
		record.update(_reference_details(record))
		if not record.get("practitioner_name"):
			record["practitioner_name"] = frappe.get_value("User", record.owner, "full_name") or record.owner
		for field in ("subject", "summary", "practitioner_name", "department", "result_flag"):
			if record.get(field):
				record[field] = _clean_text(record[field])
	result.sort(
		key=lambda row: (
			get_datetime(row.communication_date) if row.get("communication_date") else datetime.min,
			row.get("creation") or datetime.min,
		),
		reverse=True,
	)
	return result


@frappe.whitelist()
def get_feed_count(name, document_types=None, date_range=None):
	return frappe.db.count("Patient Medical Record", filters=get_filters(name, document_types, date_range))


@frappe.whitelist()
def get_patient_encounter_markers(patient):
	return frappe.get_all(
		"Patient Medical Record",
		fields=["reference_name", "communication_date"],
		filters={"patient": patient, "reference_doctype": "Patient Encounter"},
		order_by="communication_date asc",
	)


@frappe.whitelist()
def get_activity_years(patient):
	rows = frappe.db.sql(
		"""select distinct year(communication_date) as year
		from `tabPatient Medical Record` where patient = %s
		order by year desc""",
		patient,
		as_dict=True,
	)
	return [cint(row.year) for row in rows if row.year]


@frappe.whitelist()
def get_activity_summary(patient, from_date, to_date, document_types=None):
	filters = get_filters(patient, document_types, [from_date, to_date])
	rows = frappe.get_all(
		"Patient Medical Record",
		fields=["communication_date", "reference_doctype", "reference_name"],
		filters=filters,
		order_by="communication_date asc",
	)
	days = defaultdict(lambda: {"date": None, "total": 0, "by_type": {}, "abnormal": False})
	refs_by_type = defaultdict(dict)
	for row in rows:
		day = getdate(row.communication_date).isoformat()
		entry = days[day]
		entry["date"] = day
		entry["total"] += 1
		entry["by_type"][row.reference_doctype] = entry["by_type"].get(row.reference_doctype, 0) + 1
		refs_by_type[row.reference_doctype][row.reference_name] = day

	if refs_by_type.get("Vital Signs"):
		meta = frappe.get_meta("Vital Signs")
		fields = [field for field in ("signs_date", "bp_systolic", "bp_diastolic", "temperature") if meta.has_field(field)]
		for optional in ("spo2", "sp_o2", "oxygen_saturation", "blood_oxygen_saturation"):
			if meta.has_field(optional):
				fields.append(optional)
				break
		for vital in frappe.get_all("Vital Signs", filters={"name": ["in", list(refs_by_type["Vital Signs"])]}, fields=["name", *fields]):
			day = refs_by_type["Vital Signs"].get(vital.name)
			spo2 = next((vital.get(key) for key in ("spo2", "sp_o2", "oxygen_saturation", "blood_oxygen_saturation") if vital.get(key) is not None), None)
			if (flt(vital.get("bp_systolic")) >= 140 or flt(vital.get("bp_diastolic")) >= 90
				or flt(vital.get("temperature")) > 37.5 or (spo2 is not None and flt(spo2) < 94)):
				if day in days:
					days[day]["abnormal"] = True

	if refs_by_type.get("Observation"):
		for observation in frappe.get_all(
			"Observation", filters={"name": ["in", list(refs_by_type["Observation"])]},
			fields=["name", "result_flag", "result_flag_color", "result_interpretation"],
		):
			flag = " ".join(str(observation.get(field) or "") for field in ("result_flag", "result_flag_color", "result_interpretation")).lower()
			if any(term in flag for term in ("high", "low", "abnormal", "critical", "out of range", "red", "amber", "borderline", "#e24c4c", "#f2994a")):
				day = refs_by_type["Observation"].get(observation.name)
				if day in days:
					days[day]["abnormal"] = True
	return [days[key] for key in sorted(days)]


@frappe.whitelist()
def get_feed_for_dt(doctype: str, docname: str) -> list:
	frappe.has_permission(doctype, "read", docname, throw=True)
	result = frappe.get_list(
		"Patient Medical Record",
		fields=["name", "owner", "communication_date", "reference_doctype", "reference_name", "subject"],
		filters={"reference_doctype": doctype, "reference_name": docname},
		order_by="communication_date desc, creation desc",
	)
	for record in result:
		record.update(_reference_details(record))
	return result


@frappe.whitelist()
def get_patient_history_doctypes():
	document_types = []
	settings = frappe.get_single("Patient History Settings")
	for entry in settings.standard_doctypes:
		document_types.append(entry.document_type)
	for entry in settings.custom_doctypes:
		document_types.append(entry.document_type)
	return document_types
