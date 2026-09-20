# -*- coding: utf-8 -*-
# Copyright (c) 2025, Healthcare and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, strip_html

from healthcare.api.lab_test_doctor_review import follow_up_labels_from_doc, record_results_entered
from healthcare.healthcare.care_episode_guard import resolve_inpatient_admission_name
from healthcare.healthcare.editing_lock import assert_editing_allowed
from healthcare.healthcare.lab_test_result_rules import apply_rules_to_doc


LAB_RESULT_EDIT_ROLES = frozenset(
	(
		"Laboratory User",
		"LabTest Approver",
		"System Manager",
		"Healthcare Administrator",
		"Administrator",
	)
)

CEO_ROLE = "CEO"
GROUP_FINISHED_SR_STATUS = "completed-Request Status"

# F013/F014: lab result editors may correct results until a final status; after these
# (or a finished group) only administrators/CEO may amend.
FINAL_LAB_STATUSES = frozenset(("Approved", "Completed"))
LAB_RESULT_ADMIN_ROLES = frozenset(("System Manager", "Healthcare Administrator", "Administrator"))

# Lab tests still in the pre-review pipeline (requested → sample → testing).
LAB_PENDING_PIPELINE_STATUSES = (
	"Draft",
	"Requested",
	"Awaiting sample collection",
	"Sample Collection in Progress",
	"Sample collection in progress",
	"Sample Collected",
	"Testing in progress",
	"Testing in Progress",
	"Partial Result Enter",
	"Pending",
)

# Results entered / awaiting doctor review or beyond — excluded from pending pipeline tab.
LAB_RESULTS_ENTERED_STATUSES = frozenset(
	(
		"Pending Review",
		"Reviewed",
		"Rejected",
		"Completed",
		"Submitted",
		"Approved",
	)
)


def _is_ceo_user() -> bool:
	return CEO_ROLE in frappe.get_roles(frappe.session.user)


def _lab_request_item_key(item: dict) -> str:
	kind = (item.get("kind") or "").strip().lower()
	if kind == "group":
		return (item.get("parent") or "").strip()
	return (item.get("template") or "").strip()


def _get_lab_tests_for_request_group(service_request_name: str, lab_test_group: str | None = None):
	"""Lab Tests on a Service Request, optionally limited to one lab-request group.

	When ``lab_test_group`` is set, match ``Lab Test.lab_test_group`` first, then
	fall back to child templates on that lab-request line (same as finish_group_lab_tests).
	Without it, return every grouped child on the request (legacy one-group behaviour).
	"""
	base_filters = {
		"service_request": service_request_name,
		"docstatus": ["<", 2],
	}
	fields = ["name", "status", "template", "lab_test_group", "is_group_lab_test"]
	lab_test_group = (lab_test_group or "").strip() or None

	if not lab_test_group:
		return frappe.get_all(
			"Lab Test",
			filters={**base_filters, "is_group_lab_test": 1},
			fields=fields,
			order_by="creation asc",
		)

	group_tests = frappe.get_all(
		"Lab Test",
		filters={**base_filters, "lab_test_group": lab_test_group},
		fields=fields,
		order_by="creation asc",
	)
	if group_tests:
		return group_tests

	from healthcare.healthcare.lab_request_items import parse_lab_request_items

	if not frappe.db.exists("Service Request", service_request_name):
		return []

	sr_doc = frappe.get_doc("Service Request", service_request_name)
	matched_item = None
	for item in parse_lab_request_items(sr_doc):
		if _lab_request_item_key(item) == lab_test_group:
			matched_item = item
			break
	if not matched_item:
		return []

	kind = (matched_item.get("kind") or "").strip().lower()
	if kind == "group":
		child_templates = [c for c in (matched_item.get("children") or []) if c]
		if not child_templates:
			child_templates = frappe.get_all(
				"Lab Test Template",
				filters={"lab_group": lab_test_group, "disabled": 0},
				pluck="name",
				ignore_permissions=True,
			)
	else:
		child_templates = [lab_test_group]

	if not child_templates:
		return []

	return frappe.get_all(
		"Lab Test",
		filters={**base_filters, "template": ["in", child_templates]},
		fields=fields,
		order_by="creation asc",
	)


def _finished_lab_request_groups(service_request_name: str) -> set[str]:
	"""Group/single template codes marked finished on multi-line Lab Requests."""
	if not service_request_name or not frappe.db.exists("Service Request", service_request_name):
		return set()
	from healthcare.healthcare.lab_request_items import parse_lab_request_items

	doc = frappe.get_doc("Service Request", service_request_name)
	finished: set[str] = set()
	for item in parse_lab_request_items(doc):
		key = _lab_request_item_key(item)
		if key and cint(item.get("finished")):
			finished.add(key)
	return finished


def _is_group_lab_finished(doc) -> bool:
	if not cint(getattr(doc, "is_group_lab_test", 0)):
		return False
	service_request = getattr(doc, "service_request", None)
	if not service_request:
		return False
	sr_status = frappe.db.get_value("Service Request", service_request, "status")
	if sr_status == GROUP_FINISHED_SR_STATUS:
		return True
	# Per-group Complete on multi-line Lab Requests (before whole request is finished).
	group_code = (getattr(doc, "lab_test_group", None) or "").strip()
	if group_code and group_code in _finished_lab_request_groups(service_request):
		return True
	return False


def _plain_sample_details(value: str | None) -> str | None:
	"""Store collection notes as plain text, not rich-text HTML."""
	if value is None:
		return None
	text = strip_html(value).strip()
	return text or None


def _is_nurse_user(roles=None) -> bool:
	roles = roles if roles is not None else set(frappe.get_roles(frappe.session.user))
	return any("nurse" in (r or "").lower() or "nursing" in (r or "").lower() for r in roles)


def _lab_test_template_is_by_nurse(template: str | None) -> bool:
	if not template:
		return False
	return bool(cint(frappe.db.get_value("Lab Test Template", template, "by_nurse") or 0))


def _ensure_lab_result_edit_permission(doc=None):
	"""Laboratory User / LabTest Approver / admins may enter results.

	Nurses may also enter results when the Lab Test Template has by_nurse set
	(nurse-collected / nurse-performed tests).
	"""
	if doc and _is_group_lab_finished(doc) and _is_ceo_user():
		return

	roles = set(frappe.get_roles(frappe.session.user))
	if roles & LAB_RESULT_EDIT_ROLES:
		return

	if doc is not None and _is_nurse_user(roles) and _lab_test_template_is_by_nurse(getattr(doc, "template", None)):
		return

	frappe.throw(
		_(
			"Only Laboratory User, LabTest Approver, or administrators may enter Lab Test results. "
			"Nurses may enter results only for nurse lab tests (template By Nurse)."
		),
		frappe.PermissionError,
	)


# Results may not be entered while sample collection is still outstanding.
LAB_PRE_SAMPLE_COLLECTION_STATUSES = frozenset(
	(
		"Draft",
		"Requested",
		"Awaiting sample collection",
		"Sample Collection in Progress",
		"Sample collection in progress",
	)
)


def _lab_test_sample_collection_done(doc) -> bool:
	status = cstr(getattr(doc, "status", None) or "").strip()
	if not status or status == "Cancelled":
		return False
	return status not in LAB_PRE_SAMPLE_COLLECTION_STATUSES


def _ensure_lab_result_save_allowed(doc):
	"""F013/F014: lab result editors may correct results until a final status; after a
	final status (Approved/Completed) or a finished group, only administrators/CEO may amend."""
	if doc.docstatus == 2:
		frappe.throw(_("Cannot update a cancelled Lab Test"))
	if doc.status in ("Rejected", "Cancelled"):
		frappe.throw(_("Cannot update a {0} Lab Test").format(doc.status))

	if not _lab_test_sample_collection_done(doc):
		frappe.throw(
			_("Complete sample collection before entering lab test results."),
			title=_("Sample collection required"),
		)

	is_final = doc.status in FINAL_LAB_STATUSES or _is_group_lab_finished(doc)
	if is_final:
		roles = set(frappe.get_roles(frappe.session.user))
		if not (roles & LAB_RESULT_ADMIN_ROLES) and not _is_ceo_user():
			frappe.throw(
				_("This lab result is finalised — only an administrator may amend it."),
				frappe.PermissionError,
			)
		return
	# Sample Collected / Testing / Pending Review / Reviewed / …: editable by
	# any lab result editor (role checked separately in _ensure_lab_result_edit_permission).
	return


@frappe.whitelist(allow_guest=False)
def get_lab_test_template_details(template):
	"""Return display/meta fields from a Lab Test Template for result-entry UI.

	Also returns normal_test_templates rows so the frontend can pre-populate
	an empty result entry table even before any results have been saved.

	When ``is_multiple`` is set, also returns ``multiple_result_type`` rows
	(one result line per unit / reference band).
	"""
	if not template or not frappe.db.exists('Lab Test Template', template):
		return {}
	doc = frappe.get_doc('Lab Test Template', template)

	# Compound test rows (normal_test_templates child table on the template)
	compound_rows = []
	for r in (doc.get('normal_test_templates') or []):
		compound_rows.append({
			'lab_test_event': getattr(r, 'lab_test_event', '') or '',
			'lab_test_uom': getattr(r, 'lab_test_uom', '') or '',
			'normal_range': getattr(r, 'normal_range', '') or '',
		})

	multiple_rows = []
	status_options = _multiple_result_status_options()
	for r in (doc.get('multiple_result_type') or []):
		male_min = getattr(r, 'male_min_range', None)
		male_max = getattr(r, 'male_max_range', None)
		female_min = getattr(r, 'female_min_range', None)
		female_max = getattr(r, 'female_max_range', None)
		use_status = cint(getattr(r, 'use_status', 0))
		test_unit = (getattr(r, 'test_unit', None) or getattr(r, 'uom', None) or '').strip()
		uom = (getattr(r, 'uom', None) or test_unit or '').strip()
		multiple_rows.append({
			'test_unit': test_unit,
			'uom': uom,
			'male_min_range': male_min,
			'male_max_range': male_max,
			'female_min_range': female_min,
			'female_max_range': female_max,
			'status': getattr(r, 'status', None) or '',
			'use_status': use_status,
			'uses_status_bands': bool(use_status),
			'normal_range': _format_multiple_result_normal_range(
				male_min, male_max, female_min, female_max,
				status_options if use_status else None,
			),
		})

	return {
		'lab_test_template_type': doc.lab_test_template_type,
		'is_multiple': cint(doc.get('is_multiple')),
		# Global toggle (Healthcare Settings) for the per-unit Multiple Results entry UI.
		'have_multiresults_on_lab_test': bool(
			cint(frappe.db.get_single_value('Healthcare Settings', 'have_multiresults_on_lab_test'))
		),
		'min_range': doc.get('min_range'),
		'max_range': doc.get('max_range'),
		# Gendered ranges so result-entry validation can use the patient-appropriate range.
		'female_min_range': doc.get('female_min_range'),
		'female_max_range': doc.get('female_max_range'),
		'male_min_range': doc.get('male_min_range'),
		'male_max_range': doc.get('male_max_range'),
		'worksheet_instructions': doc.get('worksheet_instructions') or '',
		'sample_details': doc.get('sample_details') or '',
		'lab_test_uom': doc.get('lab_test_uom') or '',
		'normal_range': doc.get('lab_test_normal_range') or '',
		'normal_test_templates': compound_rows,
		'multiple_result_type': multiple_rows,
		'status_options': status_options,
		'cost_center': doc.get('cost_center')
	}


def _multiple_result_status_options():
	"""Status select options from Multiple Results doctype (Vitamin D-style bands)."""
	try:
		meta = frappe.get_meta('Multiple Results')
		field = meta.get_field('status')
		if field and field.options:
			return [o for o in (field.options or '').split('\n') if o and o.strip()]
	except Exception:
		pass
	return [
		'Deficiency  <10',
		'Insufficiency 10 - 30',
		'Sufficiency  30 – 100',
		'Toxicity  >100',
	]


def _is_numeric_range_value(val):
	if val is None or val == '':
		return False
	try:
		float(val)
		return True
	except (TypeError, ValueError):
		return False


def _format_multiple_result_normal_range(male_min, male_max, female_min, female_max, status_options=None):
	parts = []
	if _is_numeric_range_value(male_min) or _is_numeric_range_value(male_max):
		parts.append(f"M: {male_min or '—'} – {male_max or '—'}")
	if _is_numeric_range_value(female_min) or _is_numeric_range_value(female_max):
		parts.append(f"F: {female_min or '—'} – {female_max or '—'}")
	if parts:
		return '; '.join(parts)
	if status_options:
		return '\n'.join(status_options)
	return ''


# Allowed Lab Test.result_flag values (must match lab_test.json Select options).
RESULT_FLAG_VALUES = frozenset(
	(
		"",
		"High",
		"Low",
		"Normal",
		"Critically High",
		"Critically Low",
		"Deficiency",
		"Insuficiency",  # spelling matches Lab Test.result_flag options
		"Sufficiency",
		"Toxicity",
	)
)


def _normalize_result_flag_mark(status_text):
	"""Collapse option labels like 'Deficiency  <10' to Select values (Deficiency, …)."""
	import re

	raw = (status_text or "").strip()
	if not raw:
		return ""
	if raw in RESULT_FLAG_VALUES:
		return raw
	# First word / label before threshold digits
	label = re.split(r"\s*[<>0-9]", raw, maxsplit=1)[0].strip() or raw.split()[0]
	key = label.lower()
	if key.startswith("deficien"):
		return "Deficiency"
	if key.startswith("insufficien") or key.startswith("insuficien"):
		return "Insuficiency"
	if key.startswith("sufficien"):
		return "Sufficiency"
	if key.startswith("toxicit"):
		return "Toxicity"
	# High/Low family already exact
	for allowed in (
		"Critically High",
		"Critically Low",
		"High",
		"Low",
		"Normal",
	):
		if key == allowed.lower():
			return allowed
	return ""


def _suggest_multiple_result_status(result_value, status_options=None):
	"""Map numeric result → short mark (Deficiency / Insuficiency / Sufficiency / Toxicity).

	Thresholds are read from Multiple Results status option placeholders
	(e.g. 'Deficiency  <10'); the returned value is only the mark name.
	"""
	import re

	try:
		val = float(result_value)
	except (TypeError, ValueError):
		return ""
	options = status_options or _multiple_result_status_options()
	matched = ""
	for opt in options:
		m = re.search(r"<\s*([\d.]+)", opt)
		if m and val < float(m.group(1)):
			matched = opt
			break
	if not matched:
		for opt in options:
			m = re.search(r"([\d.]+)\s*[-–—]\s*([\d.]+)", opt)
			if m and float(m.group(1)) <= val <= float(m.group(2)):
				matched = opt
				break
	if not matched:
		for opt in options:
			m = re.search(r">\s*([\d.]+)", opt)
			if m and val > float(m.group(1)):
				matched = opt
				break
	return _normalize_result_flag_mark(matched)


def _result_flag_from_multiple_status(status_text):
	"""Normalize to Lab Test.result_flag Select options."""
	return _normalize_result_flag_mark(status_text)


# @frappe.whitelist()
# def get_lab_tests(
# 	limit=50,
# 	offset=0,
# 	patient=None,
# 	status=None,
# 	pending_review=False,
# 	is_outsourced=None,
# 	from_date=None,
# 	to_date=None,
# 	template=None,
# 	patient_type=None,
# 	by_nurse=None,
# ):
# 	"""Get list of Lab Tests with optional filters (patient, status, date range, OP/IP, template, outsourcing)."""
# 	from healthcare.api.common import get_permitted_cost_centers
# 	filters = {"docstatus": ["!=", 2]}  # Exclude cancelled

# 	if patient:
# 		filters["patient"] = patient

# 	if status:
# 		filters["status"] = status

# 	if pending_review:
# 		filters["status"] = ["in", ["Pending Review", "Submitted"]]

# 	if is_outsourced is not None:
# 		if isinstance(is_outsourced, str):
# 			is_outsourced = is_outsourced == "1"
# 		filters["is_outsourced"] = 1 if is_outsourced else 0

# 	if template:
# 		filters["template"] = template

# 	# Filter by nurse-specific lab tests based on template's by_nurse field
# 	if by_nurse is not None:
# 		if isinstance(by_nurse, str):
# 			by_nurse = by_nurse.lower() in ('1', 'true', 'yes')
# 		# Get templates that have by_nurse set to the desired value
# 		template_filters = {"by_nurse": 1 if by_nurse else 0}
# 		nurse_templates = frappe.get_all("Lab Test Template", filters=template_filters, pluck="name")
# 		if nurse_templates:
# 			filters["template"] = ["in", nurse_templates]
# 		else:
# 			# If no templates match the criteria, return empty result
# 			return []

# 	# OP / IP filter based on inpatient_record link
# 	if patient_type == "IP":
# 		filters["inpatient_record"] = ["is", "set"]
# 	elif patient_type == "OP":
# 		filters["inpatient_record"] = ["is", "not set"]

# 	# Date range filter — apply on result_date
# 	if from_date or to_date:
# 		if from_date and to_date:
# 			filters["result_date"] = ["between", [from_date, to_date]]
# 		elif from_date:
# 			filters["result_date"] = [">=", from_date]
# 		elif to_date:
# 			filters["result_date"] = ["<=", to_date]

# 	# ── Cost-centre User Permission enforcement ──────────────────────────────
# 	permitted_cc = get_permitted_cost_centers()
# 	if permitted_cc is not None:
# 		if not permitted_cc:
# 			return []
# 		filters["cost_center"] = ["in", permitted_cc]

# 	lab_tests = frappe.get_all(
# 		"Lab Test",
# 		filters=filters,
# 		fields=[
# 			"name",
# 			"docstatus",
# 			"patient",
# 			"patient_name",
# 			"practitioner",
# 			"practitioner_name",
# 			"lab_test_name",
# 			"template",
# 			"status",
# 			"result_date",
# 			"submitted_date",
# 			"approved_date",
# 			"invoiced",
# 			"department",
# 			"is_outsourced",
# 			"material_request",
# 			"amount",
# 			"grand_total",
# 			"cost_center",
# 			"min_range",
# 			"max_range",
# 			"results",
# 			"female_min_range",
# 			"female_max_range",
# 			"male_min_range",
# 			"male_max_range"

# 		],
# 		limit=limit,
# 		limit_start=offset,
# 		order_by="submitted_date desc, result_date desc",
# 	)

# 	for lab_test in lab_tests:
# 		if lab_test.patient and not lab_test.patient_name:
# 			lab_test["patient_name"] = (
# 				frappe.db.get_value("Patient", lab_test.patient, "patient_name") or lab_test.patient
# 			)
# 		if lab_test.practitioner and not lab_test.practitioner_name:
# 			lab_test["practitioner_name"] = (
# 				frappe.db.get_value("Healthcare Practitioner", lab_test.practitioner, "practitioner_name")
# 				or lab_test.practitioner
# 			)

# 	return lab_tests

_LAB_TEST_LIST_FIELDS = [
	"name",
	"docstatus",
	"patient",
	"cost_center",
	"patient_name",
	"practitioner",
	"practitioner_name",
	"doc_no",
	"lab_test_name",
	"template",
	"status",
	"creation",
	"result_date",
	"submitted_date",
	"approved_date",
	"invoiced",
	"department",
	"is_outsourced",
	"material_request",
	"amount",
	"grand_total",
	"cost_center",
	"custom_result",
	"service_request",
	"lab_test_group",
	"is_group_lab_test",
	"lab_technician",
	"lab_technician_name",
	"results",
	"gender",
	"result_flag",
	"is_legacy_import",
	"date",
	"sample",
	"sample_collected_date",
	"inpatient_record",
	"inpatient_admission",
]


def _normalize_legacy_doc_no(value) -> str:
	"""Normalize Oracle DOC_NUM stored on Lab Test.doc_no."""
	if value is None or value == "":
		return ""
	if isinstance(value, float) and value == int(value):
		return str(int(value))
	if isinstance(value, int):
		return str(value)
	return str(value).strip()


def _resolve_practitioner_from_doc_no(doc_no, cache=None):
	"""Resolve Healthcare Practitioner id + display name from legacy doc_no (DOC_NUM / doctors_id).

	Returns (practitioner_id_or_None, practitioner_name_or_None).
	"""
	code = _normalize_legacy_doc_no(doc_no)
	if not code:
		return None, None
	if cache is not None and code in cache:
		return cache[code]

	practitioner = None
	if frappe.db.exists("Healthcare Practitioner", code):
		practitioner = code
	else:
		practitioner = frappe.db.get_value("Healthcare Practitioner", {"doctors_id": code}, "name")

	practitioner_name = None
	if practitioner:
		practitioner_name = (
			frappe.db.get_value("Healthcare Practitioner", practitioner, "practitioner_name")
			or practitioner
		)

	result = (practitioner, practitioner_name)
	if cache is not None:
		cache[code] = result
	return result


def _apply_doc_no_practitioner_fallback(lab_test, cache=None):
	"""If requesting practitioner is missing, fill from legacy doc_no (Oracle DOC_NUM)."""
	has_name = bool((lab_test.get("practitioner_name") or "").strip())
	has_practitioner = bool((lab_test.get("practitioner") or "").strip())
	if has_name and has_practitioner:
		return lab_test

	doc_no = lab_test.get("doc_no")
	if not _normalize_legacy_doc_no(doc_no):
		return lab_test

	practitioner, practitioner_name = _resolve_practitioner_from_doc_no(doc_no, cache)
	if practitioner and not has_practitioner:
		lab_test["practitioner"] = practitioner
	if practitioner_name and not has_name:
		lab_test["practitioner_name"] = practitioner_name
	elif not has_name and not has_practitioner:
		# Still surface the doctor code rather than leaving the UI blank.
		lab_test["practitioner_name"] = _normalize_legacy_doc_no(doc_no)
	return lab_test

_LAB_TEST_LINE_LIST_FIELDS = [
	"parent",
	"sr_num",
	"lab_group_num",
	"group_name",
	"lab_sub_num",
	"lab_result_value",
	"lab_amt_book",
	"lab_amt_add",
	"lab_amt_disc",
	"lab_amt_net",
	"sta_flg",
	"field1",
	"field2",
	"field3",
	"field4",
	"field5",
	"field6",
	"field7",
	"field8",
	"field9",
	"field10",
	"cr_id",
	"cr_date",
	"up_id",
	"up_date",
	"lab_04_remarks",
]


def _attach_legacy_lab_test_lines(lab_tests):
	"""Attach LAB 00-04 child rows for legacy imports (list API)."""
	legacy_names = [lt.name for lt in lab_tests if cint(lt.get("is_legacy_import"))]
	if not legacy_names:
		return lab_tests

	line_rows = frappe.get_all(
		"Lab Test Line",
		filters={"parent": ["in", legacy_names], "parenttype": "Lab Test"},
		fields=_LAB_TEST_LINE_LIST_FIELDS,
		order_by="parent asc, sr_num asc, idx asc",
	)
	by_parent: dict[str, list] = {}
	template_info_cache: dict[str, dict] = {}
	for row in line_rows:
		parent = row.pop("parent", None)
		if not parent:
			continue
		sub_template = (row.get("lab_sub_num") or "").strip()
		if sub_template:
			row["lab_sub_template_name"] = _lab_test_template_name(sub_template, template_info_cache)
		by_parent.setdefault(parent, []).append(row)

	for lab_test in lab_tests:
		if cint(lab_test.get("is_legacy_import")):
			lab_test["lab_test_lines"] = by_parent.get(lab_test.name, [])
	return lab_tests


def _enrich_lab_test_rows(lab_tests, template_cache=None):
	"""Attach template ranges and display names to lab test list rows."""
	if template_cache is None:
		template_cache = {}

	patient_file_no_cache = {}
	group_name_cache: dict[str, str] = {}
	doc_no_practitioner_cache: dict[str, tuple] = {}
	for lab_test in lab_tests:
		lab_test["female_min_range"] = None
		lab_test["female_max_range"] = None
		lab_test["male_min_range"] = None
		lab_test["male_max_range"] = None
		lab_test["min_range"] = None
		lab_test["max_range"] = None
		lab_test["by_nurse"] = 0

		if lab_test.template:
			if lab_test.template not in template_cache:
				template_cache[lab_test.template] = frappe.get_doc("Lab Test Template", lab_test.template)
			template_doc = template_cache[lab_test.template]
			lab_test["female_min_range"] = template_doc.get("female_min_range")
			lab_test["female_max_range"] = template_doc.get("female_max_range")
			lab_test["male_min_range"] = template_doc.get("male_min_range")
			lab_test["male_max_range"] = template_doc.get("male_max_range")
			lab_test["min_range"] = template_doc.get("min_range")
			lab_test["max_range"] = template_doc.get("max_range")
			lab_test["by_nurse"] = cint(template_doc.get("by_nurse") or 0)

		if lab_test.patient:
			if lab_test.patient not in patient_file_no_cache:
				patient_file_no_cache[lab_test.patient] = (
					frappe.db.get_value("Patient", lab_test.patient, "file_no") or ""
				)
			lab_test["file_no"] = patient_file_no_cache[lab_test.patient]
		else:
			lab_test["file_no"] = ""
		if lab_test.patient and not lab_test.patient_name:
			lab_test["patient_name"] = (
				frappe.db.get_value("Patient", lab_test.patient, "patient_name") or lab_test.patient
			)
		if lab_test.practitioner and not lab_test.practitioner_name:
			lab_test["practitioner_name"] = (
				frappe.db.get_value("Healthcare Practitioner", lab_test.practitioner, "practitioner_name")
				or lab_test.practitioner
			)
		# Legacy imports store Oracle DOC_NUM on doc_no without setting practitioner.
		_apply_doc_no_practitioner_fallback(lab_test, doc_no_practitioner_cache)
		if lab_test.get("lab_technician") and not (lab_test.get("lab_technician_name") or "").strip():
			lab_test["lab_technician_name"] = (
				frappe.db.get_value("Healthcare Practitioner", lab_test.lab_technician, "practitioner_name")
				or lab_test.lab_technician
			)

		# Group name — lab_test_group is a Lab Test Template code (e.g. LAB-004); resolve its name.
		group_code = (lab_test.get("lab_test_group") or "").strip()
		if group_code:
			if group_code not in group_name_cache:
				group_name_cache[group_code] = (
					frappe.db.get_value("Lab Test Template", group_code, "lab_test_name") or group_code
				)
			lab_test["lab_test_group_name"] = group_name_cache[group_code]

	_attach_lab_test_sampling_dates(lab_tests)

	service_requests = {
		lt.service_request
		for lt in lab_tests
		if cint(lt.get("is_group_lab_test") or 0) and lt.get("service_request")
	}
	if service_requests:
		sr_status_map = {
			row.name: row.status
			for row in frappe.get_all(
				"Service Request",
				filters={"name": ["in", list(service_requests)]},
				fields=["name", "status"],
			)
		}
		for lab_test in lab_tests:
			if cint(lab_test.get("is_group_lab_test") or 0) and lab_test.get("service_request"):
				lab_test["service_request_status"] = sr_status_map.get(lab_test.service_request)

	return lab_tests


def _attach_lab_test_sampling_dates(lab_tests):
	"""Attach sampling / sample-creation dates used by lab report Date columns.

	Priority for ``report_date``:
	1. Sample Collection creation (when a sample is linked)
	2. Sampling date (``sample_collected_date``, or Sample Collection ``collected_time``)
	3. Lab Test ``date``
	"""
	if not lab_tests:
		return lab_tests

	lab_names = [lt.name for lt in lab_tests if lt.get("name")]
	instance_by_lab: dict[str, list[str]] = {}
	if lab_names:
		for row in frappe.get_all(
			"Lab Test Sample Instance",
			filters={"parent": ["in", lab_names], "parenttype": "Lab Test"},
			fields=["parent", "sample_collection"],
		):
			sc = (row.get("sample_collection") or "").strip()
			if not sc:
				continue
			instance_by_lab.setdefault(row.parent, []).append(sc)

	sample_ids = set()
	for lt in lab_tests:
		sample = (lt.get("sample") or "").strip()
		if sample:
			sample_ids.add(sample)
		for sc in instance_by_lab.get(lt.name, []):
			sample_ids.add(sc)

	sample_meta: dict[str, dict] = {}
	if sample_ids:
		for row in frappe.get_all(
			"Sample Collection",
			filters={"name": ["in", list(sample_ids)]},
			fields=["name", "creation", "collected_time"],
		):
			sample_meta[row.name] = {
				"creation": row.get("creation"),
				"collected_time": row.get("collected_time"),
			}

	for lt in lab_tests:
		linked_samples = []
		sample = (lt.get("sample") or "").strip()
		if sample:
			linked_samples.append(sample)
		for sc in instance_by_lab.get(lt.name, []):
			if sc not in linked_samples:
				linked_samples.append(sc)

		sample_creation = None
		sample_collected_time = None
		for sid in linked_samples:
			meta = sample_meta.get(sid) or {}
			if not sample_creation and meta.get("creation"):
				sample_creation = meta.get("creation")
			if not sample_collected_time and meta.get("collected_time"):
				sample_collected_time = meta.get("collected_time")

		sampling_date = (lt.get("sample_collected_date") or "").strip() or sample_collected_time
		lt["sample_creation"] = sample_creation
		lt["sampling_date"] = sampling_date or None

		if sample_creation:
			lt["report_date"] = sample_creation
		elif sampling_date:
			lt["report_date"] = sampling_date
		else:
			lt["report_date"] = lt.get("date") or lt.get("result_date") or lt.get("submitted_date")

	return lab_tests


def _group_scope_filters(filters):
	"""Scope filters for fetching all siblings in a grouped lab request (no status/date)."""
	scope_keys = (
		"patient",
		"practitioner",
		"cost_center",
		"template",
		"lab_test_group",
		"is_outsourced",
		"docstatus",
	)
	return {key: filters[key] for key in scope_keys if key in filters}


def _nurse_lab_test_template_names(by_nurse):
	"""Templates allowed when filtering by Lab Test Template.by_nurse. None = no nurse filter."""
	if by_nurse is None:
		return None
	if isinstance(by_nurse, str):
		by_nurse = by_nurse.lower() in ("1", "true", "yes")
	if not by_nurse:
		return frappe.get_all(
			"Lab Test Template",
			filters={"by_nurse": 0},
			pluck="name",
		)
	from healthcare.api.common import _by_nurse_lab_test_template_names

	return _by_nurse_lab_test_template_names()


def _build_template_match_or_filters(template):
	"""OR conditions on Lab Test for a template filter (doc name or test name)."""
	if frappe.db.exists("Lab Test Template", template):
		is_group = cint(frappe.db.get_value("Lab Test Template", template, "is_group") or 0)
		if is_group:
			return [
				["template", "=", template],
				["lab_test_group", "=", template],
			]
		label = (frappe.db.get_value("Lab Test Template", template, "lab_test_name") or "").strip()
		or_filters = [["template", "=", template]]
		if label and label != template:
			or_filters.append(["lab_test_name", "=", label])
		return or_filters
	return [
		["template", "=", template],
		["lab_test_name", "=", template],
	]


def _resolve_lab_test_names_for_template_filter(template, base_filters):
	"""Lab Test document names matching template picker (direct, group parent/child, legacy lines)."""
	template = (template or "").strip()
	if not template:
		return None

	match_filters = {k: v for k, v in base_filters.items() if k != "name"}
	names = set()

	or_conditions = _build_template_match_or_filters(template)
	if or_conditions:
		names.update(
			frappe.get_all(
				"Lab Test",
				filters=match_filters,
				or_filters=or_conditions,
				pluck="name",
				limit=0,
			)
		)

	# Legacy import rows store the child template on Lab Test Line.lab_sub_num
	line_parents = frappe.get_all(
		"Lab Test Line",
		filters={"lab_sub_num": template, "parenttype": "Lab Test"},
		pluck="parent",
		limit=0,
	)
	if line_parents:
		parent_ids = list({p for p in line_parents if p})
		if parent_ids:
			legacy_filters = dict(match_filters)
			legacy_filters["name"] = ["in", parent_ids]
			names.update(
				frappe.get_all("Lab Test", filters=legacy_filters, pluck="name", limit=0)
			)

	# Match display name on Lab Test when template link differs from visible test name
	if frappe.db.exists("Lab Test Template", template):
		label = (frappe.db.get_value("Lab Test Template", template, "lab_test_name") or "").strip()
		if label:
			names.update(
				frappe.get_all(
					"Lab Test",
					filters=match_filters,
					or_filters=[["lab_test_name", "=", label]],
					pluck="name",
					limit=0,
				)
			)

	return list(names)


def _apply_lab_test_template_list_filter(filters, template, nurse_templates=None):
	"""Apply template filter. Returns (or_filters, is_empty)."""
	if not template:
		if nurse_templates is not None:
			if not nurse_templates:
				return [], True
			filters["template"] = ["in", nurse_templates]
		return [], False

	if nurse_templates is not None:
		nurse_set = set(nurse_templates)
		if frappe.db.exists("Lab Test Template", template):
			if template not in nurse_set:
				return [], True
		else:
			nurse_labels = {
				(frappe.db.get_value("Lab Test Template", name, "lab_test_name") or name).strip()
				for name in nurse_templates
			}
			if template not in nurse_labels:
				return [], True

	return _build_template_match_or_filters(template), False


@frappe.whitelist()
def get_lab_test_template_filter_options(search=None, patient=None, by_nurse=None):
	"""Template picker for Lab Test listing — same master list as Lab Test Templates tab."""
	from healthcare.api.common import get_lab_test_templates, get_lab_test_templates_admin_list

	if by_nurse is not None:
		if isinstance(by_nurse, str):
			by_nurse = by_nurse.lower() in ("1", "true", "yes")
		if by_nurse:
			rows = get_lab_test_templates(search=search, by_nurse=True)
			return [
				{
					"name": r["name"],
					"label": r.get("label") or r["name"],
					"is_group": cint(r.get("is_group") or 0),
				}
				for r in rows
			]

	rows = get_lab_test_templates_admin_list(search=search)
	return [
		{
			"name": row.name,
			"label": row.lab_test_name or row.name,
			"lab_test_code": getattr(row, "lab_test_code", None),
			"is_group": cint(getattr(row, "is_group", 0) or 0),
		}
		for row in rows
	]


def _expand_grouped_lab_test_siblings(lab_tests, filters):
	"""When any grouped child matches, include all siblings under the same service request."""
	group_srs = {
		lt.service_request
		for lt in lab_tests
		if int(lt.get("is_group_lab_test") or 0) == 1 and lt.get("service_request")
	}
	if not group_srs:
		return lab_tests

	existing = {lt.name for lt in lab_tests}
	sibling_filters = _group_scope_filters(filters)
	sibling_filters["service_request"] = ["in", list(group_srs)]
	sibling_filters["is_group_lab_test"] = 1

	siblings = frappe.get_all(
		"Lab Test",
		filters=sibling_filters,
		fields=_LAB_TEST_LIST_FIELDS,
		order_by="creation asc",
	)
	new_rows = [row for row in siblings if row.name not in existing]
	if not new_rows:
		return lab_tests

	return lab_tests + new_rows


def _lab_test_has_results_entered(lab_test):
	return (lab_test.get("status") or "").strip() in LAB_RESULTS_ENTERED_STATUSES


def _filter_pending_pipeline_lab_tests(lab_tests, selected_status=None):
	"""Keep in-pipeline tests; drop completed singles and fully completed groups.

	When a specific status tab is selected on the Lab Request screen, re-apply that
	status after grouped-request sibling expansion so mixed-status groups do not
	leak unrelated child rows into the filtered result.
	"""
	selected_status = (selected_status or "").strip()

	by_service_request = {}
	for lt in lab_tests:
		if cint(lt.get("is_group_lab_test") or 0) == 1 and lt.get("service_request"):
			by_service_request.setdefault(lt["service_request"], []).append(lt)

	filtered = []
	seen_service_requests = set()
	for lt in lab_tests:
		if cint(lt.get("is_group_lab_test") or 0) == 1 and lt.get("service_request"):
			service_request = lt["service_request"]
			if service_request in seen_service_requests:
				continue
			seen_service_requests.add(service_request)
			children = by_service_request.get(service_request, [])
			if any(not _lab_test_has_results_entered(child) for child in children):
				if selected_status:
					filtered.extend(
						child
						for child in children
						if (child.get("status") or "").strip() == selected_status
					)
				else:
					filtered.extend(children)
			continue
		if not _lab_test_has_results_entered(lt):
			if selected_status and (lt.get("status") or "").strip() != selected_status:
				continue
			filtered.append(lt)
	return filtered


def _lab_test_display_key(lt):
	"""UI collapses grouped children under one Service Request into a single row."""
	if cint(lt.get("is_group_lab_test") or 0) == 1 and lt.get("service_request"):
		return f"sr:{lt.service_request}"
	return f"lt:{lt.name}"


def _paginate_lab_tests_by_display_unit(filters, or_filters, limit, offset):
	"""Page by visible list rows (1 group SR = 1 unit), not raw Lab Test child rows.

	Without this, a large recent group (e.g. 36 urine lines) fills the whole first
	page and the UI shows a single GROUP row even though thousands of tests exist.
	"""
	limit = max(cint(limit), 1)
	offset = max(cint(offset), 0)

	index_rows = frappe.get_all(
		"Lab Test",
		filters=filters,
		or_filters=or_filters or None,
		fields=["name", "creation", "service_request", "is_group_lab_test"],
		order_by="creation desc",
		limit=0,
	)

	# Preserve newest-first order; first occurrence of each display key wins.
	ordered_keys = []
	seen = set()
	for row in index_rows:
		key = _lab_test_display_key(row)
		if key in seen:
			continue
		seen.add(key)
		ordered_keys.append(key)

	total_count = len(ordered_keys)
	page_keys = ordered_keys[offset : offset + limit]
	if not page_keys:
		return [], total_count

	page_srs = [k[3:] for k in page_keys if k.startswith("sr:")]
	page_names = [k[3:] for k in page_keys if k.startswith("lt:")]

	lab_tests = []
	if page_srs:
		group_filters = dict(filters)
		group_filters["service_request"] = ["in", page_srs]
		group_filters["is_group_lab_test"] = 1
		lab_tests.extend(
			frappe.get_all(
				"Lab Test",
				filters=group_filters,
				or_filters=or_filters or None,
				fields=_LAB_TEST_LIST_FIELDS,
				order_by="creation desc",
			)
		)
	if page_names:
		standalone_filters = dict(filters)
		standalone_filters["name"] = ["in", page_names]
		lab_tests.extend(
			frappe.get_all(
				"Lab Test",
				filters=standalone_filters,
				or_filters=or_filters or None,
				fields=_LAB_TEST_LIST_FIELDS,
				order_by="creation desc",
			)
		)

	# Keep page order: groups/standalones in the same sequence as page_keys.
	by_key = {}
	for lt in lab_tests:
		key = _lab_test_display_key(lt)
		by_key.setdefault(key, []).append(lt)

	ordered = []
	for key in page_keys:
		ordered.extend(by_key.get(key) or [])

	return ordered, total_count


@frappe.whitelist()
def get_lab_tests(
	limit=50,
	offset=0,
	patient=None,
	status=None,
	pending_review=False,
	pipeline_pending=False,
	is_outsourced=None,
	from_date=None,
	to_date=None,
	template=None,
	patient_type=None,
	practitioner=None,
	by_nurse=None,
):
	"""Get list of Lab Tests with optional filters (patient, status, date range, practitioner, template, outsourcing)."""
	from healthcare.api.common import get_permitted_cost_centers
	filters = {"docstatus": ["!=", 2]}  # Exclude cancelled

	if patient:
		filters["patient"] = patient

	if status:
		filters["status"] = status

	if pending_review:
		filters["status"] = ["in", ["Pending Review", "Submitted"]]
	elif cint(pipeline_pending):
		filters["status"] = ["in", list(LAB_PENDING_PIPELINE_STATUSES)]

	if is_outsourced is not None:
		if isinstance(is_outsourced, str):
			is_outsourced = is_outsourced == "1"
		filters["is_outsourced"] = 1 if is_outsourced else 0

	nurse_templates = _nurse_lab_test_template_names(by_nurse)
	or_filters, template_empty = _apply_lab_test_template_list_filter(
		filters, template, nurse_templates
	)
	if template_empty:
		return {"data": [], "total_count": 0}

	if template:
		matched_names = _resolve_lab_test_names_for_template_filter(template, filters)
		if not matched_names:
			return {"data": [], "total_count": 0}
		filters["name"] = ["in", matched_names]
		or_filters = []

	# OP / IP filter based on inpatient_record link (legacy; prefer practitioner filter in portal)
	if patient_type == "IP":
		filters["inpatient_record"] = ["is", "set"]
	elif patient_type == "OP":
		filters["inpatient_record"] = ["is", "not set"]

	if practitioner:
		filters["practitioner"] = practitioner
	
	# Date range filter — apply on the order/registration date (creation), which is always
	# present. Filtering on result_date emptied every pre-result worklist tab (Requested /
	# Sample Collected / Testing in Progress) because those tests have no result date yet.
	if from_date or to_date:
		start = frappe.utils.get_datetime(from_date) if from_date else frappe.utils.get_datetime("1900-01-01")
		end = (
			frappe.utils.get_datetime(to_date).replace(hour=23, minute=59, second=59)
			if to_date
			else frappe.utils.now_datetime()
		)
		filters["creation"] = ["between", [start, end]]

	# ── Cost-centre User Permission enforcement ──────────────────────────────
	permitted_cc = get_permitted_cost_centers()
	if permitted_cc is not None:
		if not permitted_cc:
			return {"data": [], "total_count": 0}
		filters["cost_center"] = ["in", permitted_cc]

	if cint(pipeline_pending):
		pending_rows = frappe.get_all(
			"Lab Test",
			filters=filters,
			or_filters=or_filters or None,
			fields=_LAB_TEST_LIST_FIELDS,
			order_by="creation desc",
			limit=0,
		)
		pending_rows = _expand_grouped_lab_test_siblings(pending_rows, filters)
		pending_rows = _filter_pending_pipeline_lab_tests(pending_rows, status)
		total_count = len(pending_rows)
		lab_tests = pending_rows[cint(offset) : cint(offset) + cint(limit)]
	else:
		# Page by visible rows (group = 1) so a large group cannot monopolise the page.
		lab_tests, total_count = _paginate_lab_tests_by_display_unit(
			filters, or_filters, limit, offset
		)

	template_cache = {}
	_enrich_lab_test_rows(lab_tests, template_cache)
	_attach_legacy_lab_test_lines(lab_tests)
	return {"data": lab_tests, "total_count": total_count}

# def _calculate_result_flag(result_value, patient_gender, female_min_range=None, female_max_range=None, 
#                            male_min_range=None, male_max_range=None, min_range=None, max_range=None):
#     """Calculate result flag based on value and reference ranges.
    
#     Returns:
#         str: One of 'Normal', 'High', 'Low', 'Critically High', 'Critically Low', or empty string
#     """
#     if not result_value:
#         return ""
    
#     # Try to convert result value to float
#     try:
#         val = float(result_value)
#     except (TypeError, ValueError):
#         # If it's not a numeric value, return empty (qualitative results handled separately)
#         return ""
    
#     # Select appropriate ranges based on patient gender
#     if patient_gender == "Female":
#         min_range = female_min_range if female_min_range is not None else min_range
#         max_range = female_max_range if female_max_range is not None else max_range
#     elif patient_gender == "Male":
#         min_range = male_min_range if male_min_range is not None else min_range
#         max_range = male_max_range if male_max_range is not None else max_range
    
#     # Check if we have valid ranges to compare against
#     if min_range is not None and max_range is not None:
#         # Check for critical values (2x normal range or 0.5x normal range)
#         if val > max_range * 2:
#             return "Critically High"
#         if val < min_range * 0.5:
#             return "Critically Low"
        
#         # Check normal range
#         if val > max_range:
#             return "High"
#         if val < min_range:
#             return "Low"
        
#         return "Normal"
    
#     # No valid ranges available
#     return ""

def _calculate_result_flag(result_value, patient_gender, female_min_range=None, female_max_range=None, 
                           male_min_range=None, male_max_range=None, min_range=None, max_range=None):
    """Calculate result flag based on value and reference ranges."""
    if not result_value:
        return ""
    
    # Try to convert result value to float
    try:
        val = float(result_value)
    except (TypeError, ValueError):
        return ""
    
    # Convert ranges to float, handling None and string values
    def to_float(val):
        if val is None:
            return None
        try:
            return float(val)
        except (TypeError, ValueError):
            return None
    
    # Select ranges based on patient gender
    if patient_gender == "Female":
        min_val = to_float(female_min_range) or to_float(min_range)
        max_val = to_float(female_max_range) or to_float(max_range)
    elif patient_gender == "Male":
        min_val = to_float(male_min_range) or to_float(min_range)
        max_val = to_float(male_max_range) or to_float(max_range)
    else:
        min_val = to_float(min_range)
        max_val = to_float(max_range)
    
    # Check if we have valid ranges
    if min_val is not None and max_val is not None:
        # Critical values (2x normal range or 0.5x normal range)
        if val > max_val * 2:
            return "Critically High"
        if val < min_val * 0.5:
            return "Critically Low"
        
        # Normal range check
        if val > max_val:
            return "High"
        if val < min_val:
            return "Low"
        
        return "Normal"
    
    return ""

def _parse_normal_range_text(normal_range):
	"""Parse '12.0 - 16.0' style normal range text into (min, max)."""
	if not normal_range:
		return None, None
	import re
	text = str(normal_range).strip()
	match = re.search(r"([\d.]+)\s*[-–]\s*([\d.]+)", text)
	if not match:
		return None, None
	try:
		return float(match.group(1)), float(match.group(2))
	except (TypeError, ValueError):
		return None, None


def _to_float_range(val):
	if val is None or val == "":
		return None
	try:
		return float(val)
	except (TypeError, ValueError):
		return None


def _reference_range_bounds(
	patient_gender=None,
	*,
	female_min_range=None,
	female_max_range=None,
	male_min_range=None,
	male_max_range=None,
	min_range=None,
	max_range=None,
	normal_range=None,
):
	"""Resolve min/max reference bounds from template fields and/or normal_range text."""
	gender = (patient_gender or "").strip()
	if gender == "Female":
		min_val = _to_float_range(female_min_range) or _to_float_range(min_range)
		max_val = _to_float_range(female_max_range) or _to_float_range(max_range)
	elif gender == "Male":
		min_val = _to_float_range(male_min_range) or _to_float_range(min_range)
		max_val = _to_float_range(male_max_range) or _to_float_range(max_range)
	else:
		min_val = _to_float_range(min_range)
		max_val = _to_float_range(max_range)

	if min_val is None or max_val is None:
		parsed_min, parsed_max = _parse_normal_range_text(normal_range)
		if min_val is None:
			min_val = parsed_min
		if max_val is None:
			max_val = parsed_max
	return min_val, max_val


def _matrix_cell_eval(
	result_value,
	normal_range=None,
	*,
	patient_gender=None,
	female_min_range=None,
	female_max_range=None,
	male_min_range=None,
	male_max_range=None,
	min_range=None,
	max_range=None,
):
	"""Return flag + optional direction for matrix cell colouring."""
	neutral = {"flag": "neutral", "direction": None}
	if result_value is None or str(result_value).strip() == "":
		return neutral
	try:
		val = float(result_value)
	except (TypeError, ValueError):
		# Non-numeric text (e.g. "Positive") — leave uncoloured.
		return neutral
	min_val, max_val = _reference_range_bounds(
		patient_gender,
		female_min_range=female_min_range,
		female_max_range=female_max_range,
		male_min_range=male_min_range,
		male_max_range=male_max_range,
		min_range=min_range,
		max_range=max_range,
		normal_range=normal_range,
	)
	if min_val is None or max_val is None:
		return neutral
	if val < min_val:
		return {"flag": "abnormal", "direction": "low"}
	if val > max_val:
		return {"flag": "abnormal", "direction": "high"}
	return {"flag": "normal", "direction": None}


def _matrix_cell_eval_from_template_info(result_value, patient_gender, tpl_info, normal_range=None):
	return _matrix_cell_eval(
		result_value,
		normal_range,
		patient_gender=patient_gender,
		female_min_range=tpl_info.get("female_min_range"),
		female_max_range=tpl_info.get("female_max_range"),
		male_min_range=tpl_info.get("male_min_range"),
		male_max_range=tpl_info.get("male_max_range"),
		min_range=tpl_info.get("min_range"),
		max_range=tpl_info.get("max_range"),
	)


def _matrix_cell_from_result_flag(result_flag: str):
	flag_text = (result_flag or "").strip()
	if not flag_text or flag_text == "Normal" or flag_text == "Sufficiency":
		return {"flag": "normal", "direction": None}
	direction = None
	if flag_text in ("High", "Critically High", "Toxicity"):
		direction = "high"
	elif flag_text in ("Low", "Critically Low", "Deficiency", "Insuficiency"):
		direction = "low"
	return {"flag": "abnormal", "direction": direction}


def _matrix_history_cell(value, lab_test_name, cell_eval: dict):
	return {
		"value": value,
		"flag": cell_eval.get("flag") or "neutral",
		"direction": cell_eval.get("direction"),
		"lab_test": lab_test_name,
	}


def _template_analyte_cache(template_name: str, cache: dict) -> dict:
	"""Map template + event codes to human-readable analyte / panel names."""
	key = (template_name or "").strip()
	if not key:
		return {"panel_name": "", "events": {}}
	if key in cache:
		return cache[key]

	panel_name = (
		frappe.db.get_value("Lab Test Template", key, "lab_test_name")
		or frappe.db.get_value("Lab Test Template", key, "lab_test_code")
		or key
	)
	events: dict[str, str] = {}
	if frappe.db.exists("Lab Test Template", key):
		for row in frappe.get_all(
			"Normal Test Template",
			filters={"parent": key, "parenttype": "Lab Test Template"},
			fields=["lab_test_event"],
			order_by="idx asc",
		):
			event = (row.lab_test_event or "").strip()
			if not event:
				continue
			# lab_test_event is the stored analyte label (e.g. WBC) when configured on the template
			events[event.lower()] = event

	cache[key] = {"panel_name": panel_name, "events": events}
	return cache[key]


def _lab_test_template_info(template_id: str, cache: dict) -> dict:
	"""Resolve Lab Test Template display name and reference ranges (legacy lab_sub_num)."""
	empty = {
		"name": "",
		"lab_test_normal_range": "",
		"female_min_range": None,
		"female_max_range": None,
		"male_min_range": None,
		"male_max_range": None,
		"min_range": None,
		"max_range": None,
	}
	key = (template_id or "").strip()
	if not key:
		return empty
	if key in cache:
		return cache[key]

	info = {**empty, "name": key}
	if frappe.db.exists("Lab Test Template", key):
		row = frappe.db.get_value(
			"Lab Test Template",
			key,
			[
				"lab_test_name",
				"lab_test_code",
				"lab_test_normal_range",
				"female_min_range",
				"female_max_range",
				"male_min_range",
				"male_max_range",
				"min_range",
				"max_range",
			],
			as_dict=True,
		)
		if row:
			info["name"] = row.lab_test_name or row.lab_test_code or key
			info["lab_test_normal_range"] = (row.lab_test_normal_range or "").strip()
			info["female_min_range"] = row.female_min_range
			info["female_max_range"] = row.female_max_range
			info["male_min_range"] = row.male_min_range
			info["male_max_range"] = row.male_max_range
			info["min_range"] = row.min_range
			info["max_range"] = row.max_range
	cache[key] = info
	return info


def _format_minmax_range(lo, hi):
	has_lo = lo is not None and cstr(lo).strip() != ""
	has_hi = hi is not None and cstr(hi).strip() != ""
	if not has_lo and not has_hi:
		return ""
	return f"{lo if has_lo else '—'} – {hi if has_hi else '—'}"


def _format_template_normal_range_for_patient(tpl_info: dict, patient_sex: str | None = None) -> str:
	"""Human-readable reference range for a lab_test_lines row (view modal)."""
	text = (tpl_info.get("lab_test_normal_range") or "").strip()
	if text:
		return text

	sex = (patient_sex or "").strip().lower()
	if sex.startswith("f"):
		formatted = _format_minmax_range(tpl_info.get("female_min_range"), tpl_info.get("female_max_range"))
		if formatted:
			return formatted
	elif sex.startswith("m"):
		formatted = _format_minmax_range(tpl_info.get("male_min_range"), tpl_info.get("male_max_range"))
		if formatted:
			return formatted

	formatted = _format_minmax_range(tpl_info.get("min_range"), tpl_info.get("max_range"))
	if formatted:
		return formatted

	return _format_multiple_result_normal_range(
		tpl_info.get("male_min_range"),
		tpl_info.get("male_max_range"),
		tpl_info.get("female_min_range"),
		tpl_info.get("female_max_range"),
	)


def _lab_test_template_name(template_id: str, cache: dict) -> str:
	return (_lab_test_template_info(template_id, cache).get("name") or "").strip()


def _history_analyte_label(
	template_name: str,
	event_code: str,
	*,
	fallback_name: str = "",
	template_cache: dict,
) -> str:
	"""Prefer Lab Test Template analyte / panel name (e.g. WBC) over Oracle codes."""
	info = _template_analyte_cache(template_name, template_cache)
	code = (event_code or "").strip()
	fallback = (fallback_name or "").strip()

	if code:
		resolved = info["events"].get(code.lower())
		if resolved and resolved.lower() != code.lower():
			return resolved
		# Oracle-style codes (LAB-013-001) — use template panel name or Excel group name
		if code.upper().startswith("LAB-") and "-" in code[4:]:
			panel = (info.get("panel_name") or "").strip()
			if panel and panel.lower() != code.lower():
				return panel
			if fallback and fallback.lower() != code.lower():
				return fallback

	panel = (info.get("panel_name") or "").strip()
	if panel and (not code or panel.lower() != code.lower()):
		return panel
	if fallback:
		return fallback
	return code or panel or (template_name or "")


@frappe.whitelist()
def get_lab_test_history_matrix(
	patient=None,
	from_date=None,
	to_date=None,
	test_search=None,
	template=None,
):
	"""Pivot lab results for a patient: rows = test parameters, columns = result dates."""
	from datetime import timedelta

	from frappe.utils import format_timedelta, getdate

	from healthcare.api.common import get_permitted_cost_centers

	patient = (patient or "").strip()
	if not patient:
		frappe.throw(_("Patient is required"))

	permitted_cc = get_permitted_cost_centers()
	filters = {"patient": patient, "docstatus": ["!=", 2]}
	if template:
		filters["template"] = template
	if permitted_cc is not None:
		if not permitted_cc:
			return {"columns": [], "rows": [], "patient": patient, "patient_name": None}
		filters["cost_center"] = ["in", permitted_cc]

	lab_tests = frappe.get_all(
		"Lab Test",
		filters=filters,
		fields=[
			"name",
			"lab_test_name",
			"template",
			"status",
			"result_date",
			"date",
			"time",
			"creation",
			"custom_result",
			"results",
			"result_flag",
			"is_legacy_import",
			"lab_test_group",
			"is_group_lab_test",
			"service_request",
		],
		order_by="result_date asc, creation asc",
	)

	legacy_names = [lt.name for lt in lab_tests if cint(lt.get("is_legacy_import"))]
	legacy_lines_by_parent: dict[str, list] = {}
	if legacy_names:
		for row in frappe.get_all(
			"Lab Test Line",
			filters={"parent": ["in", legacy_names], "parenttype": "Lab Test"},
			fields=[
				"parent",
				"lab_group_num",
				"group_name",
				"lab_sub_num",
				"lab_result_value",
				"sr_num",
			],
			order_by="parent asc, sr_num asc, idx asc",
		):
			parent = row.pop("parent", None)
			if parent:
				legacy_lines_by_parent.setdefault(parent, []).append(row)

	patient_name = frappe.db.get_value("Patient", patient, "patient_name")
	patient_gender = frappe.db.get_value("Patient", patient, "sex") or ""
	search_term = (test_search or "").strip().lower()

	group_name_cache: dict[str, str] = {}

	def _group_display_name(group_code: str) -> str:
		code = (group_code or "").strip()
		if not code:
			return ""
		if code not in group_name_cache:
			group_name_cache[code] = (
				frappe.db.get_value("Lab Test Template", code, "lab_test_name") or code
			)
		return group_name_cache[code] or ""

	def _lab_test_matches_search(lt) -> bool:
		"""True when search matches this lab test / its panel group (e.g. CBC)."""
		if not search_term:
			return True
		candidates = [
			(lt.lab_test_name or "").strip(),
			(lt.template or "").strip(),
			(lt.name or "").strip(),
			(lt.lab_test_group or "").strip(),
			_group_display_name(lt.lab_test_group or ""),
		]
		return any(search_term in c.lower() for c in candidates if c)

	def _format_time(value):
		if not value:
			return ""
		if isinstance(value, timedelta):
			return format_timedelta(value)
		return str(value).strip()

	def _effective_date(lt):
		raw = lt.result_date or lt.date
		if not raw and lt.creation:
			raw = getdate(lt.creation)
		if not raw:
			return None
		return getdate(raw)

	lab_tests.sort(key=lambda lt: (_effective_date(lt) or getdate("1900-01-01"), str(lt.creation or "")))

	from_d = getdate(from_date) if from_date else None
	to_d = getdate(to_date) if to_date else None

	# Apply date range on effective date
	if from_d or to_d:
		filtered = []
		for lt in lab_tests:
			eff = _effective_date(lt)
			if not eff:
				continue
			if from_d and eff < from_d:
				continue
			if to_d and eff > to_d:
				continue
			filtered.append(lt)
		lab_tests = filtered

	columns_by_date: dict[str, dict] = {}
	rows_map = {}
	template_cache: dict[str, dict] = {}
	template_info_cache: dict[str, dict] = {}

	def _ensure_row(row_key, label, uom="", group_key="", group_label=""):
		gk = (group_key or "").strip()
		gl = (group_label or "").strip()
		if row_key not in rows_map:
			rows_map[row_key] = {
				"key": row_key,
				"label": label,
				"uom": uom or "",
				"group_key": gk,
				"group_label": gl,
				"cells": {},
			}
		else:
			row = rows_map[row_key]
			if gk and not (row.get("group_key") or "").strip():
				row["group_key"] = gk
				row["group_label"] = gl
			if label and (not row.get("label") or len(label) > len(row.get("label") or "")):
				row["label"] = label
			if uom and not row.get("uom"):
				row["uom"] = uom
		return rows_map[row_key]

	for lt in lab_tests:
		eff_date = _effective_date(lt)
		if not eff_date:
			continue
		lt_matches_search = _lab_test_matches_search(lt)
		# Skip whole documents that don't match the test/group search at all —
		# unless search is empty (show everything).
		# Analyte-level matching still applies below when the parent doesn't match.
		col_key = str(eff_date)
		if col_key not in columns_by_date:
			columns_by_date[col_key] = {
				"key": col_key,
				"date": col_key,
				"time": _format_time(lt.time),
				"lab_test": lt.name,
				"lab_test_name": lt.lab_test_name or lt.template or lt.name,
				"status": lt.status,
			}
		else:
			# Same calendar day — keep one column; prefer latest time for header hint.
			col = columns_by_date[col_key]
			lt_time = _format_time(lt.time)
			if lt_time:
				col["time"] = lt_time
			col["lab_test"] = lt.name
			col["lab_test_name"] = lt.lab_test_name or lt.template or lt.name
			col["status"] = lt.status

		panel_group_key = (lt.lab_test_group or "").strip()
		panel_group_label = _group_display_name(panel_group_key) if panel_group_key else ""

		items = frappe.get_all(
			"Normal Test Result",
			filters={"parent": lt.name, "parenttype": "Lab Test"},
			fields=[
				"lab_test_name",
				"lab_test_event",
				"result_value",
				"lab_test_uom",
				"normal_range",
			],
			order_by="idx asc",
		)

		legacy_lines = legacy_lines_by_parent.get(lt.name) or []

		if legacy_lines:
			for line in legacy_lines:
				sub_template = (line.get("lab_sub_num") or "").strip()
				tpl_info = _lab_test_template_info(sub_template, template_info_cache)
				label = (tpl_info.get("name") or sub_template).strip()
				if not label:
					continue
				line_group_key = (line.get("lab_group_num") or panel_group_key or "").strip()
				line_group_label = (
					(line.get("group_name") or "").strip()
					or _group_display_name(line_group_key)
					or panel_group_label
				)
				if search_term and not lt_matches_search:
					group_name = (line.get("group_name") or "").strip()
					if search_term not in label.lower():
						if sub_template and search_term in sub_template.lower():
							pass
						elif group_name and search_term in group_name.lower():
							pass
						elif line_group_label and search_term in line_group_label.lower():
							pass
						else:
							continue
				# One history row per child line (lab_sub_num = Lab Test Template).
				sr_num = line.get("sr_num")
				if sub_template:
					row_key = sub_template.lower()
				elif sr_num is not None and sr_num != "":
					row_key = f"{lt.name}::sr::{sr_num}".lower()
				else:
					row_key = f"{lt.name}::line::{len(rows_map)}".lower()
				_ensure_row(row_key, label, group_key=line_group_key, group_label=line_group_label)
				value = (line.get("lab_result_value") or "").strip()
				if value:
					cell_eval = _matrix_cell_eval_from_template_info(value, patient_gender, tpl_info)
					rows_map[row_key]["cells"][col_key] = _matrix_history_cell(value, lt.name, cell_eval)
		elif items:
			item_group_key = panel_group_key
			item_group_label = panel_group_label
			# Compound panel on one Lab Test doc (e.g. CBC with many Normal Test Results).
			if not item_group_key and len(items) > 1:
				item_group_key = (lt.template or lt.name or "").strip()
				item_group_label = (lt.lab_test_name or item_group_key).strip()
			for item in items:
				tpl_key = (lt.template or "").strip()
				tpl_info = _lab_test_template_info(tpl_key, template_info_cache) if tpl_key else {}
				event_code = (item.lab_test_event or "").strip()
				label_base = _history_analyte_label(
					tpl_key,
					event_code,
					fallback_name=item.lab_test_name or "",
					template_cache=template_cache,
				)
				if not label_base:
					continue
				if search_term and not lt_matches_search:
					if search_term not in label_base.lower():
						if event_code and search_term in event_code.lower():
							pass
						elif tpl_key and search_term in tpl_key.lower():
							pass
						elif item_group_label and search_term in item_group_label.lower():
							pass
						else:
							continue
				uom = (item.lab_test_uom or "").strip()
				row_key = label_base.lower()
				label = f"{label_base} ({uom})" if uom else label_base
				_ensure_row(
					row_key,
					label,
					uom=uom,
					group_key=item_group_key,
					group_label=item_group_label,
				)
				value = (item.result_value or "").strip()
				if value:
					cell_eval = _matrix_cell_eval_from_template_info(
						value, patient_gender, tpl_info, item.normal_range
					)
					rows_map[row_key]["cells"][col_key] = _matrix_history_cell(value, lt.name, cell_eval)
		else:
			tpl_key = (lt.template or "").strip()
			tpl_info = _lab_test_template_info(tpl_key, template_info_cache) if tpl_key else {}
			label_base = _history_analyte_label(
				tpl_key,
				"",
				fallback_name=lt.lab_test_name or "",
				template_cache=template_cache,
			)
			if not label_base:
				label_base = (lt.lab_test_name or lt.template or lt.name or "").strip()
			if not label_base:
				continue
			if search_term and not lt_matches_search and search_term not in label_base.lower():
				if not (panel_group_label and search_term in panel_group_label.lower()):
					continue
			row_key = label_base.lower()
			_ensure_row(
				row_key,
				label_base,
				group_key=panel_group_key,
				group_label=panel_group_label,
			)
			value = (lt.custom_result or lt.results or "").strip()
			if value:
				cell_eval = _matrix_cell_eval_from_template_info(value, patient_gender, tpl_info)
				if cell_eval["flag"] == "neutral" and lt.result_flag:
					try:
						float(value)
						cell_eval = _matrix_cell_from_result_flag(lt.result_flag)
					except (TypeError, ValueError):
						pass
				rows_map[row_key]["cells"][col_key] = _matrix_history_cell(value, lt.name, cell_eval)

	rows = sorted(
		rows_map.values(),
		key=lambda r: (
			(r.get("group_label") or r.get("group_key") or "\uffff").lower(),
			(r.get("label") or "").lower(),
		),
	)
	columns = sorted(columns_by_date.values(), key=lambda c: c["date"])

	return {
		"columns": columns,
		"rows": rows,
		"patient": patient,
		"patient_name": patient_name,
	}


@frappe.whitelist()
def get_lab_test(name):
	"""Get single Lab Test by name (includes documents child table)."""
	if not name:
		frappe.throw(_("Lab Test name is required"))

	lab_test = frappe.get_doc('Lab Test', name)
	out = {
		'name': lab_test.name,
		'docstatus': lab_test.docstatus,
		'patient': lab_test.patient,
		'cost_center': lab_test.cost_center,
		'patient_name': lab_test.patient_name,
		'practitioner': lab_test.practitioner,
		'practitioner_name': getattr(lab_test, 'practitioner_name', None),
		'doc_no': getattr(lab_test, 'doc_no', None),
		'lab_test_name': lab_test.lab_test_name,
		'template': lab_test.template,
		'status': lab_test.status,
		'result_date': lab_test.result_date,
		'submitted_date': lab_test.submitted_date,
		'approved_date': getattr(lab_test, 'approved_date', None),
		'invoiced': lab_test.invoiced,
		'department': lab_test.department,
		'service_request': getattr(lab_test, 'service_request', None),
		'lab_test_group': getattr(lab_test, 'lab_test_group', None),
		'is_group_lab_test': cint(getattr(lab_test, 'is_group_lab_test', 0)),
		'custom_result': getattr(lab_test, 'custom_result', None),
		'lab_test_comment': getattr(lab_test, 'lab_test_comment', None),
		'worksheet_instructions': getattr(lab_test, 'worksheet_instructions', None),
		'material_request': getattr(lab_test, 'material_request', None),
		'amount': getattr(lab_test, 'amount', None),
		'discount_margin': getattr(lab_test, 'discount_margin', None),
		'discount': getattr(lab_test, 'discount', None),
		'discount_amount': getattr(lab_test, 'discount_amount', None),
		'grand_total': getattr(lab_test, 'grand_total', None),
		'lab_technician': getattr(lab_test, 'lab_technician', None),
		'lab_technician_name': getattr(lab_test, 'lab_technician_name', None),
		'results_entered_datetime': getattr(lab_test, 'results_entered_datetime', None),
		'doctor_reviewed_datetime': getattr(lab_test, 'doctor_reviewed_datetime', None),
		'review_turnaround_hours': getattr(lab_test, 'review_turnaround_hours', None),
		'review_report_type': getattr(lab_test, 'review_report_type', None),
		'review_result_indicator': getattr(lab_test, 'review_result_indicator', None),
		'review_follow_up_actions': follow_up_labels_from_doc(lab_test),
		'review_follow_up_other': getattr(lab_test, 'review_follow_up_other', None),
		'review_comments': getattr(lab_test, 'review_comments', None),
		'review_prescription_message': getattr(lab_test, 'review_prescription_message', None),
		'patient_informed_of_report': getattr(lab_test, 'patient_informed_of_report', None),
		'archive_report_on_review': getattr(lab_test, 'archive_report_on_review', None),
		'create_task_on_review': getattr(lab_test, 'create_task_on_review', None),
		'reviewed_by': getattr(lab_test, 'reviewed_by', None),
		'reviewed_by_name': (
			frappe.db.get_value('User', lab_test.reviewed_by, 'full_name')
			if getattr(lab_test, 'reviewed_by', None)
			else None
		),
	}
	# Include documents child table (Patient Upload Document)
	documents = getattr(lab_test, 'documents', None) or []
	out['documents'] = [
		{
			'file_name': r.get('document_name') or r.get('file_name'),
			'document_type': r.get('document_type'),
			'transaction_no': r.get('transaction_no'),
			'upload_remarks': r.get('upload_remarks'),
			'document': r.get('document'),
		}
		for r in documents
	]
	# Include remarks child table (Remark)
	remarks_table = getattr(lab_test, 'remarks', None) or []
	out['remarks'] = [{'rrmark': getattr(r, 'rrmark', None) or ''} for r in remarks_table]
	# Include sample_instances child table
	sample_instances = getattr(lab_test, 'sample_instances', None) or []
	out['sample_instances'] = [
		{
			'sample': getattr(r, 'sample', None),
			'sample_qty': getattr(r, 'sample_qty', None),
			'sample_details': getattr(r, 'sample_details', None),
			'sample_collection': getattr(r, 'sample_collection', None),
		}
		for r in sample_instances
	]
	# Include normal_test_items child table (compound test results)
	normal_items = getattr(lab_test, 'normal_test_items', None) or []
	out['normal_test_items'] = [
		{
			'lab_test_name': getattr(r, 'lab_test_name', None) or '',
			'lab_test_event': getattr(r, 'lab_test_event', None) or '',
			'result_value': getattr(r, 'result_value', None) or '',
			'result_status': getattr(r, 'result_status', None) or '',
			'lab_test_uom': getattr(r, 'lab_test_uom', None) or '',
			'normal_range': getattr(r, 'normal_range', None) or '',
			'lab_test_comment': getattr(r, 'lab_test_comment', None) or '',
			'template': getattr(r, 'template', None) or '',
		}
		for r in normal_items
	]
	out['is_legacy_import'] = cint(getattr(lab_test, 'is_legacy_import', 0))
	if out.get('practitioner') and not (out.get('practitioner_name') or '').strip():
		out['practitioner_name'] = (
			frappe.db.get_value('Healthcare Practitioner', out['practitioner'], 'practitioner_name')
			or out['practitioner']
		)
	_apply_doc_no_practitioner_fallback(out)
	line_rows = getattr(lab_test, 'lab_test_lines', None) or []
	template_info_cache: dict[str, dict] = {}
	patient_sex = (
		(getattr(lab_test, 'patient_sex', None) or getattr(lab_test, 'gender', None) or '')
	).strip()
	if not patient_sex and lab_test.patient:
		patient_sex = (
			frappe.db.get_value('Patient', lab_test.patient, 'sex')
			or frappe.db.get_value('Patient', lab_test.patient, 'gender')
			or ''
		)
	out['lab_test_lines'] = []
	for r in line_rows:
		sub = (getattr(r, 'lab_sub_num', None) or '').strip()
		tpl_info = _lab_test_template_info(sub, template_info_cache) if sub else {}
		out['lab_test_lines'].append(
			{
				'sr_num': getattr(r, 'sr_num', None) or '',
				'lab_group_num': getattr(r, 'lab_group_num', None) or '',
				'group_name': getattr(r, 'group_name', None) or '',
				'lab_sub_num': sub,
				'lab_sub_template_name': (tpl_info.get('name') or '').strip() if sub else '',
				'lab_result_value': getattr(r, 'lab_result_value', None) or '',
				'normal_range': _format_template_normal_range_for_patient(tpl_info, patient_sex) if sub else '',
				'lab_amt_book': getattr(r, 'lab_amt_book', None),
				'lab_amt_add': getattr(r, 'lab_amt_add', None),
				'lab_amt_disc': getattr(r, 'lab_amt_disc', None),
				'lab_amt_net': getattr(r, 'lab_amt_net', None),
				'sta_flg': getattr(r, 'sta_flg', None),
				'cr_id': getattr(r, 'cr_id', None) or '',
				'cr_date': getattr(r, 'cr_date', None) or '',
				'up_id': getattr(r, 'up_id', None) or '',
				'up_date': getattr(r, 'up_date', None) or '',
				'lab_04_remarks': getattr(r, 'lab_04_remarks', None) or '',
			}
		)
	return out


@frappe.whitelist()
def create_lab_material_request(items, company=None, schedule_date=None, cost_center=None, is_medical=None):
	"""Create a Material Request for lab consumables.

	`items` is expected to be a JSON list of objects with:
	- item_code
	- qty
	- warehouse (optional)

	The Material Request purpose is always **Purchase** — lab mini-warehouse
	requests are procurement indents raised against stores.

	``is_medical`` maps to Material Request.custom_is_medical (1 = Medical, 0 = Consumable).
	"""
	import json

	if isinstance(items, str):
		items = json.loads(items)

	if not items:
		frappe.throw(_("No items provided to create Material Request"))

	if is_medical is None or str(is_medical).strip() == "":
		frappe.throw(_("Please choose whether this is a Medical or Consumable material request."))

	mr = frappe.new_doc("Material Request")
	mr.material_request_type = "Purchase"

	if company:
		mr.company = company

	if mr.meta.has_field("custom_is_medical"):
		mr.custom_is_medical = 1 if cint(is_medical) else 0
	if mr.meta.has_field("custom_lab_inventory"):
		mr.custom_lab_inventory = 1

	for row in items:
		if not row.get("item_code") or not row.get("qty"):
			continue

		mr_item = mr.append("items")
		mr_item.item_code = row.get("item_code")
		mr_item.qty = row.get("qty")
		if row.get("warehouse"):
			mr_item.warehouse = row.get("warehouse")
		if schedule_date:
			mr_item.schedule_date = schedule_date
		if cost_center:
			mr_item.cost_center = cost_center

	if not mr.items:
		frappe.throw(_("No valid items to create Material Request"))

	mr.insert(ignore_permissions=True)
	return mr.name


@frappe.whitelist()
def request_lab_consumables(lab_test, items, company=None, schedule_date=None, is_medical=None):
	"""Persist requested consumables on a Lab Test and create a Material Request.

	This is intended for use from the frontend React UI.
	"""
	import json

	if isinstance(items, str):
		items = json.loads(items)

	if not lab_test:
		frappe.throw(_("Lab Test is required"))

	if not items:
		frappe.throw(_("No items provided to request consumables"))

	doc = frappe.get_doc("Lab Test", lab_test)

	# Update requested_consumables child table on Lab Test
	doc.set("requested_consumables", [])
	for row in items:
		if not row.get("item_code") or not row.get("qty"):
			continue

		child = doc.append("requested_consumables", {})
		child.item_code = row.get("item_code")
		child.item_name = row.get("item_name")
		child.qty_per_test = row.get("qty")
		child.uom = row.get("uom")
		child.warehouse = row.get("warehouse")

	doc.save(ignore_permissions=True)

	# Use Lab Test company if not explicitly provided
	if not company:
		company = doc.company

	if not schedule_date:
		schedule_date = frappe.utils.today()

	# Pass Lab Test cost center through to Material Request items
	lab_cost_center = getattr(doc, "cost_center", None)

	mr_name = create_lab_material_request(
		items,
		company=company,
		schedule_date=schedule_date,
		cost_center=lab_cost_center,
		is_medical=is_medical,
	)

	# Link MR back to Lab Test
	if mr_name:
		frappe.db.set_value("Lab Test", doc.name, "material_request", mr_name)

	return mr_name


def _apply_documents_to_doc(doc, documents):
	"""Replace doc.documents child table with the given list of dicts (Patient Upload Document shape)."""
	if documents is None:
		return
	if isinstance(documents, str):
		import json
		documents = json.loads(documents)
	doc.documents = []
	for row in (documents or []):
		if not isinstance(row, dict):
			continue
		if not (row.get('file_name') or row.get('document_name') or row.get('document')):
			continue
		user_label = row.get('file_name') or row.get('document_name') or ''
		doc_type = row.get('document_type') or None
		doc.append('documents', {
			'document_name': user_label,
			'file_name': doc_type if doc_type and frappe.db.exists('Document Type', doc_type) else None,
			'document_type': doc_type,
			'transaction_no': row.get('transaction_no') or None,
			'upload_remarks': row.get('upload_remarks') or None,
			'document': row.get('document') or None,
		})


def _lab_test_has_entered_results(doc) -> bool:
	if (getattr(doc, "custom_result", None) or "").strip():
		return True
	if (getattr(doc, "results", None) or "").strip():
		return True
	for row in doc.normal_test_items or []:
		if (getattr(row, "result_value", None) or "").strip():
			return True
	return False


def _lab_test_results_snapshot(doc) -> dict:
	"""Comparable snapshot of entered result fields (for change detection)."""
	normal = {}
	for row in doc.normal_test_items or []:
		key = (getattr(row, "lab_test_event", None) or getattr(row, "lab_test_name", None) or "").strip()
		normal[key] = {
			"result_value": (getattr(row, "result_value", None) or "").strip(),
			"result_status": (getattr(row, "result_status", None) or "").strip(),
			"lab_test_comment": (getattr(row, "lab_test_comment", None) or "").strip(),
		}
	return {
		"custom_result": (getattr(doc, "custom_result", None) or "").strip(),
		"results": (getattr(doc, "results", None) or "").strip(),
		"lab_test_comment": (getattr(doc, "lab_test_comment", None) or "").strip(),
		"normal_test_items": normal,
	}


# @frappe.whitelist()
# def save_and_submit_lab_test(
# 	name,
# 	custom_result=None,
# 	lab_test_comment=None,
# 	worksheet_instructions=None,
# 	documents=None,
# 	normal_test_items=None,
# 	amount=None,
# 	discount_margin=None,
# 	discount=None,
# 	discount_amount=None,
# 	lab_technician=None,
# 	submit: bool = False,
# ):
# 	"""Save custom result/comment/worksheet/documents/normal_test_items/pricing on Lab Test and optionally submit it."""
# 	_ensure_lab_result_edit_permission()

# 	if not name:
# 		frappe.throw(_("Lab Test name is required"))

# 	doc = frappe.get_doc("Lab Test", name)

# 	if lab_technician is not None:
# 		doc.lab_technician = lab_technician or None

# 	if custom_result is not None:
# 		doc.custom_result = custom_result
# 	if lab_test_comment is not None:
# 		doc.lab_test_comment = lab_test_comment
# 	if worksheet_instructions is not None:
# 		doc.worksheet_instructions = worksheet_instructions

# 	# Save editable normal test result rows (result_value + lab_test_comment per row)
# 	if normal_test_items is not None:
# 		if isinstance(normal_test_items, str):
# 			import json
# 			normal_test_items = json.loads(normal_test_items)
# 		# Build a lookup by lab_test_event so we can update existing rows in-place
# 		existing = {(r.get('lab_test_event') or r.get('lab_test_name') or ''): r for r in doc.normal_test_items or []}
# 		for item in (normal_test_items or []):
# 			event_key = item.get('lab_test_event') or item.get('lab_test_name') or ''
# 			if event_key in existing:
# 				row = existing[event_key]
# 				if item.get('result_value') is not None:
# 					row.result_value = item['result_value']
# 				if item.get('lab_test_comment') is not None:
# 					row.lab_test_comment = item['lab_test_comment']
# 			else:
# 				# New row (shouldn't happen normally but handle gracefully)
# 				doc.append('normal_test_items', {
# 					'lab_test_name': item.get('lab_test_name') or event_key,
# 					'lab_test_event': event_key,
# 					'result_value': item.get('result_value') or '',
# 					'lab_test_uom': item.get('lab_test_uom') or '',
# 					'normal_range': item.get('normal_range') or '',
# 					'lab_test_comment': item.get('lab_test_comment') or '',
# 					'template': item.get('template') or '',
# 				})

# 	# Pricing updates
# 	if amount is not None:
# 		doc.amount = amount
# 	if discount_margin is not None:
# 		doc.discount_margin = discount_margin
# 	if discount is not None:
# 		doc.discount = discount
# 	if discount_amount is not None:
# 		doc.discount_amount = discount_amount

# 	# Auto-populate doc.results from the result_value entries in normal_test_items
# 	if doc.normal_test_items:
# 		values = [
# 			str(r.result_value).strip()
# 			for r in doc.normal_test_items
# 			if r.result_value is not None and str(r.result_value).strip()
# 		]
# 		if values:
# 			doc.results = ", ".join(values)

# 	# Recompute grand_total whenever we have an amount
# 	if getattr(doc, "amount", None) is not None:
# 		base = doc.amount or 0
# 		disc_amt = doc.discount_amount or 0
# 		if doc.discount_margin == "Percentage" and doc.discount:
# 			disc_amt = (base * doc.discount) / 100.0
# 			doc.discount_amount = disc_amt
# 		doc.grand_total = base - (disc_amt or 0)

# 	_apply_documents_to_doc(doc, documents)
# 	if submit:
# 		if doc.docstatus == 0:
# 			doc.flags.ignore_permissions = True
# 			doc.save(ignore_permissions=True)
# 			doc.flags.ignore_permissions = True
# 			doc.submit()
# 		else:
# 			# If already submitted, just save changes
# 			doc.save(ignore_permissions=True)
# 	else:
# 		doc.save(ignore_permissions=True)

# 	return {
# 		"name": doc.name,
# 		"docstatus": doc.docstatus,
# 		"status": doc.status,
# 		"custom_result": getattr(doc, "custom_result", None),
# 		"lab_test_comment": getattr(doc, "lab_test_comment", None),
# 		"worksheet_instructions": getattr(doc, "worksheet_instructions", None),
# 		"amount": getattr(doc, "amount", None),
# 		"discount_margin": getattr(doc, "discount_margin", None),
# 		"discount": getattr(doc, "discount", None),
# 		"discount_amount": getattr(doc, "discount_amount", None),
# 		"grand_total": getattr(doc, "grand_total", None),
# 	}
@frappe.whitelist()
def save_and_submit_lab_test(
    name,
    custom_result=None,
    lab_test_comment=None,
    worksheet_instructions=None,
    documents=None,
    normal_test_items=None,
    amount=None,
    discount_margin=None,
    discount=None,
    discount_amount=None,
    lab_technician=None,
    submit: bool = False,
    sibling_results=None,
):
    """Save lab results on a draft Lab Test. Submit happens only on doctor review (submit arg is ignored).

	``sibling_results``: optional on-screen sibling values (list of
	``{name, template, custom_result}``) so panel sum checks match the UI.
	"""
    if not name:
        frappe.throw(_("Lab Test name is required"))

    doc = frappe.get_doc("Lab Test", name)
    _ensure_lab_result_edit_permission(doc)
    _ensure_lab_result_save_allowed(doc)

    prior_status = doc.status
    results_before = (
        _lab_test_results_snapshot(doc)
        if doc.docstatus == 1 and prior_status == "Reviewed"
        else None
    )
    if doc.docstatus == 1:
        doc.flags.ignore_validate_update_after_submit = True

    if lab_technician is not None:
        doc.lab_technician = lab_technician or None

    if custom_result is not None:
        doc.custom_result = custom_result
    if lab_test_comment is not None:
        doc.lab_test_comment = lab_test_comment
    if worksheet_instructions is not None:
        doc.worksheet_instructions = worksheet_instructions

    # Save editable normal test result rows (result_value + lab_test_comment per row)
    if normal_test_items is not None:
        if isinstance(normal_test_items, str):
            import json
            normal_test_items = json.loads(normal_test_items)
        # Build a lookup by lab_test_event so we can update existing rows in-place
        existing = {(r.get('lab_test_event') or r.get('lab_test_name') or ''): r for r in doc.normal_test_items or []}
        for item in (normal_test_items or []):
            event_key = item.get('lab_test_event') or item.get('lab_test_name') or ''
            if event_key in existing:
                row = existing[event_key]
                if item.get('result_value') is not None:
                    row.result_value = item['result_value']
                if item.get('result_status') is not None:
                    row.result_status = item['result_status']
                if item.get('lab_test_comment') is not None:
                    row.lab_test_comment = item['lab_test_comment']
                if item.get('lab_test_uom') is not None:
                    row.lab_test_uom = item['lab_test_uom']
                if item.get('normal_range') is not None:
                    row.normal_range = item['normal_range']
            else:
                # New row (compound / is_multiple expansion on first save)
                doc.append('normal_test_items', {
                    'lab_test_name': item.get('lab_test_name') or event_key,
                    'lab_test_event': event_key,
                    'result_value': item.get('result_value') or '',
                    'result_status': item.get('result_status') or '',
                    'lab_test_uom': item.get('lab_test_uom') or '',
                    'normal_range': item.get('normal_range') or '',
                    'lab_test_comment': item.get('lab_test_comment') or '',
                    'template': item.get('template') or '',
                    'require_result_value': 1,
                })

    if isinstance(sibling_results, str):
        import json
        sibling_results = json.loads(sibling_results or "[]")

    rule_feedback = {"warnings": [], "errors": [], "calculated_updates": []}
    if doc.template:
        # Validate formulas/sums; defer writing calculated siblings until after this doc is saved.
        rule_feedback = apply_rules_to_doc(
            doc,
            block_on_error=True,
            persist_siblings=False,
            result_overrides=sibling_results,
        )

    # ========== ADD RESULT FLAG CALCULATION HERE ==========
    # Get patient gender
    patient_gender = None
    if doc.patient:
        patient_gender = frappe.db.get_value("Patient", doc.patient, "sex")
    
    # Get ranges from template if available
    female_min = female_max = male_min = male_max = template_min = template_max = None
    is_multiple_template = False
    multiple_rows_by_unit = {}
    if doc.template:
        template_doc = frappe.get_doc("Lab Test Template", doc.template)
        female_min = template_doc.get("female_min_range")
        female_max = template_doc.get("female_max_range")
        male_min = template_doc.get("male_min_range")
        male_max = template_doc.get("male_max_range")
        template_min = template_doc.get("min_range")
        template_max = template_doc.get("max_range")
        is_multiple_template = cint(template_doc.get("is_multiple"))
        if is_multiple_template:
            for mr in (template_doc.get("multiple_result_type") or []):
                key = (getattr(mr, "test_unit", None) or getattr(mr, "uom", None) or "").strip()
                if key:
                    multiple_rows_by_unit[key] = mr

    # Determine which result value to use for flag calculation
    result_to_evaluate = custom_result

    # is_multiple: Deficiency/Insufficiency marks only when Multiple Results.use_status=1
    # (e.g. nmol/L). Other units use High/Low from their min/max ranges.
    if is_multiple_template and doc.normal_test_items:
        status_options = _multiple_result_status_options()
        flags = []
        template_mr_rows = list(template_doc.get("multiple_result_type") or []) if template_doc else []
        use_status_only = [
            r for r in template_mr_rows if cint(getattr(r, "use_status", 0))
        ]
        for item in doc.normal_test_items:
            event_key = (getattr(item, "lab_test_event", None) or getattr(item, "lab_test_name", None) or "").strip()
            mr = multiple_rows_by_unit.get(event_key)
            if not mr and event_key:
                # Loose match: unit / uom case-insensitive
                for key, row in multiple_rows_by_unit.items():
                    if (key or "").strip().casefold() == event_key.casefold():
                        mr = row
                        break
            if not mr and len(use_status_only) == 1:
                mr = use_status_only[0]
            if not mr and len(multiple_rows_by_unit) == 1:
                mr = next(iter(multiple_rows_by_unit.values()))
            use_status = cint(getattr(mr, "use_status", 0)) if mr else 0

            if use_status and getattr(item, "result_value", None):
                suggested = _suggest_multiple_result_status(item.result_value, status_options)
                item.result_status = suggested or ""
                if suggested:
                    flags.append(suggested)
                continue

            # Non-status units: High / Low / Normal from gendered min/max
            if mr and getattr(item, "result_value", None):
                hl_flag = _calculate_result_flag(
                    item.result_value,
                    patient_gender,
                    getattr(mr, "female_min_range", None),
                    getattr(mr, "female_max_range", None),
                    getattr(mr, "male_min_range", None),
                    getattr(mr, "male_max_range", None),
                    None,
                    None,
                )
                item.result_status = hl_flag or ""
                if hl_flag:
                    flags.append(hl_flag)
                continue

            item.result_status = ""

        # Prefer Deficiency-family short marks for overall result_flag when present
        status_marks = [
            f for f in flags
            if f in ("Deficiency", "Insuficiency", "Sufficiency", "Toxicity")
        ]
        if status_marks:
            doc.result_flag = status_marks[0]
        else:
            priority = {
                "Critically High": 5,
                "Critically Low": 5,
                "High": 4,
                "Low": 4,
                "Abnormal": 3,
                "Normal": 1,
                "": 0,
            }
            best = ""
            best_p = -1
            for f in flags:
                p = priority.get(f or "", 2)
                if p > best_p:
                    best_p = p
                    best = f
            doc.result_flag = best or ""

        # Fallback: result only on custom_result (or unit key did not match any row)
        if not (doc.result_flag or "").strip() and (custom_result or "").strip():
            if use_status_only:
                suggested = _suggest_multiple_result_status(custom_result, status_options)
                if suggested:
                    doc.result_flag = suggested
            elif template_mr_rows:
                mr0 = template_mr_rows[0]
                doc.result_flag = _calculate_result_flag(
                    custom_result,
                    patient_gender,
                    getattr(mr0, "female_min_range", None),
                    getattr(mr0, "female_max_range", None),
                    getattr(mr0, "male_min_range", None),
                    getattr(mr0, "male_max_range", None),
                    None,
                    None,
                ) or ""
    elif is_multiple_template and (custom_result or "").strip():
        # Multiple template with result on custom_result and no normal_test_items yet
        status_options = _multiple_result_status_options()
        template_mr_rows = list(template_doc.get("multiple_result_type") or []) if template_doc else []
        use_status_only = [r for r in template_mr_rows if cint(getattr(r, "use_status", 0))]
        if use_status_only:
            doc.result_flag = _suggest_multiple_result_status(custom_result, status_options) or ""
        elif template_mr_rows:
            mr0 = template_mr_rows[0]
            doc.result_flag = _calculate_result_flag(
                custom_result,
                patient_gender,
                getattr(mr0, "female_min_range", None),
                getattr(mr0, "female_max_range", None),
                getattr(mr0, "male_min_range", None),
                getattr(mr0, "male_max_range", None),
                None,
                None,
            ) or ""
        else:
            doc.result_flag = ""
    else:
        # If no custom_result, try to get from normal_test_items
        if not result_to_evaluate and normal_test_items:
            for item in (normal_test_items or []):
                if item.get('result_value'):
                    result_to_evaluate = item.get('result_value')
                    break

        # If still no result, check doc's normal_test_items
        if not result_to_evaluate and doc.normal_test_items:
            for item in doc.normal_test_items:
                if item.result_value:
                    result_to_evaluate = item.result_value
                    break

        # Calculate and set result flag
        if result_to_evaluate:
            doc.result_flag = _calculate_result_flag(
                result_to_evaluate, patient_gender,
                female_min, female_max,
                male_min, male_max,
                template_min, template_max
            )
        else:
            doc.result_flag = ""
    # ========== END RESULT FLAG CALCULATION ==========

    # Pricing updates
    if amount is not None:
        doc.amount = amount
    if discount_margin is not None:
        doc.discount_margin = discount_margin
    if discount is not None:
        doc.discount = discount
    if discount_amount is not None:
        doc.discount_amount = discount_amount

    # Auto-populate doc.results from the result_value entries in normal_test_items
    if doc.normal_test_items:
        values = [
            str(r.result_value).strip()
            for r in doc.normal_test_items
            if r.result_value is not None and str(r.result_value).strip()
        ]
        if values:
            doc.results = ", ".join(values)

    # Recompute grand_total whenever we have an amount
    if getattr(doc, "amount", None) is not None:
        base = doc.amount or 0
        disc_amt = doc.discount_amount or 0
        if doc.discount_margin == "Percentage" and doc.discount:
            disc_amt = (base * doc.discount) / 100.0
            doc.discount_amount = disc_amt
        doc.grand_total = base - (disc_amt or 0)

    _apply_documents_to_doc(doc, documents)

    doc.flags.ignore_permissions = True
    # Lab result entry must still run panel rules and save while audit lock is on.
    doc.flags.skip_editing_lock = True
    doc.save(ignore_permissions=True)

    # Persist calculated siblings (e.g. Globulin) after inputs are committed.
    if doc.template and getattr(doc, "service_request", None):
        from healthcare.healthcare.lab_test_result_rules import (
            recalculate_panel_for_service_request,
        )

        panel_recalc = recalculate_panel_for_service_request(
            doc.service_request, triggering_lab_test=doc.name
        )
        rule_feedback["calculated_updates"] = panel_recalc.get("calculated_updates") or []
        # Drop pre-save formula warnings; siblings are committed before panel re-run.
        rule_feedback["warnings"] = [
            w
            for w in (rule_feedback.get("warnings") or [])
            if w.get("type") != "formula_missing_inputs"
        ]
        rule_feedback["warnings"].extend(panel_recalc.get("warnings") or [])
        rule_feedback["warnings"] = [
            w
            for w in (rule_feedback.get("warnings") or [])
            if w.get("type") != "formula_missing_inputs"
        ]
        # If panel re-run did not persist calculated fields, apply pre-save targets now.
        if not rule_feedback["calculated_updates"] and rule_feedback.get("calculated_targets"):
            from healthcare.healthcare.lab_test_result_rules import (
                get_enabled_rule_docs_for_panel,
                get_panel_template_name,
                merge_rule_docs,
                _sync_calculated_targets_to_lab_tests,
            )

            panel_template = get_panel_template_name(doc.template) or doc.template
            rules_dict = merge_rule_docs(
                get_enabled_rule_docs_for_panel(doc.template, getattr(doc, "service_request", None)),
                panel_template=panel_template,
            )
            if rules_dict:
                rule_feedback["calculated_updates"] = _sync_calculated_targets_to_lab_tests(
                    doc,
                    rules_dict,
                    rule_feedback.get("calculated_targets") or {},
                    service_request=getattr(doc, "service_request", None),
                    lab_test_group=getattr(doc, "lab_test_group", None) or panel_template,
                    persist=True,
                )
    elif doc.template and rule_feedback.get("calculated_targets"):
        from healthcare.healthcare.lab_test_result_rules import (
            get_enabled_rule_docs_for_panel,
            get_panel_template_name,
            merge_rule_docs,
            _sync_calculated_targets_to_lab_tests,
        )

        panel_template = get_panel_template_name(doc.template) or doc.template
        rules_dict = merge_rule_docs(
            get_enabled_rule_docs_for_panel(doc.template, getattr(doc, "service_request", None)),
            panel_template=panel_template,
        )
        if rules_dict:
            rule_feedback["calculated_updates"] = _sync_calculated_targets_to_lab_tests(
                doc,
                rules_dict,
                rule_feedback.get("calculated_targets") or {},
                service_request=getattr(doc, "service_request", None),
                lab_test_group=getattr(doc, "lab_test_group", None) or panel_template,
                persist=True,
            )

    # Results are saved as draft; document submit happens only on doctor review.
    if doc.docstatus == 0 and _lab_test_has_entered_results(doc):
        if doc.status not in ("Reviewed", "Rejected", "Cancelled"):
            frappe.db.set_value(
                "Lab Test",
                doc.name,
                "status",
                "Pending Review",
                update_modified=True,
            )
            doc.status = "Pending Review"
        record_results_entered(doc.name)

    if (
        doc.docstatus == 1
        and prior_status == "Reviewed"
        and results_before is not None
        and _lab_test_results_snapshot(doc) != results_before
    ):
        frappe.db.set_value(
            "Lab Test",
            doc.name,
            "status",
            "Pending Review",
            update_modified=True,
        )
        doc.status = "Pending Review"
        record_results_entered(doc.name)

    if submit and doc.docstatus == 0:
        frappe.msgprint(
            _(
                "Lab results were saved. The Lab Test will be submitted when a doctor completes the review."
            ),
            alert=True,
        )

    return {
        "name": doc.name,
        "docstatus": doc.docstatus,
        "status": doc.status,
        "custom_result": getattr(doc, "custom_result", None),
        "result_flag": getattr(doc, "result_flag", None),  # ADD THIS LINE
        "lab_test_comment": getattr(doc, "lab_test_comment", None),
        "worksheet_instructions": getattr(doc, "worksheet_instructions", None),
        "amount": getattr(doc, "amount", None),
        "discount_margin": getattr(doc, "discount_margin", None),
        "discount": getattr(doc, "discount", None),
        "discount_amount": getattr(doc, "discount_amount", None),
        "grand_total": getattr(doc, "grand_total", None),
        "rule_warnings": rule_feedback.get("warnings") or [],
        "rule_errors": rule_feedback.get("errors") or [],
        "calculated_updates": rule_feedback.get("calculated_updates") or [],
    }
    
@frappe.whitelist()
def recalculate_result_flags(lab_test_name=None):
    """Recalculate result flags for one or all lab tests."""
    
    filters = {}
    if lab_test_name:
        filters["name"] = lab_test_name
    
    lab_tests = frappe.get_all("Lab Test", filters=filters, fields=["name", "patient", "template", "custom_result"])
    
    updated = []
    for lt in lab_tests:
        doc = frappe.get_doc("Lab Test", lt.name)
        
        # Get patient gender
        patient_gender = frappe.db.get_value("Patient", doc.patient, "sex") if doc.patient else None
        
        # Get ranges from template
        female_min = female_max = male_min = male_max = template_min = template_max = None
        if doc.template:
            template_doc = frappe.get_doc("Lab Test Template", doc.template)
            female_min = template_doc.get("female_min_range")
            female_max = template_doc.get("female_max_range")
            male_min = template_doc.get("male_min_range")
            male_max = template_doc.get("male_max_range")
            template_min = template_doc.get("min_range")
            template_max = template_doc.get("max_range")
        
        # Get result value
        result_value = doc.custom_result
        if not result_value and doc.normal_test_items:
            for item in doc.normal_test_items:
                if item.result_value:
                    result_value = item.result_value
                    break
        
        # Calculate new flag
        new_flag = _calculate_result_flag(
            result_value, patient_gender,
            female_min, female_max,
            male_min, male_max,
            template_min, template_max
        )
        
        if doc.result_flag != new_flag:
            doc.db_set("result_flag", new_flag)
            updated.append({"name": doc.name, "old_flag": doc.result_flag, "new_flag": new_flag})
    
    return {"updated": updated, "count": len(updated)}

@frappe.whitelist()
def update_lab_test_remarks(name, remarks=None):
	"""Update the Remarks table on a Lab Test. remarks can be a list of dicts with key 'rrmark' (Remark child table)."""
	assert_editing_allowed()
	if not name:
		frappe.throw(_("Lab Test name is required"))
	doc = frappe.get_doc("Lab Test", name)
	if doc.docstatus == 2:
		frappe.throw(_("Cannot update a cancelled Lab Test"))
	if remarks is not None:
		if isinstance(remarks, str):
			import json
			remarks = json.loads(remarks)
		doc.remarks = []
		for row in (remarks or []):
			if not isinstance(row, dict):
				continue
			rrmark = (row.get("rrmark") or "").strip()
			if rrmark:
				doc.append("remarks", {"rrmark": rrmark})
	doc.save(ignore_permissions=True)
	out_remarks = [{"rrmark": getattr(r, "rrmark", None) or ""} for r in doc.remarks]
	return {"name": name, "remarks": out_remarks}


@frappe.whitelist()
def update_lab_test_basic(name, data=None):
	"""Update basic editable fields on a Lab Test (Draft only) from the React UI.

	Allowed fields:
	- template
	- practitioner
	- department
	- service_unit
	- date
	- time
	- status
	"""
	assert_editing_allowed()
	if not name:
		frappe.throw(_("Lab Test name is required"))

	if isinstance(data, str):
		import json
		data = json.loads(data)

	data = data or {}

	doc = frappe.get_doc("Lab Test", name)

	# Only allow editing in Draft
	if doc.docstatus != 0:
		frappe.throw(_("Only Draft lab tests can be edited from this screen"))

	allowed = {"template", "practitioner", "service_unit", "date", "time", "status",
			   "priority", "is_outsourced", "outsource_lab_name", "outsource_ref_no"}

	for key, value in data.items():
		if key in allowed and hasattr(doc, key):
			doc.set(key, value)

	# Auto-advance status when marking as outsourced
	if data.get("is_outsourced") and doc.status not in (
		"Testing in Progress", "Completed", "Pending Review", "Reviewed", "Approved", "Rejected", "Cancelled"
	):
		doc.status = "Testing in Progress"

	doc.save(ignore_permissions=True)

	return {
		"name": doc.name,
		"patient": doc.patient,
		"patient_name": getattr(doc, "patient_name", None),
		"template": doc.template,
		"lab_test_name": getattr(doc, "lab_test_name", None),
		"practitioner": doc.practitioner,
		"practitioner_name": getattr(doc, "practitioner_name", None),
		# "department": doc.department,
		"service_unit": getattr(doc, "service_unit", None),
		"date": getattr(doc, "date", None),
		"time": getattr(doc, "time", None),
		"status": doc.status,
		"is_outsourced": getattr(doc, "is_outsourced", 0),
		"outsource_lab_name": getattr(doc, "outsource_lab_name", None),
		"outsource_ref_no": getattr(doc, "outsource_ref_no", None),
	}


@frappe.whitelist()
def create_lab_test(data):
	"""Create a new Lab Test"""
	if isinstance(data, str):
		import json
		data = json.loads(data)
	
	# Validate required fields
	if not data.get('patient'):
		frappe.throw(_("Patient is required"))
	if not data.get('cost_center'):
		frappe.throw(_("Cost Center is required"))

	# Optional but recommended clinical context: either inpatient admission or patient visit
	# (only enforce when the fields exist in payload, so older callers are not broken)
	if not data.get('inpatient_record') and not data.get('inpatient_admission') and not data.get('patient_visit'):
		frappe.msgprint(
			_("It is recommended to link a Lab Test to either a Patient Visit or an Inpatient Admission for better context."),
			title=_("Missing Clinical Context"),
			indicator="orange",
		)
	
	# Fetch patient details
	patient = frappe.get_doc('Patient', data.get('patient'))
	patient_sex = patient.sex if patient.sex else None
	
	if not patient_sex:
		frappe.throw(_("Patient gender is required. Please update the patient record with gender information."))
	
	# Get naming series
	naming_series = frappe.db.get_value('Lab Test', {'naming_series': 'HLC-LAB-.YYYY.-'}, 'naming_series')
	if not naming_series:
		naming_series = 'HLC-LAB-.YYYY.-'

	# Lab Test autoname is field:trans_num — must set before insert
	from healthcare.healthcare.doctype.service_request.service_request import (
		generate_lab_test_trans_num,
	)

	trans_num = (data.get("trans_num") or "").strip() or generate_lab_test_trans_num(
		format_type="prefixed", prefix="LT-", padding=6
	)

	admission = resolve_inpatient_admission_name(
		data.get("inpatient_admission") or data.get("inpatient_record"),
		data.get("patient"),
	)
	
	# Create the lab test
	lab_test = frappe.get_doc({
		'doctype': 'Lab Test',
		'trans_num': trans_num,
		'patient': data.get('patient'),
		'patient_sex': patient_sex,
		'cost_center': data.get('cost_center'),
		'template': data.get('template'),
		'practitioner': data.get('practitioner'),
		'date': data.get('date') or frappe.utils.today(),
		'time': data.get('time') or frappe.utils.nowtime(),
		# 'department': data.get('department'),
		'service_unit': data.get('service_unit'),
		'status': data.get('status') or 'Draft',
		'repeat_daily': 1 if str(data.get('repeat_daily') or '').lower() in ('1', 'true', 'yes') else 0,
		'repeat_until': data.get('repeat_until') or None,
		'naming_series': naming_series,
		'inpatient_record': admission,
		'inpatient_admission': admission,
		'patient_visit': data.get('patient_visit') or None,
	})
	
	lab_test.insert(ignore_permissions=True)

	# Append documents if provided (same child table as Patient/Discharge/Admission)
	documents = data.get('documents')
	if documents:
		if isinstance(documents, str):
			import json
			documents = json.loads(documents)
		for row in (documents or []):
			if not isinstance(row, dict):
				continue
			if not (row.get('file_name') or row.get('document_name') or row.get('document')):
				continue
			# file_name in Patient Upload Document is Link to "Document Type"; use document_name (Data) for display/filename
			user_label = row.get('file_name') or row.get('document_name') or ''
			doc_type = row.get('document_type') or None
			lab_test.append('documents', {
				'document_name': user_label,
				'file_name': doc_type if doc_type and frappe.db.exists('Document Type', doc_type) else None,
				'document_type': doc_type,
				'transaction_no': row.get('transaction_no') or None,
				'upload_remarks': row.get('upload_remarks') or None,
				'document': row.get('document') or None,
			})
		if lab_test.documents:
			lab_test.save(ignore_permissions=True)

	# Return the created lab test
	return {
		'name': lab_test.name,
		'trans_num': lab_test.trans_num,
		'patient': lab_test.patient,
		'patient_name': frappe.db.get_value('Patient', lab_test.patient, 'patient_name') or lab_test.patient,
		'practitioner': lab_test.practitioner,
		'practitioner_name': lab_test.practitioner_name if lab_test.practitioner else None,
		'lab_test_name': lab_test.lab_test_name,
		'template': lab_test.template,
		'status': lab_test.status
	}

@frappe.whitelist()
def update_lab_test_status(lab_test_name: str, new_status: str, **kwargs):
	"""
	Legacy entry point — forwards to structured doctor review when review fields are sent.
	"""
	assert_editing_allowed()
	from healthcare.api.lab_test_doctor_review import submit_doctor_lab_test_review

	if kwargs.get("review_result_indicator"):
		return submit_doctor_lab_test_review(
			lab_test_name=lab_test_name,
			new_status=new_status,
			**kwargs,
		)

	frappe.throw(
		_(
			"Lab test review requires result indicator and follow-up actions. "
			"Please complete the review form."
		)
	)


SAMPLE_COLLECTION_EDITABLE_LAB_TEST_STATUSES = frozenset(
	{
		"Awaiting sample collection",
		"Sample Collection in Progress",
		"Sample Collected",
		"Sample collection in progress",
	}
)


def _lab_test_allows_sample_collection_edit(lab_test) -> bool:
	status = (getattr(lab_test, "status", None) or "").strip()
	return status in SAMPLE_COLLECTION_EDITABLE_LAB_TEST_STATUSES


def _valid_lab_test_sample(sample_name) -> str | None:
	"""Return sample name only when it exists on Lab Test Sample (avoids bogus defaults like Urine)."""
	if not sample_name:
		return None
	sample_name = str(sample_name).strip()
	if not sample_name or not frappe.db.exists("Lab Test Sample", sample_name):
		return None
	return sample_name


def _observation_row_has_content(obs: dict, fallback_sample=None) -> bool:
	sample = _valid_lab_test_sample(obs.get("sample") or fallback_sample)
	if sample:
		return True
	if (obs.get("specimen") or "").strip():
		return True
	if frappe.utils.flt(obs.get("sample_qty") or 0) > 0:
		return True
	if obs.get("observation_template"):
		return True
	return False


def _serialize_observation_sample_rows(sample_doc) -> list[dict]:
	rows = []
	for obs in sample_doc.get("observation_sample_collection") or []:
		sample = _valid_lab_test_sample(obs.get("sample"))
		if not sample and not _observation_row_has_content(obs.as_dict() if hasattr(obs, "as_dict") else dict(obs)):
			continue
		rows.append(
			{
				"sample": sample,
				"sample_type": obs.get("sample_type"),
				"uom": obs.get("uom"),
				"status": obs.get("status"),
				"observation_template": obs.get("observation_template"),
				"collection_date_time": str(obs.get("collection_date_time") or ""),
				"sample_qty": obs.get("sample_qty"),
				"collection_point": obs.get("collection_point"),
				"collected_by": obs.get("collected_by"),
				"specimen": obs.get("specimen"),
			}
		)
	return rows


def _scrub_invalid_observation_sample_rows(sample_doc):
	"""Remove child rows with invalid sample links (e.g. doctype default 'Urine' with no real data)."""
	remove_rows = []
	for obs in sample_doc.get("observation_sample_collection") or []:
		sample = (obs.get("sample") or "").strip()
		if not sample or frappe.db.exists("Lab Test Sample", sample):
			continue
		if not _observation_row_has_content(obs):
			remove_rows.append(obs)
		else:
			obs.sample = ""
	for obs in remove_rows:
		sample_doc.remove(obs)


def _apply_observation_rows(sample_doc, observation_rows, fallback_sample=None, fallback_qty=0):
	if observation_rows is None:
		return
	if isinstance(observation_rows, str):
		import json

		observation_rows = json.loads(observation_rows)

	valid_fallback_sample = _valid_lab_test_sample(fallback_sample)
	sample_doc.set("observation_sample_collection", [])
	for obs in observation_rows or []:
		if not isinstance(obs, dict):
			continue
		if not _observation_row_has_content(obs, valid_fallback_sample):
			continue

		sample_val = _valid_lab_test_sample(obs.get("sample") or valid_fallback_sample)
		status = (obs.get("status") or "Open").strip()
		if status not in ("Open", "Collected"):
			status = "Open"

		row_data = {
			# Explicit empty string prevents the child-table default ("Urine") when no sample is set.
			"sample": sample_val or "",
			"sample_type": obs.get("sample_type") or "",
			"uom": obs.get("uom") or "",
			"status": status,
			"observation_template": obs.get("observation_template") or "",
			"collection_date_time": obs.get("collection_date_time") or frappe.utils.now_datetime(),
			"sample_qty": frappe.utils.flt(obs.get("sample_qty") or fallback_qty or 0),
			"collection_point": obs.get("collection_point") or "",
			"collected_by": obs.get("collected_by") or "",
			"specimen": obs.get("specimen") or "",
		}
		sample_doc.append("observation_sample_collection", row_data)


@frappe.whitelist()
def get_sample_collection_for_lab_sample(lab_test_name: str, row_index: int):
	"""Return Sample Collection data for editing a lab test sample_instances row."""
	if not lab_test_name:
		frappe.throw(_("Lab Test name is required"))

	try:
		row_index = int(row_index)
	except Exception:
		frappe.throw(_("Row index is required"), title=_("Invalid Input"))

	doc = frappe.get_doc("Lab Test", lab_test_name)
	rows = doc.get("sample_instances") or []
	if row_index < 0 or row_index >= len(rows):
		frappe.throw(_("Invalid sample instance row"), title=_("Invalid Row"))

	row = rows[row_index]
	if not getattr(row, "sample_collection", None):
		frappe.throw(_("No sample collection linked to this row"))

	if not _lab_test_allows_sample_collection_edit(doc):
		frappe.throw(
			_(
				"Sample collection can only be edited while the Lab Test is still in the sample collection workflow."
			),
			frappe.PermissionError,
		)

	if not frappe.db.exists("Sample Collection", row.sample_collection):
		frappe.throw(_("Sample Collection {0} not found").format(row.sample_collection))

	sample_doc = frappe.get_doc("Sample Collection", row.sample_collection)
	if getattr(sample_doc, "docstatus", 0) >= 1:
		frappe.throw(_("Submitted Sample Collection records cannot be edited from the portal"))

	referring_practitioner_name = None
	if sample_doc.referring_practitioner:
		referring_practitioner_name = frappe.db.get_value(
			"Healthcare Practitioner",
			sample_doc.referring_practitioner,
			"practitioner_name",
		)
	collected_by_name = None
	if sample_doc.collected_by:
		collected_by_name = frappe.db.get_value("User", sample_doc.collected_by, "full_name")

	return {
		"sample_collection": sample_doc.name,
		"sample": sample_doc.sample or getattr(row, "sample", None),
		"sample_qty": sample_doc.sample_qty if sample_doc.sample_qty is not None else getattr(row, "sample_qty", None),
		"sample_details": _plain_sample_details(
			sample_doc.sample_details or getattr(row, "sample_details", None)
		),
		"collection_point": sample_doc.collection_point,
		"collected_by": sample_doc.collected_by,
		"collected_by_name": collected_by_name,
		"referring_practitioner": sample_doc.referring_practitioner,
		"referring_practitioner_name": referring_practitioner_name,
		"observation_rows": _serialize_observation_sample_rows(sample_doc),
		"lab_test_status": doc.status,
	}


@frappe.whitelist()
def update_sample_collection_for_lab_sample(
	lab_test_name: str,
	row_index: int,
	sample_details: str | None = None,
	collection_point: str | None = None,
	referring_practitioner: str | None = None,
	collected_by: str | None = None,
	observation_rows: str | list | None = None,
	sample_qty: float | int | str | None = None,
):
	"""Update an existing Sample Collection linked to a lab test sample_instances row."""
	assert_editing_allowed()
	if not lab_test_name:
		frappe.throw(_("Lab Test name is required"))

	try:
		row_index = int(row_index)
	except Exception:
		frappe.throw(_("Row index is required"), title=_("Invalid Input"))

	sample_qty_value = None
	if sample_qty is not None and sample_qty != "":
		sample_qty_value = frappe.utils.flt(sample_qty)

	doc = frappe.get_doc("Lab Test", lab_test_name)
	if not _lab_test_allows_sample_collection_edit(doc):
		frappe.throw(
			_(
				"Sample collection can only be edited while the Lab Test is still in the sample collection workflow."
			),
			frappe.PermissionError,
		)

	rows = doc.get("sample_instances") or []
	if row_index < 0 or row_index >= len(rows):
		frappe.throw(_("Invalid sample instance row"), title=_("Invalid Row"))

	row = rows[row_index]
	if not getattr(row, "sample_collection", None):
		frappe.throw(_("No sample collection linked to this row"))

	if not frappe.db.exists("Sample Collection", row.sample_collection):
		frappe.throw(_("Sample Collection {0} not found").format(row.sample_collection))

	sample_doc = frappe.get_doc("Sample Collection", row.sample_collection)
	if getattr(sample_doc, "docstatus", 0) >= 1:
		frappe.throw(_("Submitted Sample Collection records cannot be edited from the portal"))

	if sample_qty_value is not None:
		sample_doc.sample_qty = sample_qty_value
		row.sample_qty = sample_qty_value

	if sample_details is not None:
		sample_details = _plain_sample_details(sample_details)
		sample_doc.sample_details = sample_details
		row.sample_details = sample_details

	if collection_point is not None:
		sample_doc.collection_point = collection_point

	if collected_by is not None:
		sample_doc.collected_by = collected_by or None
		if collected_by:
			sample_doc.collected_time = frappe.utils.now_datetime()

	if referring_practitioner is not None:
		sample_doc.referring_practitioner = referring_practitioner or None

	if observation_rows is not None:
		_apply_observation_rows(
			sample_doc,
			observation_rows,
			fallback_sample=getattr(row, "sample", None),
			fallback_qty=sample_doc.sample_qty,
		)
	else:
		_scrub_invalid_observation_sample_rows(sample_doc)

	sample_doc.save(ignore_permissions=True)

	from healthcare.api.lab_request_actions import _sync_lab_test_sample_status

	_sync_lab_test_sample_status(doc)
	doc.save(ignore_permissions=True)

	return {"sample_collection": sample_doc.name}


@frappe.whitelist()
def create_sample_collection_for_lab_sample(
	lab_test_name: str,
	row_index: int,
	sample_details: str | None = None,
	collection_point: str | None = None,
	referring_practitioner: str | None = None,
	collected_by: str | None = None,
	observation_rows: str | list | None = None,
	sample_qty: float | int | str | None = None,
):
	"""Create (or return existing) Sample Collection for a specific sample_instances row on Lab Test.

	row_index is 0-based index into lab_test.sample_instances.
	When the Lab Test has no sample rows yet, a row is created from sample_qty / sample_details.
	"""
	if not lab_test_name:
		frappe.throw(_("Lab Test name is required"))

	try:
		row_index = int(row_index)
	except Exception:
		frappe.throw(_("Row index is required"), title=_("Invalid Input"))

	sample_qty_value = None
	if sample_qty is not None and sample_qty != "":
		sample_qty_value = frappe.utils.flt(sample_qty)

	doc = frappe.get_doc("Lab Test", lab_test_name)
	rows = doc.get("sample_instances") or []

	# Allow recording collection with only “Sample collected” (notes optional).
	if not rows:
		child = doc.append("sample_instances", {})
		if sample_qty_value is not None:
			child.sample_qty = sample_qty_value
		if sample_details:
			child.sample_details = _plain_sample_details(sample_details)
		doc.save(ignore_permissions=True)
		rows = doc.get("sample_instances") or []
		row_index = 0

	if row_index < 0 or row_index >= len(rows):
		frappe.throw(_("Invalid sample instance row"), title=_("Invalid Row"))

	row = rows[row_index]

	# If already linked, just return existing Sample Collection
	if getattr(row, "sample_collection", None) and frappe.db.exists("Sample Collection", row.sample_collection):
		return {"sample_collection": row.sample_collection}

	if sample_qty_value is not None:
		row.sample_qty = sample_qty_value
	if sample_details:
		sample_details = _plain_sample_details(sample_details)
		row.sample_details = sample_details

	if not doc.patient:
		frappe.throw(_("Patient is required on Lab Test"))

	patient = frappe.get_doc("Patient", doc.patient)

	sample_doc = frappe.new_doc("Sample Collection")
	sample_doc.patient = patient.name
	sample_doc.patient_age = patient.get_age()
	sample_doc.patient_sex = patient.sex
	sample_doc.inpatient_record = resolve_inpatient_admission_name(
		doc.get("inpatient_admission") or doc.get("inpatient_record"),
		doc.patient,
	)
	if getattr(row, "sample", None):
		sample_doc.sample = row.sample
		# UOM from Lab Test Sample
		uom = frappe.db.get_value("Lab Test Sample", row.sample, "sample_uom")
		if uom:
			sample_doc.sample_uom = uom
	sample_doc.sample_qty = frappe.utils.flt(getattr(row, "sample_qty", 0) or 0)
	# Prefer explicit sample_details from caller, fall back to row (plain text only)
	sample_doc.sample_details = sample_details or _plain_sample_details(getattr(row, "sample_details", None))
	if doc.company:
		sample_doc.company = doc.company
	if collection_point:
		sample_doc.collection_point = collection_point
	if collected_by:
		sample_doc.collected_by = collected_by
		sample_doc.collected_time = frappe.utils.now_datetime()
	if referring_practitioner:
		sample_doc.referring_practitioner = referring_practitioner

	_apply_observation_rows(
		sample_doc,
		observation_rows,
		fallback_sample=getattr(row, "sample", None),
		fallback_qty=getattr(row, "sample_qty", 0),
	)
	_scrub_invalid_observation_sample_rows(sample_doc)

	sample_doc.save(ignore_permissions=True)

	# Link back to sample_instances row (and keep latest details in row)
	row.sample_collection = sample_doc.name
	if sample_details:
		row.sample_details = sample_details

	from healthcare.api.lab_request_actions import _sync_lab_test_sample_status

	_sync_lab_test_sample_status(doc)
	doc.save(ignore_permissions=True)

	return {"sample_collection": sample_doc.name}


def _record_sample_collection_for_lab_tests(
	lab_tests,
	sample_details=None,
	collection_point=None,
	referring_practitioner=None,
	collected_by=None,
	sample_qty=None,
):
	"""Create/update Sample Collection on each eligible Lab Test. Returns (updated, skipped, collections)."""
	eligible_statuses = LAB_PRE_SAMPLE_COLLECTION_STATUSES | SAMPLE_COLLECTION_EDITABLE_LAB_TEST_STATUSES
	updated: list[str] = []
	skipped: list[str] = []
	collections: list[str] = []

	for lt in lab_tests or []:
		status = (lt.get("status") or "").strip()
		name = lt.get("name")
		if not name or status == "Cancelled" or status not in eligible_statuses:
			if name:
				skipped.append(name)
			continue

		doc = frappe.get_doc("Lab Test", name)
		rows = doc.get("sample_instances") or []
		indices = list(range(len(rows))) if rows else [0]

		for idx in indices:
			row = rows[idx] if rows and idx < len(rows) else None
			existing = (getattr(row, "sample_collection", None) or "").strip() if row else ""
			if existing and frappe.db.exists("Sample Collection", existing):
				if status not in SAMPLE_COLLECTION_EDITABLE_LAB_TEST_STATUSES:
					collections.append(existing)
					continue
				res = update_sample_collection_for_lab_sample(
					lab_test_name=name,
					row_index=idx,
					sample_details=sample_details,
					collection_point=collection_point,
					referring_practitioner=referring_practitioner,
					collected_by=collected_by,
					sample_qty=sample_qty,
				)
			else:
				res = create_sample_collection_for_lab_sample(
					lab_test_name=name,
					row_index=idx,
					sample_details=sample_details,
					collection_point=collection_point,
					referring_practitioner=referring_practitioner,
					collected_by=collected_by,
					sample_qty=sample_qty,
				)
			sc = (res or {}).get("sample_collection")
			if sc:
				collections.append(sc)

		updated.append(name)

	return updated, skipped, collections


@frappe.whitelist()
def create_sample_collection_for_lab_group(
	service_request_name: str,
	sample_details: str | None = None,
	collection_point: str | None = None,
	referring_practitioner: str | None = None,
	collected_by: str | None = None,
	sample_qty: float | int | str | None = None,
	lab_test_group: str | None = None,
):
	"""Record sample collection for child Lab Tests of one grouped request line.

	When ``lab_test_group`` is set, only that group's children are collected.
	Without it, every grouped child on the Service Request is collected (legacy).
	Individual child collection remains available via create_sample_collection_for_lab_sample.
	"""
	assert_editing_allowed()
	if not service_request_name:
		frappe.throw(_("Service Request name is required"))

	lab_test_group = (lab_test_group or "").strip() or None
	lab_tests = _get_lab_tests_for_request_group(service_request_name, lab_test_group)
	if not lab_tests:
		if lab_test_group:
			frappe.throw(_("No lab tests found for group {0}").format(lab_test_group))
		frappe.throw(_("No grouped lab tests found for this Service Request"))

	updated, skipped, collections = _record_sample_collection_for_lab_tests(
		lab_tests,
		sample_details=sample_details,
		collection_point=collection_point,
		referring_practitioner=referring_practitioner,
		collected_by=collected_by,
		sample_qty=sample_qty,
	)

	if not updated:
		if lab_test_group:
			frappe.throw(_("No lab tests in group {0} are eligible for sample collection").format(lab_test_group))
		frappe.throw(_("No lab tests in this group are eligible for sample collection"))

	return {
		"updated": updated,
		"skipped": skipped,
		"count": len(updated),
		"sample_collections": collections,
		"lab_test_group": lab_test_group,
	}


@frappe.whitelist()
def create_sample_collection_for_lab_requests(
	service_request_names,
	sample_details=None,
	collection_point=None,
	referring_practitioner=None,
	collected_by=None,
	sample_qty=None,
):
	"""Record sample collection for every eligible Lab Test on the selected Lab Requests.

	Collected by is always the logged-in user. Quantity and collection point are not used.
	"""
	assert_editing_allowed()
	collected_by = frappe.session.user
	sample_qty = None
	collection_point = None
	if isinstance(service_request_names, str):
		try:
			service_request_names = json.loads(service_request_names)
		except Exception:
			service_request_names = [service_request_names]

	names = []
	for raw in service_request_names or []:
		n = cstr(raw).strip()
		if n and n not in names:
			names.append(n)
	if not names:
		frappe.throw(_("Select at least one Lab Request"))

	request_results = []
	total_updated: list[str] = []
	total_skipped: list[str] = []
	collections: list[str] = []

	for sr in names:
		if not frappe.db.exists("Service Request", sr):
			request_results.append({"name": sr, "updated": 0, "skipped": 0, "error": _("Not found")})
			continue
		lab_tests = frappe.get_all(
			"Lab Test",
			filters={"service_request": sr, "docstatus": ["<", 2]},
			fields=["name", "status", "template", "lab_test_group", "is_group_lab_test"],
			order_by="creation asc",
			ignore_permissions=True,
		)
		updated, skipped, cols = _record_sample_collection_for_lab_tests(
			lab_tests,
			sample_details=sample_details,
			collection_point=collection_point,
			referring_practitioner=referring_practitioner,
			collected_by=collected_by,
			sample_qty=sample_qty,
		)
		request_results.append(
			{
				"name": sr,
				"updated": len(updated),
				"skipped": len(skipped),
				"error": None if updated else (_("No Lab Tests") if not lab_tests else _("None eligible")),
			}
		)
		total_updated.extend(updated)
		total_skipped.extend(skipped)
		collections.extend(cols)

	if not total_updated:
		frappe.throw(_("No lab tests on the selected requests are eligible for sample collection"))

	return {
		"updated": total_updated,
		"skipped": total_skipped,
		"count": len(total_updated),
		"sample_collections": collections,
		"requests": request_results,
		"request_count": len(names),
	}


# healthcare/api/lab_test.py

import frappe
from frappe import _
from healthcare.healthcare.editing_lock import assert_editing_allowed

@frappe.whitelist()
def get_lab_tests_by_inpatient_record(inpatient_record: str):
	"""
	Get all lab tests for a specific inpatient admission
	"""
	if not inpatient_record:
		frappe.throw(_("Inpatient record is required"))

	lab_tests = frappe.get_all(
		"Lab Test",
		filters={
			"docstatus": ("!=", 2),  # Not cancelled
		},
		or_filters={
			"inpatient_record": inpatient_record,
			"inpatient_admission": inpatient_record,
		},
		fields=[
			"name",
			"patient",
			"patient_name",
			"lab_test_name",
			"template",
			"status",
			"date",
			"result_date",
			"submitted_date",
			"approved_date",
			"practitioner",
			"practitioner_name",
			"doc_no",
			"department",
			"invoiced",
			"amount",
			"grand_total",
			"results",
			"descriptive_result",
			"lab_test_comment",
		],
		order_by="date desc",
	)
	doc_no_cache: dict[str, tuple] = {}
	for lab_test in lab_tests:
		_apply_doc_no_practitioner_fallback(lab_test, doc_no_cache)
	return lab_tests


@frappe.whitelist()
def get_lab_tests_by_patient_visit(patient_visit: str):
	"""Get all lab tests linked to a Patient Visit."""
	if not patient_visit:
		frappe.throw(_("Patient Visit is required"))

	lab_tests = frappe.get_all(
		"Lab Test",
		filters={
			"patient_visit": patient_visit,
			"docstatus": ("!=", 2),
		},
		fields=[
			"name",
			"patient",
			"patient_name",
			"lab_test_name",
			"template",
			"status",
			"date",
			"result_date",
			"submitted_date",
			"approved_date",
			"practitioner",
			"practitioner_name",
			"doc_no",
			"department",
			"invoiced",
			"amount",
			"grand_total",
			"results",
			"descriptive_result",
			"lab_test_comment",
			"patient_visit",
		],
		order_by="date desc",
	)
	doc_no_cache: dict[str, tuple] = {}
	for lab_test in lab_tests:
		_apply_doc_no_practitioner_fallback(lab_test, doc_no_cache)
	return lab_tests


@frappe.whitelist()
def get_lab_test_by_id(name: str):
	"""
	Get a single lab test by ID with all details
	"""
	if not name:
		frappe.throw(_("Lab test name is required"))

	doc = frappe.get_doc("Lab Test", name)

	# Get normal test items
	normal_items = []
	for item in doc.normal_test_items:
		normal_items.append({
			"lab_test_name": item.lab_test_name,
			"lab_test_event": item.lab_test_event,
			"result_value": item.result_value,
			"min_range": item.min_range,
			"max_range": item.max_range,
			"result_date": item.result_date,
			"in_range": item.in_range,
			"allow_edit": item.allow_edit
		})

	# Get sensitivity test items
	sensitivity_items = []
	for item in doc.sensitivity_test_items:
		sensitivity_items.append({
			"antibiotic": item.antibiotic,
			"sensitivity": item.sensitivity,
			"antibiotic_sensitivity": item.antibiotic_sensitivity
		})

	out = {
		"name": doc.name,
		"patient": doc.patient,
		"patient_name": doc.patient_name,
		"lab_test_name": doc.lab_test_name,
		"template": doc.template,
		"status": doc.status,
		"date": doc.date,
		"result_date": doc.result_date,
		"submitted_date": doc.submitted_date,
		"approved_date": doc.approved_date,
		"practitioner": doc.practitioner,
		"practitioner_name": doc.practitioner_name,
		"doc_no": getattr(doc, "doc_no", None),
		"department": doc.department,
		"inpatient_record": doc.inpatient_record or doc.inpatient_admission,
		"inpatient_admission": doc.inpatient_admission or doc.inpatient_record,
		"service_unit": doc.service_unit,
		"invoiced": doc.invoiced,
		"amount": doc.amount,
		"grand_total": doc.grand_total,
		"results": doc.results,
		"descriptive_result": doc.descriptive_result,
		"lab_test_comment": doc.lab_test_comment,
		"normal_test_items": normal_items,
		"sensitivity_test_items": sensitivity_items
	}
	_apply_doc_no_practitioner_fallback(out)
	return out


@frappe.whitelist(allow_guest=False)
def finish_group_lab_tests(service_request_name: str, lab_test_group: str | None = None):
	"""Mark a lab group finished once all its child tests have results.

	- With ``lab_test_group`` (Lab Request modal): finish that group only. The Service
	  Request stays open until every line on the request is finished.
	- Without ``lab_test_group`` (Tests & Results): finish every grouped child and mark
	  the Service Request completed (legacy one-group-per-request behaviour).
	"""
	if not service_request_name:
		frappe.throw(_("Service Request name is required"))

	if not frappe.db.exists("Service Request", service_request_name):
		frappe.throw(_("Service Request not found"))

	lab_test_group = (lab_test_group or "").strip() or None
	current_sr_status = frappe.db.get_value("Service Request", service_request_name, "status")

	done_statuses = {"Completed", "Pending Review", "Reviewed", "Rejected", "Approved"}

	if lab_test_group:
		# Per-group Complete on multi-line Lab Requests.
		if current_sr_status == GROUP_FINISHED_SR_STATUS:
			return {
				"ok": True,
				"service_request": service_request_name,
				"lab_test_group": lab_test_group,
				"finished": True,
				"request_finished": True,
				"already_finished": True,
			}

		already = _finished_lab_request_groups(service_request_name)
		if lab_test_group in already:
			return {
				"ok": True,
				"service_request": service_request_name,
				"lab_test_group": lab_test_group,
				"finished": True,
				"request_finished": False,
				"already_finished": True,
			}

		from healthcare.healthcare.lab_request_items import parse_lab_request_items

		sr_doc = frappe.get_doc("Service Request", service_request_name)
		items = parse_lab_request_items(sr_doc)
		matched_item = None
		for item in items:
			if _lab_request_item_key(item) == lab_test_group:
				matched_item = item
				break
		if not matched_item:
			frappe.throw(_("Lab request line for group {0} was not found").format(lab_test_group))

		child_templates = []
		kind = (matched_item.get("kind") or "").strip().lower()
		if kind == "group":
			child_templates = [c for c in (matched_item.get("children") or []) if c]
			if not child_templates:
				child_templates = frappe.get_all(
					"Lab Test Template",
					filters={"lab_group": lab_test_group, "disabled": 0},
					pluck="name",
					ignore_permissions=True,
				)
		else:
			child_templates = [lab_test_group]

		group_tests = frappe.get_all(
			"Lab Test",
			filters={
				"service_request": service_request_name,
				"docstatus": ["!=", 2],
				"lab_test_group": lab_test_group,
			},
			fields=["name", "status", "template", "lab_test_group", "custom_result"],
			order_by="creation asc",
		)
		if not group_tests and child_templates:
			group_tests = frappe.get_all(
				"Lab Test",
				filters={
					"service_request": service_request_name,
					"docstatus": ["!=", 2],
					"template": ["in", child_templates],
				},
				fields=["name", "status", "template", "lab_test_group", "custom_result"],
				order_by="creation asc",
			)

		if not group_tests:
			frappe.throw(_("No Lab Tests found for group {0}").format(lab_test_group))

		def _line_done(lt) -> bool:
			status = (lt.get("status") or "").strip()
			if status in done_statuses:
				return True
			# Inline Lab Request saves may leave a result value before status advances.
			return bool(strip_html(cstr(lt.get("custom_result") or "")).strip())

		incomplete = [lt.get("name") for lt in group_tests if not _line_done(lt)]
		if incomplete:
			frappe.throw(_("Cannot finish group. Pending tests: {0}").format(", ".join(incomplete)))

		matched_item["finished"] = 1

		frappe.db.set_value(
			"Service Request",
			service_request_name,
			"lab_request_items",
			frappe.as_json(items),
			update_modified=True,
		)

		all_finished = all(cint(i.get("finished")) for i in items if _lab_request_item_key(i))
		request_finished = False
		if all_finished:
			frappe.db.set_value(
				"Service Request",
				service_request_name,
				"status",
				GROUP_FINISHED_SR_STATUS,
				update_modified=True,
			)
			request_finished = True

		return {
			"ok": True,
			"service_request": service_request_name,
			"lab_test_group": lab_test_group,
			"finished": True,
			"request_finished": request_finished,
		}

	# Legacy: finish entire Service Request (all grouped children).
	lab_tests = frappe.get_all(
		"Lab Test",
		filters={"service_request": service_request_name, "docstatus": ["!=", 2]},
		fields=["name", "docstatus", "status", "is_group_lab_test"],
		order_by="creation asc",
	)

	if not lab_tests:
		frappe.throw(_("No Lab Tests found for this Service Request"))

	grouped = [lt for lt in lab_tests if int(lt.get("is_group_lab_test") or 0) == 1]
	if not grouped:
		frappe.throw(_("This Service Request is not a grouped lab request"))

	if current_sr_status == GROUP_FINISHED_SR_STATUS:
		return {
			"ok": True,
			"service_request": service_request_name,
			"finished": True,
			"already_finished": True,
		}

	incomplete = [
		lt.get("name")
		for lt in grouped
		if lt.get("status") not in done_statuses
	]

	if incomplete:
		frappe.throw(_("Cannot finish group. Pending tests: {0}").format(", ".join(incomplete)))

	frappe.db.set_value(
		"Service Request",
		service_request_name,
		"status",
		GROUP_FINISHED_SR_STATUS,
		update_modified=True,
	)

	return {"ok": True, "service_request": service_request_name, "finished": True}

def create_daily_repeat_lab_tests():
	"""Daily scheduler: lab tests flagged 'Repeat Daily' spawn a fresh test each day
	until Repeat Until (doctor orders once; nurses perform the daily tests)."""
	today = frappe.utils.today()
	origins = frappe.get_all(
		"Lab Test",
		filters={"repeat_daily": 1, "repeat_until": [">=", today], "docstatus": ["<", 2]},
		fields=[
			"name", "patient", "patient_sex", "cost_center", "template",
			"practitioner", "service_unit", "naming_series", "date",
		],
	)
	created = 0
	for o in origins:
		if str(o.date) == today:
			continue  # the origin itself covers its own day
		if frappe.db.exists("Lab Test", {"repeated_from": o.name, "date": today}):
			continue  # already generated today (idempotent)
		try:
			from healthcare.healthcare.doctype.service_request.service_request import (
				generate_lab_test_trans_num,
			)

			doc = frappe.get_doc({
				"doctype": "Lab Test",
				"trans_num": generate_lab_test_trans_num(format_type="prefixed", prefix="LT-", padding=6),
				"patient": o.patient,
				"patient_sex": o.patient_sex,
				"cost_center": o.cost_center,
				"template": o.template,
				"practitioner": o.practitioner,
				"service_unit": o.service_unit,
				"naming_series": o.naming_series or "HLC-LAB-.YYYY.-",
				"date": today,
				"time": "06:00:00",
				"status": "Draft",
				"repeated_from": o.name,
			})
			doc.insert(ignore_permissions=True)
			created += 1
		except Exception:
			frappe.log_error(
				message=frappe.get_traceback(),
				title=f"Daily repeat lab test failed: {o.name}",
			)
	if created:
		frappe.db.commit()
	return created
