# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.utils import flt, nowdate, getdate, add_days, cint, cstr, nowtime

from healthcare.api.utils.api_utility import get_next_transaction_number
from healthcare.api.sales_order_cost_center import (
	apply_cost_center_to_sales_order,
	cost_center_from_patient_medication_order,
)
from healthcare.healthcare.editing_lock import assert_editing_allowed

# Portal users read/write via whitelisted APIs; DocPerm on the doctype may not include Doctor.
PATIENT_MEDICATION_ORDER_PORTAL_ROLES = frozenset(
	{
		"Administrator",
		"System Manager",
		"Healthcare Administrator",
		"Doctor",
		"Nurse",
		"Physician",
		"Psychologist",
		"Anesthesiologist",
		"Therapist",
		"Nutritionist",
	}
)


def _user_can_access_patient_medication_order_portal() -> bool:
	if frappe.session.user in ("Guest", ""):
		return False
	return bool(PATIENT_MEDICATION_ORDER_PORTAL_ROLES & set(frappe.get_roles(frappe.session.user)))


def _ensure_pmo_read_permission(doc) -> None:
	if frappe.has_permission("Patient Medication Order", "read", doc=doc):
		return
	if _user_can_access_patient_medication_order_portal():
		return
	frappe.throw(_("Not permitted to read Patient Medication Order"), frappe.PermissionError)


def _ensure_pmo_write_permission(doc_or_name) -> None:
	if frappe.has_permission("Patient Medication Order", "write", doc=doc_or_name):
		return
	if _user_can_access_patient_medication_order_portal():
		return
	frappe.throw(_("Not permitted"), frappe.PermissionError)


def _apply_pmo_practitioner_display(doc_or_row) -> None:
	"""Resolve display name from healthcare_practitioner or practitioner Link."""
	get = doc_or_row.get if hasattr(doc_or_row, "get") else lambda k, d=None: getattr(doc_or_row, k, d)

	def set_val(key, value):
		if isinstance(doc_or_row, dict):
			doc_or_row[key] = value
		else:
			setattr(doc_or_row, key, value)

	hp = cstr(get("healthcare_practitioner") or get("practitioner") or "").strip()
	if hp:
		set_val(
			"healthcare_practitioner_name",
			frappe.db.get_value("Healthcare Practitioner", hp, "practitioner_name") or hp,
		)
	elif not cstr(get("healthcare_practitioner_name") or "").strip():
		set_val("healthcare_practitioner_name", None)


def _enrich_entry_practitioners_for_display(doc) -> None:
	"""For older lines with no child doctor, expose the parent PMO doctor on the row for UI.

	Does not write to the database — only enriches the in-memory / API payload.
	"""
	if not doc:
		return
	parent_hp = cstr(
		getattr(doc, "practitioner", None) or getattr(doc, "healthcare_practitioner", None) or ""
	).strip()
	if not parent_hp:
		return
	parent_name = cstr(getattr(doc, "healthcare_practitioner_name", None) or "").strip()
	if not parent_name:
		parent_name = frappe.db.get_value("Healthcare Practitioner", parent_hp, "practitioner_name") or parent_hp
	for row in doc.get("medication_orders") or []:
		if not hasattr(row, "healthcare_practitioner"):
			continue
		if cstr(getattr(row, "healthcare_practitioner", None) or "").strip():
			if hasattr(row, "healthcare_practitioner_name") and not cstr(
				getattr(row, "healthcare_practitioner_name", None) or ""
			).strip():
				row.healthcare_practitioner_name = (
					frappe.db.get_value(
						"Healthcare Practitioner", row.healthcare_practitioner, "practitioner_name"
					)
					or row.healthcare_practitioner
				)
			continue
		row.healthcare_practitioner = parent_hp
		if hasattr(row, "healthcare_practitioner_name"):
			row.healthcare_practitioner_name = parent_name


@frappe.whitelist()
def get_medication_orders(
	limit=50,
	offset=0,
	patient=None,
	status=None,
	search=None,
	practitioner=None,
	from_date=None,
	to_date=None,
	care_context=None,
	patient_encounter=None,
	inpatient_record=None,
	after_discharge=None,
):
	"""Get list of Patient Medication Orders for Prescription listing.
	Supports filters: patient, status, search (name/patient name), practitioner,
	from_date, to_date, care_context, patient_encounter, inpatient_record.
	"""
	from healthcare.api.common import get_permitted_cost_centers
	limit = int(limit) if limit else 50
	offset = int(offset) if offset else 0
	use_sql = bool(search or practitioner or from_date or to_date or patient_encounter or inpatient_record)

	# Resolve cost-centre restriction once for both paths
	permitted_cc = get_permitted_cost_centers()
	if permitted_cc is not None and not permitted_cc:
		return []

	fields = [
		'name', 'patient', 'patient_name', 'care_context', 'patient_encounter',
		'inpatient_record', 'practitioner', 'healthcare_practitioner', 'user_name',
		'posting_date', 'start_date', 'end_date',
		'status', 'total_orders', 'completed_orders', 'company',
		'reference_doctype', 'reference_document_name', 'cost_center',
		'new_system', 'doctors_signature', 'owner', 'creation',
	]

	if use_sql:
		conditions = ['docstatus != 2']
		params = {}
		if patient:
			conditions.append('patient = %(patient)s')
			params['patient'] = patient
		if status:
			conditions.append('status = %(status)s')
			params['status'] = status
		else:
			conditions.append("status != 'Cancelled'")
		# Sold nursing pharmacy give-outs have their own list — not clinical prescriptions
		if frappe.get_meta("Patient Medication Order").has_field("nursing_pharmacy_giveout"):
			conditions.append("IFNULL(nursing_pharmacy_giveout, 0) = 0")
		if frappe.get_meta("Patient Medication Order").has_field("is_pharmacy_give_out"):
			conditions.append("IFNULL(is_pharmacy_give_out, 0) = 0")
		if search:
			conditions.append(
				"(name LIKE %(search)s OR patient_name LIKE %(search)s OR patient LIKE %(search)s)"
			)
			params['search'] = f'%{search}%'
		if practitioner:
			conditions.append('practitioner = %(practitioner)s')
			params['practitioner'] = practitioner
		if care_context in ('Patient Visit', 'Inpatient Admission'):
			conditions.append('care_context = %(care_context)s')
			params['care_context'] = care_context
		if patient_encounter:
			conditions.append('patient_encounter = %(patient_encounter)s')
			params['patient_encounter'] = patient_encounter
		if inpatient_record:
			conditions.append('inpatient_record = %(inpatient_record)s')
			params['inpatient_record'] = inpatient_record
		if from_date:
			conditions.append('posting_date >= %(from_date)s')
			params['from_date'] = from_date
		if to_date:
			conditions.append('posting_date <= %(to_date)s')
			params['to_date'] = to_date
		if after_discharge is not None:
			conditions.append('after_discharge = %(after_discharge)s')
			params['after_discharge'] = 1 if str(after_discharge).lower() in ['1', 'true', 'yes'] else 0

		# ── Cost-centre User Permission enforcement ───────────────────────
		if permitted_cc is not None:
			placeholders = ', '.join(f'%(cc_{i})s' for i in range(len(permitted_cc)))
			conditions.append(f'cost_center IN ({placeholders})')
			for i, cc in enumerate(permitted_cc):
				params[f'cc_{i}'] = cc

		where_sql = ' AND '.join(conditions)
		orders = frappe.db.sql(
			f"""
			SELECT {', '.join(fields)}
			FROM `tabPatient Medication Order`
			WHERE {where_sql}
			ORDER BY posting_date DESC, creation DESC
			LIMIT %(limit)s OFFSET %(offset)s
			""",
			{**params, 'limit': limit, 'offset': offset},
			as_dict=True,
		)
	else:
		filters = [['docstatus', '!=', 2]]
		if patient:
			filters.append(['patient', '=', patient])
		if status:
			filters.append(['status', '=', status])
		else:
			filters.append(['status', '!=', 'Cancelled'])
		if frappe.get_meta("Patient Medication Order").has_field("nursing_pharmacy_giveout"):
			filters.append(['nursing_pharmacy_giveout', '!=', 1])
		if frappe.get_meta("Patient Medication Order").has_field("is_pharmacy_give_out"):
			filters.append(['is_pharmacy_give_out', '!=', 1])
		if care_context in ('Patient Visit', 'Inpatient Admission'):
			filters.append(['care_context', '=', care_context])
		if patient_encounter:
			filters.append(['patient_encounter', '=', patient_encounter])
		if inpatient_record:
			filters.append(['inpatient_record', '=', inpatient_record])

		if after_discharge is not None:
			filters.append(['after_discharge', '=', 1 if str(after_discharge).lower() in ['1', 'true', 'yes'] else 0])

		# ── Cost-centre User Permission enforcement ───────────────────────
		if permitted_cc is not None:
			filters.append(['cost_center', 'in', permitted_cc])

		orders = frappe.get_all(
			'Patient Medication Order',
			filters=filters,
			fields=fields,
			limit=limit,
			limit_start=offset,
			order_by='posting_date desc, creation desc',
		)

	# Child medication rows for the medicine-level prescription listing
	entries_by_parent = {}
	if orders:
		entry_fields = [
			'name', 'parent', 'drug', 'drug_name', 'dosage', 'dosage_form',
			'route_of_administration', 'patient_frequency', 'date', 'end_date',
			'instructions', 'medication_status', 'is_prn', 'medication_type',
			'reason_stopped', 'stopped', 'stopped_date', 'quantity', 'uom', 'medication', 'medicine_no',
			'written_frequency', 'old_medicine_code', 'old_medicine_name',
			'no_of_days', 'time', 'is_pink', 'reference_no',
			'is_long_acting_medicine', 'modified',
		]
		if frappe.db.has_column('Inpatient Medication Order Entry', 'healthcare_practitioner'):
			entry_fields.append('healthcare_practitioner')
		if frappe.db.has_column('Inpatient Medication Order Entry', 'healthcare_practitioner_name'):
			entry_fields.append('healthcare_practitioner_name')
		if frappe.db.has_column('Inpatient Medication Order Entry', 'effective_status'):
			entry_fields.append('effective_status')
		entries = frappe.get_all(
			'Inpatient Medication Order Entry',
			filters={
				'parenttype': 'Patient Medication Order',
				'parent': ['in', [o['name'] for o in orders]],
			},
			fields=entry_fields,
			order_by='parent, idx',
			limit_page_length=0,
		)

		# Oldest legacy rows only carry an Oracle medicine code — resolve names
		# (and current Item when mapped on ITEM_00_01.item) in one batched query.
		def _legacy_code(e):
			raw = (e.get('old_medicine_code') or e.get('medicine_no') or '').strip()
			return raw.lstrip('0') or raw if raw else ''

		legacy_codes = {_legacy_code(e) for e in entries if _legacy_code(e)}
		legacy_master = {}
		if legacy_codes and frappe.db.exists('DocType', 'ITEM_00_01'):
			for m in frappe.get_all(
				'ITEM_00_01',
				filters={'name': ['in', list(legacy_codes)]},
				fields=[
					'name', 'item_nam', 'item_strenght', 'item_unit_of_strength',
					'item_regis_num', 'item', 'item_name',
				],
			):
				legacy_master[m['name']] = m

		mapped_item_codes = {
			(m.get('item') or '').strip()
			for m in legacy_master.values()
			if (m.get('item') or '').strip()
		}
		mapped_item_names = {}
		if mapped_item_codes:
			mapped_item_names = {
				r.name: r.item_name
				for r in frappe.get_all(
					'Item',
					filters={'name': ['in', list(mapped_item_codes)]},
					fields=['name', 'item_name'],
					limit_page_length=0,
				)
			}

		for e in entries:
			# Legacy (Oracle-imported) rows store the medicine in `medication` /
			# `medicine_no` instead of the drug link — fall back so the listing
			# shows the same values as the detail view.
			if not e.get('drug_name') and e.get('medication'):
				e['drug_name'] = e['medication']
			m = legacy_master.get(_legacy_code(e))
			if m:
				mapped_item = (m.get('item') or '').strip()
				# Prefer the linked current Item so Duplicate can open with a real drug.
				if mapped_item and mapped_item in mapped_item_names:
					drug = (e.get('drug') or '').strip()
					legacy_aliases = {
						(e.get('medicine_no') or '').strip(),
						(e.get('old_medicine_code') or '').strip(),
						str(m.get('item_regis_num') or '').strip(),
						m['name'],
					}
					if not drug or drug in legacy_aliases:
						e['drug'] = mapped_item
						e['drug_name'] = (
							(m.get('item_name') or '').strip()
							or mapped_item_names.get(mapped_item)
							or e.get('drug_name')
						)
				if not e.get('drug_name'):
					strength = ' '.join(
						str(x) for x in (m.get('item_strenght'), m.get('item_unit_of_strength')) if x
					)
					e['drug_name'] = (
						f"{m['item_nam']} {strength}".strip() if m.get('item_nam') else e.get('drug_name')
					)
					if not e.get('drug') and m.get('item_regis_num'):
						e['drug'] = m['item_regis_num']
			if not e.get('drug') and e.get('medicine_no'):
				e['drug'] = e['medicine_no']
			if not e.get('patient_frequency') and e.get('written_frequency'):
				e['patient_frequency'] = e['written_frequency']
			entries_by_parent.setdefault(e.pop('parent'), []).append(e)

		# Stopped lines with blank end_date/stopped_date: recover date from
		# Medication Status Log (Discontinue), else child row modified.
		# Never parse free-text comments/instructions.
		from healthcare.api.medication_order_display import medication_entry_is_stopped

		need_stop_date = [
			e
			for rows in entries_by_parent.values()
			for e in rows
			if medication_entry_is_stopped(e) and not e.get('end_date') and not e.get('stopped_date')
		]
		log_by_entry = {}
		if need_stop_date and frappe.db.exists('DocType', 'Medication Status Log'):
			for log in frappe.get_all(
				'Medication Status Log',
				filters={
					'medication_entry': ['in', [e['name'] for e in need_stop_date]],
					'action': 'Discontinue',
				},
				fields=['medication_entry', 'creation'],
				order_by='creation asc',
				limit_page_length=0,
			):
				entry_name = log.get('medication_entry')
				if entry_name and entry_name not in log_by_entry and log.get('creation'):
					log_by_entry[entry_name] = str(log['creation'])[:10]
		for e in need_stop_date:
			e['discontinued_on'] = log_by_entry.get(e['name']) or (
				str(e['modified'])[:10] if e.get('modified') else None
			)

	from healthcare.api.common import fill_missing_patient_names
	fill_missing_patient_names(orders)

	fullname_cache = {}
	for o in orders:
		_apply_pmo_practitioner_display(o)
		owner = o.get('owner')
		if owner and owner not in fullname_cache:
			fullname_cache[owner] = frappe.utils.get_fullname(owner)
		o['owner_full_name'] = fullname_cache.get(owner)
		o['medication_orders'] = entries_by_parent.get(o['name'], [])
		# Older lines may lack child doctor — expose parent doctor for list UI
		parent_hp = cstr(o.get('practitioner') or o.get('healthcare_practitioner') or '').strip()
		parent_name = cstr(o.get('healthcare_practitioner_name') or '').strip()
		if parent_hp:
			for e in o['medication_orders']:
				if not cstr(e.get('healthcare_practitioner') or '').strip():
					e['healthcare_practitioner'] = parent_hp
					e['healthcare_practitioner_name'] = parent_name or parent_hp
				elif not cstr(e.get('healthcare_practitioner_name') or '').strip():
					e['healthcare_practitioner_name'] = (
						frappe.db.get_value(
							'Healthcare Practitioner', e['healthcare_practitioner'], 'practitioner_name'
						)
						or e['healthcare_practitioner']
					)

	return orders


_PRESCRIPTION_TYPE_ALIASES = {
	"Regular -Med (Active)": "Regular - Med (Active)",
	"Regular -Med(Active)": "Regular - Med (Active)",
	"Regular - Med(Active)": "Regular - Med (Active)",
	"Regular -Psy (Active)": "Regular - Psy (Active)",
	"Regular -Psy(Active)": "Regular - Psy (Active)",
	"Regular - Psy(Active)": "Regular - Psy (Active)",
	"Regular -Med (Inactive)": "Regular - Med (Inactive)",
	"Regular -Med(Inactive)": "Regular - Med (Inactive)",
	"Regular - Med(Inactive)": "Regular - Med (Inactive)",
	"Regular -Psy (Inactive)": "Regular - Psy (Inactive)",
	"Regular -Psy(Inactive)": "Regular - Psy (Inactive)",
	"Regular - Psy(Inactive)": "Regular - Psy (Inactive)",
}


def _normalize_prescription_type(value):
	"""Map spacing typos to Inpatient Medication Order Entry Select options."""
	type_value = cstr(value or "").strip()
	if not type_value:
		return type_value
	return _PRESCRIPTION_TYPE_ALIASES.get(type_value, type_value)


def _normalize_long_acting_medication_row(row):
	"""Copy long acting frequency into patient_frequency and ensure Prescription Frequency exists."""
	if not isinstance(row, dict):
		return row
	row = dict(row)
	if "medication_type" in row:
		row["medication_type"] = _normalize_prescription_type(row.get("medication_type"))
	is_long = (
		row.get("is_long_acting_medicine")
		or row.get("is_long_acting")
		or (row.get("medication_type") or "").strip() == "Long Acting Medicine"
	)
	long_freq = (row.get("long_acting_frequency") or "").strip()
	if not is_long or not long_freq:
		return row
	from healthcare.api.common import ensure_prescription_frequency_for_long_acting

	ensure_prescription_frequency_for_long_acting(long_freq)
	row["patient_frequency"] = long_freq
	return row


def _pink_reference_required_for_pmo(doc) -> bool:
	"""Pink Reference No is mandatory for outpatient prescriptions only."""
	if not doc:
		return True
	care = cstr(getattr(doc, "care_context", None) or "").strip()
	if care == "Inpatient Admission":
		return False
	if getattr(doc, "inpatient_record", None) and care != "Patient Visit":
		return False
	return True


def _set_medication_row(doc, row):
	"""Append one medication order row to doc. row is a dict with keys from Inpatient Medication Order Entry."""
	row = _normalize_long_acting_medication_row(row)
	entry = doc.append('medication_orders', {})
	entry.drug = row.get('drug')
	entry.dosage = row.get('dosage') or ''
	entry.no_of_days = flt(row.get('no_of_days'), 0)
	entry.dosage_form = row.get('dosage_form')
	entry.instructions = row.get('instructions') or ''
	entry.date = row.get('date')
	entry.time = row.get('time') or '00:00:00'
	# Keep blank when UI left End Date empty (do not coerce to start/today)
	entry.end_date = row.get('end_date') or None
	entry.patient_frequency = row.get('patient_frequency')
	entry.is_pink = 1 if row.get('is_pink') else 0
	entry.is_prn = 1 if row.get('is_prn') else 0
	entry.reference_no = (row.get('reference_no') or '').strip()
	# Pink reference required for OP only — inpatient prescriptions skip this
	if entry.is_pink and not entry.reference_no and _pink_reference_required_for_pmo(doc):
		drug_label = row.get('drug_name') or row.get('drug') or ''
		frappe.throw(
			_("Reference No is required for pink medication: {0}").format(drug_label or _("Unknown")),
			title=_("Missing Reference No"),
		)
	entry.route_of_administration = row.get('route_of_administration') or ''
	if not (entry.route_of_administration or '').strip() and entry.drug:
		from healthcare.api.common import get_item_route_of_administration_value

		item_route = get_item_route_of_administration_value(entry.drug)
		if item_route:
			entry.route_of_administration = item_route
	entry.medication_type = row.get('medication_type') or ''
	is_long = (
		row.get('is_long_acting_medicine')
		or row.get('is_long_acting')
		or (entry.medication_type or '').strip() == 'Long Acting Medicine'
	)
	entry.is_long_acting_medicine = 1 if is_long else 0
	if entry.meta.has_field('long_acting_frequency'):
		entry.long_acting_frequency = (row.get('long_acting_frequency') or '').strip() or None
	reason_stopped = cstr(row.get('reason_stopped') or '').strip()
	if reason_stopped and hasattr(entry, 'reason_stopped'):
		entry.reason_stopped = reason_stopped
		if hasattr(entry, 'stopped'):
			entry.stopped = 1
		if hasattr(entry, 'stopped_date') and not getattr(entry, 'stopped_date', None):
			entry.stopped_date = nowdate()
		if entry.meta.has_field('end_date') and not getattr(entry, 'end_date', None):
			entry.end_date = nowdate()

	# Prescribing doctor on the line (defaults to parent practitioner on create)
	_apply_entry_healthcare_practitioner(
		entry,
		row.get("healthcare_practitioner") or row.get("practitioner"),
		parent_doc=doc,
	)
	
	# Fetched / computed
	if entry.drug:
		entry.drug_name = frappe.db.get_value('Item', entry.drug, 'item_name') or entry.drug
		entry.uom = (row.get('uom') or '').strip() or frappe.db.get_value('Item', entry.drug, 'stock_uom')
	if entry.patient_frequency:
		entry.frequency_in_a_day = frappe.db.get_value(
			'Prescription Frequency', entry.patient_frequency, 'frequency_in_a_day'
		) or 0
	else:
		entry.frequency_in_a_day = 0
	# Preserve user-entered quantity (quantity/qty); auto-calculate only when missing.
	quantity_input = row.get("quantity")
	if quantity_input in (None, ""):
		quantity_input = row.get("qty")
	if quantity_input not in (None, ""):
		entry.quantity = flt(quantity_input)
	else:
		# quantity = no_of_days * dosage * frequency_in_a_day (dosage as number if possible)
		dosage_val = flt(entry.dosage, 0) or 0
		entry.quantity = flt(entry.no_of_days, 0) * dosage_val * flt(entry.frequency_in_a_day, 0)
		if not entry.quantity:
			entry.quantity = flt(entry.no_of_days, 0)
	if entry.drug:
		rate = flt(row.get("rate"), 0) or get_item_rate_for_uom(entry.drug, entry.uom)
		entry.rate = rate
		entry.amount = flt(entry.quantity) * rate
	return entry


def _apply_entry_healthcare_practitioner(entry, practitioner=None, parent_doc=None):
	"""Set child-row Healthcare Practitioner (and name) from explicit value or parent PMO."""
	if entry is None or not hasattr(entry, "healthcare_practitioner"):
		return
	hp = cstr(practitioner or getattr(entry, "healthcare_practitioner", None) or "").strip()
	if not hp and parent_doc is not None:
		hp = cstr(
			getattr(parent_doc, "practitioner", None)
			or getattr(parent_doc, "healthcare_practitioner", None)
			or ""
		).strip()
	if not hp:
		return
	entry.healthcare_practitioner = hp
	if hasattr(entry, "healthcare_practitioner_name"):
		entry.healthcare_practitioner_name = (
			frappe.db.get_value("Healthcare Practitioner", hp, "practitioner_name") or hp
		)


def _normalize_legacy_medicine_display_codes(doc):
	"""Ensure legacy child rows expose ITEM_00_01 code without Oracle zero-padding."""
	if not doc:
		return
	from healthcare.api.patient_medication_order_import import _resolve_item_00_01_name

	for row in doc.get("medication_orders") or []:
		if getattr(row, "drug", None):
			continue
		resolved = _resolve_item_00_01_name(
			getattr(row, "old_medicine_code", None) or getattr(row, "medicine_no", None)
		)
		if resolved:
			row.old_medicine_code = resolved
			row.medicine_no = resolved


def _apply_current_item_from_legacy_mapping(doc):
	"""When ITEM_00_01.item is set, expose the current Item on legacy child rows.

	Does not overwrite an already-valid Item link. Used by detail fetch and
	duplicate so doctors can keep the mapped current medication.
	"""
	if not doc:
		return
	from healthcare.api.patient_medication_order_import import apply_current_item_mapping_to_medication_rows

	rows = list(doc.get("medication_orders") or [])
	if not rows:
		return
	mapped = apply_current_item_mapping_to_medication_rows(rows)
	for row, payload in zip(rows, mapped):
		if payload.get("drug"):
			row.drug = payload["drug"]
		if payload.get("drug_name"):
			row.drug_name = payload["drug_name"]
		if payload.get("old_medicine_code") and not getattr(row, "old_medicine_code", None):
			row.old_medicine_code = payload["old_medicine_code"]


@frappe.whitelist()
def resolve_medications_for_duplicate(medication_orders=None):
	"""Map legacy medicine codes to current Items for prescription Duplicate.

	Accepts the child-row payload used by Create Prescription and returns the
	same rows with ``drug`` / ``drug_name`` filled from ITEM_00_01.item when
	available.
	"""
	from healthcare.api.patient_medication_order_import import apply_current_item_mapping_to_medication_rows

	if isinstance(medication_orders, str):
		medication_orders = frappe.parse_json(medication_orders)
	return apply_current_item_mapping_to_medication_rows(medication_orders or [])


def _apply_legacy_ip_admission_medicine_fallbacks(doc):
	"""Fill missing frequency/route on legacy PMO child rows from linked IP Admission Medicine."""
	if not doc:
		return
	cache: dict[str, dict] = {}
	for row in doc.get("medication_orders") or []:
		trans_num = (getattr(row, "trans_num", None) or "").strip()
		if not trans_num:
			continue
		if trans_num not in cache:
			cache[trans_num] = frappe.db.get_value(
				"IP Admission Medicine",
				trans_num,
				["frequency", "route"],
				as_dict=True,
			) or {}
		ip_med = cache.get(trans_num) or {}
		if not getattr(row, "patient_frequency", None) and ip_med.get("frequency"):
			row.patient_frequency = (ip_med.get("frequency") or "").strip()
		if not getattr(row, "written_frequency", None) and ip_med.get("frequency"):
			row.written_frequency = (ip_med.get("frequency") or "").strip()
		if not getattr(row, "route_of_administration", None) and ip_med.get("route"):
			row.route_of_administration = (ip_med.get("route") or "").strip()


def _cost_center_from_inpatient_admission(inpatient_record):
	"""Return cost center from Inpatient Admission (required for IP billing/list scoping)."""
	if not inpatient_record:
		return None
	cc = frappe.db.get_value("Inpatient Admission", inpatient_record, "cost_center")
	return (cc or "").strip() or None


def _invoice_for_sales_order(sales_order):
	"""Return linked Sales Invoice name, or the Sales Order when not yet invoiced."""
	if not sales_order:
		return None
	if frappe.db.exists("DocType", "Sales Invoice Item"):
		invoice = frappe.db.get_value("Sales Invoice Item", {"sales_order": sales_order}, "parent")
		if invoice:
			return invoice
	return sales_order


@frappe.whitelist()
def create_patient_medication_order(
	patient,
	care_context,
	company,
	start_date,
	patient_encounter=None,
	inpatient_record=None,
	practitioner=None,
	medication_orders=None,
	after_discharge=None,
	doctors_signature=None,
	discharge_id=None,
):
	"""Create a new Patient Medication Order (prescription) with optional medication rows.
	medication_orders: list of dicts with keys: drug, dosage, no_of_days, dosage_form, instructions, date, time, patient_frequency, is_pink, reference_no.
	"""
	if not patient:
		frappe.throw(_("Patient is required"))
	if care_context not in ('Patient Visit', 'Inpatient Admission'):
		frappe.throw(_("Care Context must be Patient Visit or Inpatient Admission"))
	if not company:
		frappe.throw(_("Company is required"))
	if not start_date:
		frappe.throw(_("Start Date is required"))
	
	
	doc = frappe.new_doc('Patient Medication Order')
	doc.trans_no = get_next_transaction_number('Patient Medication Order', fieldname='trans_no')
	doc.patient = patient
	doc.care_context = care_context
	doc.company = company
	doc.start_date = start_date

	if care_context == 'Patient Visit':
		if not patient_encounter:
			frappe.throw(_("Patient Visit is required when Care Context is Patient Visit"))
		doc.patient_encounter = patient_encounter
		visit = frappe.db.get_value(
			'Patient Visit',
			patient_encounter,
			['patient_name', 'patient_age', 'practitioner', 'encounter_date', 'cost_center'],
			as_dict=True,
		)
		if visit:
			doc.patient_name = visit.get('patient_name')
			doc.patient_age = visit.get('patient_age')
			if visit.get('cost_center'):
				doc.cost_center = visit.get('cost_center')
			if not practitioner and visit.get('practitioner'):
				doc.practitioner = visit.practitioner
			if not doc.start_date and visit.get('encounter_date'):
				doc.start_date = visit.encounter_date
		# Fallback if visit has no branch yet (same resolver used by clinical notes / visits)
		if not doc.get('cost_center'):
			try:
				from healthcare.api.sales_order_cost_center import resolve_cost_center_for_clinical_doc

				resolved = resolve_cost_center_for_clinical_doc(
					{
						'patient_encounter': patient_encounter,
						'patient_visit': patient_encounter,
						'cost_center': None,
					}
				)
				if resolved:
					doc.cost_center = resolved
			except Exception:
				pass
	elif care_context == 'Inpatient Admission':
		if not inpatient_record:
			frappe.throw(_("Inpatient Admission is required when Care Context is Inpatient Admission"))
		doc.inpatient_record = inpatient_record
		adm = frappe.db.get_value(
			'Inpatient Admission',
			inpatient_record,
			['patient', 'patient_name', 'primary_practitioner', 'secondary_practitioner', 'cost_center'],
			as_dict=True,
		)
		if adm:
			doc.patient = adm.get('patient') or doc.patient
			doc.patient_name = adm.get('patient_name')
			if adm.get('cost_center'):
				doc.cost_center = adm.get('cost_center')
			if not practitioner and adm.get('primary_practitioner'):
				doc.practitioner = adm.primary_practitioner
			elif not practitioner and adm.get('secondary_practitioner'):
				doc.practitioner = adm.secondary_practitioner

	if practitioner:
		doc.practitioner = practitioner
	if after_discharge is not None and str(after_discharge).lower() in ("1", "true", "yes"):
		doc.after_discharge = 1
	if discharge_id and doc.meta.has_field("discharge_id"):
		doc.discharge_id = discharge_id
	if doctors_signature:
		doc.doctors_signature = doctors_signature
	doc.new_system = 1
	# Append medication rows
	if medication_orders:
		if isinstance(medication_orders, str):
			import json
			medication_orders = json.loads(medication_orders)
		for row in medication_orders:
			if not row.get('drug'):
				continue
			# Default date/time from start_date if missing
			if not row.get('date'):
				row['date'] = start_date
			if not row.get('time'):
				row['time'] = '00:00:00'
			_set_medication_row(doc, row)
		# Only set parent End Date when a line has an explicit end_date.
		# Do not fill from start/line date (left blank on UI must stay blank).
		if doc.medication_orders:
			explicit_ends = [
				getdate(r.end_date)
				for r in doc.medication_orders
				if getattr(r, "end_date", None)
			]
			if explicit_ends:
				doc.end_date = max(explicit_ends)

	doc.insert(ignore_permissions=True)
	doc.submit()

	# Create Long Acting Medicine from in-memory rows (frequency is lost if we reload first).
	_create_long_acting_medicine_for_entries(doc)

	doc.reload()
	doc.set_status()
	doc.reload()

	# Discharge medication: close other active inpatient prescriptions for this admission
	if cint(getattr(doc, "after_discharge", 0)):
		admission = cstr(getattr(doc, "inpatient_record", None) or "").strip()
		if not admission and getattr(doc, "patient_encounter", None):
			admission = cstr(
				frappe.db.get_value("Patient Visit", doc.patient_encounter, "inpatient_record") or ""
			).strip()
		if admission:
			_complete_inpatient_prescriptions_on_discharge(admission, except_name=doc.name)

	return {'name': doc.name, 'status': doc.status}


def _complete_inpatient_prescriptions_on_discharge(admission: str, except_name: str | None = None) -> list[str]:
	"""Mark other active inpatient PMOs Completed when discharge medication is created.

	Discharge means the inpatient stay is ending — Signed / Unsigned / In Process
	clinical prescriptions for that admission should no longer stay current.
	"""
	if not admission:
		return []

	filters = {
		"inpatient_record": admission,
		"docstatus": 1,
		"status": ["not in", ["Completed", "Cancelled"]],
	}
	pmo_meta = frappe.get_meta("Patient Medication Order")
	if pmo_meta.has_field("after_discharge"):
		filters["after_discharge"] = ["!=", 1]
	if pmo_meta.has_field("nursing_pharmacy_giveout"):
		filters["nursing_pharmacy_giveout"] = ["!=", 1]
	if pmo_meta.has_field("is_pharmacy_give_out"):
		filters["is_pharmacy_give_out"] = ["!=", 1]

	rows = frappe.get_all(
		"Patient Medication Order",
		filters=filters,
		fields=["name", "total_orders", "completed_orders"],
	)
	completed_names = []
	for row in rows:
		if except_name and row.name == except_name:
			continue
		total = cint(row.total_orders) or 0
		updates = {"status": "Completed"}
		# Keep Completed sticky if set_status() runs later (it derives from completed_orders)
		if total and cint(row.completed_orders) < total:
			updates["completed_orders"] = total
		if frappe.db.has_column("Patient Medication Order", "end_date"):
			if not frappe.db.get_value("Patient Medication Order", row.name, "end_date"):
				updates["end_date"] = nowdate()
		frappe.db.set_value("Patient Medication Order", row.name, updates, update_modified=True)
		completed_names.append(row.name)
	return completed_names


def _long_acting_frequency_interval_days(frequency):
	"""Return interval in days for next run (Weekly=7, Biweekly=14, Monthly=30, etc.)."""
	if not frequency:
		return 7
	frequency = frequency.strip()
	interval = frappe.db.get_value("Long Acting Frequency", frequency, "interval_days")
	if interval:
		return cint(interval)
	m = {
		"Weekly": 7,
		"Biweekly": 14,
		"Monthly": 30,
		"Every 2 Months": 60,
		"Every 3 Months": 90,
	}
	return m.get(frequency, 7)


def _resolve_long_acting_frequency_for_entry(entry):
	"""Chosen long-acting interval: line field, then patient/written frequency. Never assume Weekly if set."""
	from healthcare.api.common import (
		DEFAULT_LONG_ACTING_FREQUENCIES,
		_ensure_default_long_acting_frequencies,
		ensure_prescription_frequency_for_long_acting,
	)

	_ensure_default_long_acting_frequencies()
	candidates = [
		getattr(entry, "long_acting_frequency", None),
		getattr(entry, "patient_frequency", None),
		getattr(entry, "written_frequency", None),
	]
	raw = ""
	for value in candidates:
		value = (value or "").strip()
		if value:
			raw = value
			break
	if not raw:
		return "Weekly"

	if frappe.db.exists("Long Acting Frequency", raw):
		ensure_prescription_frequency_for_long_acting(raw)
		return raw

	by_label = frappe.db.get_value("Long Acting Frequency", {"frequency": raw}, "name")
	if by_label:
		ensure_prescription_frequency_for_long_acting(by_label)
		return by_label

	# Create a matching Long Acting Frequency so custom choices persist (not coerced to Weekly).
	interval = _long_acting_frequency_interval_days(raw)
	if interval == 7 and raw not in {f[0] for f in DEFAULT_LONG_ACTING_FREQUENCIES}:
		interval = 7
	doc = frappe.new_doc("Long Acting Frequency")
	doc.frequency = raw
	doc.interval_days = interval
	doc.insert(ignore_permissions=True)
	ensure_prescription_frequency_for_long_acting(raw)
	return raw


def _entry_is_long_acting(entry) -> bool:
	if entry is None:
		return False
	if cint(getattr(entry, "is_long_acting_medicine", 0)):
		return True
	return (getattr(entry, "medication_type", None) or "").strip() == "Long Acting Medicine"


def _lam_exists_for_pmo_entry(entry_name) -> bool:
	entry_name = (entry_name or "").strip()
	if not entry_name:
		return False
	return bool(
		frappe.db.exists(
			"Subscription Medication Plan Item",
			{
				"medication_order_entry": entry_name,
				"parenttype": "Long Acting Medicine",
			},
		)
	)


def _create_long_acting_medicine_for_entries(pmo_doc, only_entry_names=None):
	"""For each long-acting medication line, create a Long Acting Medicine if one is not already linked."""
	only = None
	if only_entry_names:
		only = {cstr(n).strip() for n in only_entry_names if cstr(n).strip()}
	created = []
	for entry in (pmo_doc.medication_orders or []):
		if not _entry_is_long_acting(entry):
			continue
		if only is not None and cstr(getattr(entry, "name", "")).strip() not in only:
			continue
		if _lam_exists_for_pmo_entry(getattr(entry, "name", None)):
			continue
		frequency = _resolve_long_acting_frequency_for_entry(entry)
		start_dt = getdate(entry.date) if entry.date else getdate(pmo_doc.start_date)
		# Only copy End Date when the prescription line has one — do not fall back to
		# the PMO header end_date (often auto-filled from start/line dates).
		end_dt = getdate(entry.end_date) if getattr(entry, "end_date", None) else None
		# First dose is due on the start date (give out same day). After give-out,
		# next_run advances by frequency; the next cycle requires a new doctor order.
		next_run = start_dt

		lam = frappe.new_doc('Long Acting Medicine')
		lam.naming_series = 'SMP-.YYYY.-'
		lam.patient = pmo_doc.patient
		lam.patient_name = pmo_doc.get('patient_name')
		lam.practitioner = pmo_doc.get('practitioner')
		lam.company = pmo_doc.company
		lam.frequency = frequency
		if frappe.get_meta("Long Acting Medicine").has_field("written_frequency"):
			lam.written_frequency = frequency
		lam.start_date = start_dt
		lam.end_date = end_dt
		lam.next_run_date = next_run
		lam.status = 'Active'

		# Single medication row from this order entry
		lam.append('medications', {
			'medication_order_entry': entry.name,
			'drug': entry.drug,
			'drug_name': entry.drug_name or frappe.db.get_value('Item', entry.drug, 'item_name'),
			'dosage': flt(entry.dosage, 0) or 0,
			'dosage_form': entry.dosage_form,
			'instructions': entry.instructions or '',
			'patient_frequency': entry.patient_frequency,
			'date': entry.date,
			'time': entry.time or '08:00:00',
			'qty_per_cycle': 1,
			'is_active': 1,
		})
		lam.insert(ignore_permissions=True)
		lam.submit()
		created.append(lam.name)
	return created


# @frappe.whitelist()
# def create_sales_order_from_medication_order(name: str):
# 	"""Create (or return existing) Sales Order for a Patient Medication Order.

# 	The Sales Order will be left in Draft state and linked back to the PMO.
# 	Also sets custom_base_reference/custom_base_reference_name on Sales Order
# 	and saves reference_doctype/reference_document_name on the PMO.
# 	"""
# 	if not name:
# 		frappe.throw(_("Patient Medication Order name is required"))

# 	pmo = frappe.get_doc("Patient Medication Order", name)

# 	if pmo.docstatus != 1:
# 		frappe.throw(_("Only submitted Patient Medication Orders can create Sales Orders"))

# 	# If a Sales Order is already linked, just return it
# 	if getattr(pmo, "reference_doctype", None) == "Sales Order" and getattr(pmo, "reference_document_name", None):
# 		if frappe.db.exists("Sales Order", pmo.reference_document_name):
# 			so = frappe.get_doc("Sales Order", pmo.reference_document_name)
# 			return {"sales_order": so.name, "status": so.status}

# 	if not pmo.company:
# 		frappe.throw(_("Company is required on Patient Medication Order"))

# 	if not pmo.patient:
# 		frappe.throw(_("Patient is required on Patient Medication Order"))

# 	# Determine healthcare reference (Patient Visit or Inpatient Admission)
# 	ref_doctype = None
# 	ref_name = None
# 	if pmo.care_context == "Inpatient Admission" and pmo.inpatient_record:
# 		ref_doctype = "Inpatient Admission"
# 		ref_name = pmo.inpatient_record
# 	elif pmo.care_context == "Patient Visit" and pmo.patient_encounter:
# 		ref_doctype = "Patient Visit"
# 		ref_name = pmo.patient_encounter

# 	# Create Sales Order (draft)
# 	so = frappe.new_doc("Sales Order")
# 	so.company = pmo.company
# 	so.patient = pmo.patient
# 	so.customer = pmo.patient
# 	# Ensure transaction and delivery dates are set to pass validation
# 	so.transaction_date = nowdate()
# 	so.delivery_date = nowdate()#pmo.end_date or pmo.start_date or nowdate()
# 	if getattr(pmo, "patient_name", None):
# 		so.custom_patient_name = pmo.patient_name
# 	so.custom_patient = pmo.patient

# 	# Healthcare reference to context (visit/admission)
# 	if ref_doctype and ref_name:
# 		so.custom_reference_type = ref_doctype
# 		so.custom_reference_name = ref_name
# 		so.custom_base_reference = "Patient Medication Order"
# 		so.custom_base_reference_name = pmo.name

# 	# Base reference back to the PMO itself
# 	so.custom_base_reference = "Patient Medication Order"
# 	so.custom_base_reference_name = pmo.name

# 	# Add one Sales Order Item per medication order row
# 	for row in pmo.get("medication_orders") or []:
# 		if not getattr(row, "drug", None):
# 			continue
# 		qty = flt(getattr(row, "quantity", 0)) or 1
# 		so.append(
# 			"items",
# 			{
# 				"item_code": row.drug,
# 				"qty": qty,
# 				"description": getattr(row, "drug_name", None) or row.drug,
# 			},
# 		)

# 	if not so.items:
# 		frappe.throw(_("No medication items found to create a Sales Order"))

# 	so.insert(ignore_permissions=True)
# 	# Keep as Draft – do NOT submit

# 	# Link back to PMO for future lookups
# 	pmo.reference_doctype = "Sales Order"
# 	pmo.reference_document_name = so.name
# 	pmo.save(ignore_permissions=True)

# 	return {"sales_order": so.name, "status": so.status}


@frappe.whitelist()
def get_medication_order_by_id(name):
	"""Fetch a single Patient Medication Order with its medication rows."""

	if not name:
		frappe.throw(_("Medication Order ID is required"))

	if not frappe.db.exists("Patient Medication Order", name):
		frappe.throw(_("Patient Medication Order {0} not found").format(name))

	doc = frappe.get_doc("Patient Medication Order", name)
	_ensure_pmo_read_permission(doc)

	# Optional: enrich practitioner name (same as your list function)
	_apply_pmo_practitioner_display(doc)
	_enrich_entry_practitioners_for_display(doc)
	_apply_legacy_ip_admission_medicine_fallbacks(doc)
	_normalize_legacy_medicine_display_codes(doc)
	_apply_current_item_from_legacy_mapping(doc)

	if getattr(doc, "reference_doctype", None) == "Sales Order" and getattr(doc, "reference_document_name", None):
		doc.invoice = _invoice_for_sales_order(doc.reference_document_name)

	for row in doc.get("medication_orders") or []:
		uom = (getattr(row, "uom", None) or "").strip() or None
		if not flt(getattr(row, "rate", 0)) and getattr(row, "drug", None):
			# Only price real Items (legacy numeric codes are not Item links).
			if frappe.db.exists("Item", row.drug):
				row.rate = get_item_rate_for_uom(row.drug, uom)
		qty = flt(getattr(row, "quantity", 0))
		if not flt(getattr(row, "amount", 0)):
			row.amount = qty * flt(getattr(row, "rate", 0))

	return doc


# Roles allowed to hold / continue / discontinue a prescribed drug (prescriber decision).
MEDICATION_ACTION_ROLES = frozenset(
	{"Administrator", "System Manager", "Healthcare Administrator", "Doctor", "Physician"}
)


@frappe.whitelist()
def set_medication_entry_status(order, entry, action, reason=None):
	"""Doctor action to Hold / Continue / Discontinue an individual prescribed drug.

	Rules (per drug, not the whole prescription):
	- Hold: active -> On Hold. Blocks the nurse from giving this drug. Reversible. Reason required.
	- Continue: On Hold -> active (usual). Re-enables giving. No reason required.
	- Discontinue: active/On Hold -> Discontinued. Doctor stopping the drug early. Reason required.
	- Discontinued is terminal: no further transitions are allowed.
	Every action is written to Medication Status Log (who/when via owner/creation).
	"""
	action = (action or "").strip().capitalize()
	if action not in ("Hold", "Continue", "Discontinue"):
		frappe.throw(_("Invalid action"))

	if not (MEDICATION_ACTION_ROLES & set(frappe.get_roles(frappe.session.user))):
		frappe.throw(_("Only a doctor can hold, continue or discontinue a medicine."), frappe.PermissionError)

	doc = frappe.get_doc("Patient Medication Order", order)
	_ensure_pmo_write_permission(doc)

	row = None
	for r in doc.get("medication_orders") or []:
		if r.name == entry:
			row = r
			break
	if not row:
		frappe.throw(_("Medication row not found on this prescription"))

	current = (row.get("medication_status") or "").strip()
	if current == "Discontinued":
		frappe.throw(_("This medicine has been discontinued and cannot be changed."))

	reason = (reason or "").strip()
	if action in ("Hold", "Discontinue") and not reason:
		frappe.throw(_("A reason is required to {0} this medicine.").format(action.lower()))

	if action == "Hold":
		if current == "On Hold":
			frappe.throw(_("This medicine is already on hold."))
		new_status = "On Hold"
	elif action == "Continue":
		if current != "On Hold":
			frappe.throw(_("Only a medicine that is on hold can be continued."))
		new_status = ""
	else:  # Discontinue
		new_status = "Discontinued"

	frappe.db.set_value("Inpatient Medication Order Entry", entry, "medication_status", new_status)
	if new_status == "Discontinued":
		if frappe.db.has_column("Inpatient Medication Order Entry", "stopped"):
			frappe.db.set_value("Inpatient Medication Order Entry", entry, "stopped", 1)
		if frappe.db.has_column("Inpatient Medication Order Entry", "stopped_date"):
			frappe.db.set_value("Inpatient Medication Order Entry", entry, "stopped_date", nowdate())
		if frappe.db.has_column("Inpatient Medication Order Entry", "stop_by"):
			frappe.db.set_value("Inpatient Medication Order Entry", entry, "stop_by", frappe.session.user)
		if frappe.db.has_column("Inpatient Medication Order Entry", "end_date"):
			frappe.db.set_value("Inpatient Medication Order Entry", entry, "end_date", nowdate())
		if reason and frappe.db.has_column("Inpatient Medication Order Entry", "reason_stopped"):
			frappe.db.set_value("Inpatient Medication Order Entry", entry, "reason_stopped", reason)

	log = frappe.new_doc("Medication Status Log")
	log.patient_medication_order = order
	log.medication_entry = entry
	log.patient = doc.get("patient")
	log.drug = row.get("drug")
	log.drug_name = row.get("drug_name")
	log.action = action
	log.new_status = new_status or "Active"
	log.reason = reason or None
	log.insert(ignore_permissions=True)

	return {"entry": entry, "medication_status": new_status, "action": action}


@frappe.whitelist()
def get_medication_status_log(order, entry=None):
	"""Return the Hold/Continue/Discontinue history for a prescription (optionally one drug row)."""
	filters = {"patient_medication_order": order}
	if entry:
		filters["medication_entry"] = entry
	return frappe.get_all(
		"Medication Status Log",
		filters=filters,
		fields=["name", "medication_entry", "drug", "drug_name", "action", "new_status", "reason", "owner", "creation"],
		order_by="creation desc",
	)


@frappe.whitelist()
def create_sales_order_from_medication_order(name: str):
    """Create (or return existing) Sales Order for a Patient Medication Order.

    The Sales Order will be left in Draft state and linked back to the PMO.
    Also sets custom_base_reference/custom_base_reference_name on Sales Order
    and saves reference_doctype/reference_document_name on the PMO.
    """
    if not name:
        frappe.throw(_("Patient Medication Order name is required"))

    pmo = frappe.get_doc("Patient Medication Order", name)

    if pmo.docstatus != 1:
        frappe.throw(_("Only submitted Patient Medication Orders can create Sales Orders"))

    # If a Sales Order is already linked, just return it
    if getattr(pmo, "reference_doctype", None) == "Sales Order" and getattr(pmo, "reference_document_name", None):
        if frappe.db.exists("Sales Order", pmo.reference_document_name):
            so = frappe.get_doc("Sales Order", pmo.reference_document_name)
            return {"sales_order": so.name, "status": so.status}

    if not pmo.company:
        frappe.throw(_("Company is required on Patient Medication Order"))

    if not pmo.patient:
        frappe.throw(_("Patient is required on Patient Medication Order"))

    # Determine healthcare reference (Patient Visit or Inpatient Admission) — same as Sales Invoice.custom_reference_*
    ref_doctype = None
    ref_name = None
    if pmo.care_context == "Inpatient Admission" and pmo.inpatient_record:
        ref_doctype = "Inpatient Admission"
        ref_name = pmo.inpatient_record
    elif pmo.care_context == "Patient Visit" and pmo.patient_encounter:
        ref_doctype = "Patient Visit"
        ref_name = pmo.patient_encounter
    elif pmo.inpatient_record:
        ref_doctype = "Inpatient Admission"
        ref_name = pmo.inpatient_record
    elif pmo.patient_encounter:
        ref_doctype = "Patient Visit"
        ref_name = pmo.patient_encounter

    # Create Sales Order (draft)
    so = frappe.new_doc("Sales Order")
    so.company = pmo.company
    so.patient = pmo.patient
    so.customer = pmo.patient
    # Ensure transaction and delivery dates are set to pass validation
    so.transaction_date = nowdate()
    so.delivery_date = nowdate()
    if getattr(pmo, "patient_name", None):
        so.custom_patient_name = pmo.patient_name
    so.custom_patient = pmo.patient

    if not ref_doctype or not ref_name:
        frappe.throw(
            _("Patient Medication Order {0} must be linked to a Patient Visit or Inpatient Admission to create a Sales Order.").format(
                pmo.name
            )
        )

    so.custom_reference_type = ref_doctype
    so.custom_reference_name = ref_name
    so.custom_base_reference = "Patient Medication Order"
    so.custom_base_reference_name = pmo.name

    # Track unique tax templates to avoid duplicates
    tax_templates_added = set()
    
    # Add one Sales Order Item per medication order row
    for row in pmo.get("medication_orders") or []:
        if not getattr(row, "drug", None):
            continue
        qty = flt(getattr(row, "quantity", 0)) or 1
        
        so.append(
            "items",
            {
                "item_code": row.drug,
                "qty": qty,
                "description": getattr(row, "drug_name", None) or row.drug,
            },
        )
        
        # Get tax information for this item
        tax_info = get_item_tax(row.drug, pmo.company)
        # frappe.throw(_("Tax info for item {0}: {1}").format(row.drug, tax_info))
        # If tax template found and not already added, add to taxes table
        if tax_info.get("tax_template") and tax_info["tax_template"] not in tax_templates_added:
            # Get tax account and rate
            tax_rate = tax_info.get("tax_rate", 0)
            tax_account = get_tax_account(tax_info["tax_template"])
            
            if tax_account:
                so.append("taxes", {
                    "charge_type": "On Net Total",
                    "account_head": tax_account,
                    "description": f"Tax: {tax_info['tax_template']}",
                    "rate": tax_rate,
                    "included_in_print_rate": 0,
                    "included_in_paid_amount": 0
                })
                tax_templates_added.add(tax_info["tax_template"])

    if not so.items:
        frappe.throw(_("No medication items found to create a Sales Order"))

    apply_cost_center_to_sales_order(
        so, cost_center_from_patient_medication_order(pmo, ref_doctype, ref_name)
    )

    so.insert(ignore_permissions=True)
    # Keep as Draft – do NOT submit

    # Link back to PMO for future lookups
    pmo.reference_doctype = "Sales Order"
    pmo.reference_document_name = so.name
    pmo.save(ignore_permissions=True)

    return {"sales_order": so.name, "status": so.status}


def get_item_tax(item_code: str, company: str = None) -> dict:
    """
    Get tax information for an item based on its item tax template or item group.
    
    Args:
        item_code: The item code to get tax information for
        company: Optional company to check company-specific tax templates
    
    Returns:
        dict: Dictionary containing tax_template, tax_rate, and tax_category information
    """
    if not item_code:
        return {}
    
    item = frappe.get_cached_doc("Item", item_code)
    tax_info = {
        "tax_template": None,
        "tax_rate": None,
        "tax_category": None,
        "source": None  # 'item' or 'item_group'
    }
    
    # First check if item has a tax template directly
    if item.get("taxes"):
        # Get the first tax template from the item's taxes table
        # frappe.throw(_("Item {0} has taxes: {1}").format(item_code, item.taxes))
        for tax_row in item.taxes:
            if tax_row.item_tax_template:
                tax_info["tax_template"] = tax_row.item_tax_template
                tax_info["source"] = "item"
                break
    
    # If no tax template on item, check item group hierarchy
    if not tax_info["tax_template"] and item.item_group:
        tax_info = get_tax_from_item_group(item.item_group, tax_info)
    
    # If tax template found, get its rate and category
    if tax_info["tax_template"]:
        tax_template = frappe.get_cached_doc("Item Tax Template", tax_info["tax_template"])
        
        # Get the tax rate (assuming first tax in template)
        if tax_template.taxes:
            tax_info["tax_rate"] = tax_template.taxes[0].tax_rate
            
        # Get tax category if available
        if tax_template.get("tax_category"):
            tax_info["tax_category"] = tax_template.tax_category
    
    return tax_info


def get_tax_from_item_group(item_group: str, tax_info: dict = None) -> dict:
    """
    Recursively search item group hierarchy for tax template.
    
    Args:
        item_group: The item group name to check
        tax_info: Existing tax_info dict to update
    
    Returns:
        dict: Updated tax_info dictionary
    """
    if tax_info is None:
        tax_info = {
            "tax_template": None,
            "tax_rate": None,
            "tax_category": None,
            "source": None
        }
    
    # If we already found a tax template, return it
    if tax_info.get("tax_template"):
        return tax_info
    
    group = frappe.get_cached_doc("Item Group", item_group)
    
    # Check if current item group has tax template
    if group.get("taxes"):
        for tax_row in group.taxes:
            if tax_row.item_tax_template:
                tax_info["tax_template"] = tax_row.item_tax_template
                tax_info["source"] = f"item_group:{item_group}"
                break
    
    # If still no tax template and parent group exists, check parent
    if not tax_info.get("tax_template") and group.parent_item_group:
        return get_tax_from_item_group(group.parent_item_group, tax_info)
    
    return tax_info


def get_tax_account(tax_template: str) -> str:
    """
    Get the tax account head from the item tax template.
    
    Args:
        tax_template: The item tax template name
    
    Returns:
        str: The account head for the tax
    """
    try:
        tax_template_doc = frappe.get_cached_doc("Item Tax Template", tax_template)
        if tax_template_doc.taxes:
            # Return the account head from the first tax row
            return tax_template_doc.taxes[0].account_head
    except Exception as e:
        frappe.log_error(f"Error getting tax account for {tax_template}: {str(e)}")
    
    return None


def _is_current_signed_clinical_pmo(row) -> bool:
	"""Whether a PMO belongs on Current Prescription / daily chart / medication sheet.

	Shows only signed (or legacy) clinical orders that are still active.
	Unsigned / draft new-system prescriptions stay out until signed.
	"""
	status = cstr(
		(row.get("status") if isinstance(row, dict) else getattr(row, "status", None)) or ""
	).strip()
	if status in ("Cancelled", "Completed", "Stopped", "Unsigned", "Draft"):
		return False

	new_system = cint(
		row.get("new_system") if isinstance(row, dict) else getattr(row, "new_system", 0)
	)
	signature = cstr(
		(
			row.get("doctors_signature")
			if isinstance(row, dict)
			else getattr(row, "doctors_signature", None)
		)
		or ""
	).strip()

	if new_system:
		if not signature:
			return False
		if status and status not in ("Signed", "In Process"):
			return False

	return True


@frappe.whitelist()
def get_medication_order_by_inpatient_or_encounter(inpatient_record=None, patient_encounter=None):
	"""
	Fetch current clinical medication order(s) for an inpatient record or patient encounter.

	When several signed/active Patient Medication Orders exist for the same admission/visit
	(excluding unsigned, cancelled, completed, and Nursing Pharmacy Give Out), medicines from
	all of them are returned together so Current Prescription shows every active signed line.

	The latest signed order remains the primary document for header actions (add / sign / edit Rx).
	"""
	if not inpatient_record and not patient_encounter:
		frappe.throw("Either Inpatient Record ID or Patient Encounter ID is required")

	filters = {"docstatus": ["!=", 2]}
	if inpatient_record:
		filters["inpatient_record"] = inpatient_record
	if patient_encounter:
		filters["patient_encounter"] = patient_encounter

	pmo_meta = frappe.get_meta("Patient Medication Order")
	if pmo_meta.has_field("nursing_pharmacy_giveout"):
		filters["nursing_pharmacy_giveout"] = ["!=", 1]
	if pmo_meta.has_field("is_pharmacy_give_out"):
		filters["is_pharmacy_give_out"] = ["!=", 1]

	medication_orders = frappe.get_all(
		"Patient Medication Order",
		filters=filters,
		fields=["name", "status", "creation", "new_system", "doctors_signature"],
		order_by="creation desc",
		limit_page_length=50,
	)

	active_names = [row.name for row in medication_orders if _is_current_signed_clinical_pmo(row)]

	if not active_names:
		frappe.msgprint("No medication order found")
		return None

	# Latest signed = primary (add medicine / sign / edit header)
	primary = frappe.get_doc("Patient Medication Order", active_names[0])
	_ensure_pmo_read_permission(primary)
	_apply_pmo_practitioner_display(primary)
	_enrich_entry_practitioners_for_display(primary)
	_apply_legacy_ip_admission_medicine_fallbacks(primary)
	_normalize_legacy_medicine_display_codes(primary)
	_apply_current_item_from_legacy_mapping(primary)

	merged_entries = []
	active_prescriptions = []
	total_completed = 0

	# Oldest → newest so lines read chronologically; primary is still latest for actions
	for name in reversed(active_names):
		doc = primary if name == primary.name else frappe.get_doc("Patient Medication Order", name)
		if name != primary.name:
			_ensure_pmo_read_permission(doc)
			_apply_pmo_practitioner_display(doc)
			_enrich_entry_practitioners_for_display(doc)
			_apply_legacy_ip_admission_medicine_fallbacks(doc)
			_normalize_legacy_medicine_display_codes(doc)
			_apply_current_item_from_legacy_mapping(doc)

		active_prescriptions.append(
			{
				"name": doc.name,
				"status": doc.status,
				"practitioner": getattr(doc, "practitioner", None),
				"healthcare_practitioner": getattr(doc, "healthcare_practitioner", None),
				"healthcare_practitioner_name": getattr(doc, "healthcare_practitioner_name", None),
				"user_name": getattr(doc, "user_name", None),
				"start_date": str(doc.start_date) if doc.start_date else None,
				"end_date": str(doc.end_date) if doc.end_date else None,
				"creation": str(doc.creation) if doc.creation else None,
			}
		)
		total_completed += cint(getattr(doc, "completed_orders", 0) or 0)
		for entry in doc.get("medication_orders") or []:
			row = entry.as_dict()
			row["parent"] = doc.name
			row["parenttype"] = "Patient Medication Order"
			row["parentfield"] = "medication_orders"
			# Per-line doctor fallback already applied on doc; keep parent Rx for UI
			row["_prescription_name"] = doc.name
			row["_prescription_status"] = doc.status
			merged_entries.append(row)

	result = primary.as_dict()
	result["medication_orders"] = merged_entries
	result["active_prescriptions"] = active_prescriptions
	result["total_orders"] = len(merged_entries)
	result["completed_orders"] = total_completed
	# Keep primary identity for add/sign; expose all IDs for the header
	result["name"] = primary.name
	return result


@frappe.whitelist()
def save_medication_order_entry_stop_reason(
	patient_medication_order: str,
	order_entry_name: str,
	reason_stopped: str | None = None,
	clear: int | str | None = None,
):
	"""Set or clear ``reason_stopped`` on one Inpatient Medication Order Entry (child of Patient Medication Order).

	Used from the single-prescription UI. When not clearing, ``reason_stopped`` is required.
	Optionally sets ``stopped_date`` / ``stop_by`` when those columns exist.
	"""
	if not patient_medication_order or not order_entry_name:
		frappe.throw(_("Patient Medication Order and medication line are required"))

	_ensure_pmo_write_permission(patient_medication_order)

	parent = frappe.db.get_value("Inpatient Medication Order Entry", order_entry_name, "parent")
	if not parent or parent != patient_medication_order:
		frappe.throw(_("This medication line does not belong to the selected prescription."))

	clear_flag = clear is not None and str(clear).lower() in ("1", "true", "yes")

	if clear_flag:
		frappe.db.set_value("Inpatient Medication Order Entry", order_entry_name, "reason_stopped", "")
		if frappe.db.has_column("Inpatient Medication Order Entry", "stopped_date"):
			frappe.db.set_value("Inpatient Medication Order Entry", order_entry_name, "stopped_date", None)
		if frappe.db.has_column("Inpatient Medication Order Entry", "stop_by"):
			frappe.db.set_value("Inpatient Medication Order Entry", order_entry_name, "stop_by", None)
		if frappe.db.has_column("Inpatient Medication Order Entry", "stopped"):
			frappe.db.set_value("Inpatient Medication Order Entry", order_entry_name, "stopped", 0)
	else:
		reason = (reason_stopped or "").strip()
		if not reason:
			frappe.throw(_("Stop reason is required."))
		frappe.db.set_value("Inpatient Medication Order Entry", order_entry_name, "reason_stopped", reason)
		if frappe.db.has_column("Inpatient Medication Order Entry", "stopped"):
			frappe.db.set_value("Inpatient Medication Order Entry", order_entry_name, "stopped", 1)
		if frappe.db.has_column("Inpatient Medication Order Entry", "stopped_date"):
			frappe.db.set_value("Inpatient Medication Order Entry", order_entry_name, "stopped_date", nowdate())
		if frappe.db.has_column("Inpatient Medication Order Entry", "stop_by"):
			frappe.db.set_value("Inpatient Medication Order Entry", order_entry_name, "stop_by", frappe.session.user)
		# End date = day the medicine was stopped/discontinued.
		if frappe.db.has_column("Inpatient Medication Order Entry", "end_date"):
			frappe.db.set_value("Inpatient Medication Order Entry", order_entry_name, "end_date", nowdate())

		# Same audit trail as Hold/Continue/Discontinue API (who/when via owner/creation).
		if frappe.db.exists("DocType", "Medication Status Log"):
			entry_row = frappe.db.get_value(
				"Inpatient Medication Order Entry",
				order_entry_name,
				["drug", "drug_name", "parent"],
				as_dict=True,
			) or {}
			patient = frappe.db.get_value("Patient Medication Order", patient_medication_order, "patient")
			log = frappe.new_doc("Medication Status Log")
			log.patient_medication_order = patient_medication_order
			log.medication_entry = order_entry_name
			log.patient = patient
			log.drug = entry_row.get("drug")
			log.drug_name = entry_row.get("drug_name")
			log.action = "Discontinue"
			log.new_status = "Discontinued"
			log.reason = reason
			log.insert(ignore_permissions=True)

	frappe.db.commit()
	return {"ok": True}


# In your patient_medication_order.py
@frappe.whitelist()
def update_medication_order():
    """Update an existing Patient Medication Order"""
    assert_editing_allowed()
    data = frappe.local.form_dict
    
    if not data.get('name'):
        frappe.throw("Medication Order ID is required")
    
    doc = frappe.get_doc("Patient Medication Order", data.get('name'))
    
    # Update fields
    doc.company = data.get('company', doc.company)
    doc.start_date = data.get('start_date', doc.start_date)
    doc.practitioner = data.get('practitioner', doc.practitioner)
    doc.care_context = data.get('care_context', doc.care_context)
    
    if data.get('care_context') == 'Patient Visit':
        doc.patient_encounter = data.get('patient_encounter')
    else:
        doc.inpatient_record = data.get('inpatient_record')

    if 'doctors_signature' in data:
        doc.doctors_signature = data.get('doctors_signature') or None
    
    # Clear and update medication orders
    doc.set('medication_orders', [])
    for med in data.get('medication_orders', []):
        if not med.get('drug'):
            continue
        _set_medication_row(doc, med)
    
    doc.save(ignore_permissions=True)
    _create_long_acting_medicine_for_entries(doc)
    doc.reload()
    doc.set_status()
    doc.reload()
    frappe.db.commit()
    
    return doc


@frappe.whitelist()
def sign_patient_medication_order(name, doctors_signature):
	"""Attach a doctor signature and move a new-system prescription to Signed status."""
	assert_editing_allowed()
	if not name:
		frappe.throw(_("Patient Medication Order name is required"))
	if not (doctors_signature or "").strip():
		frappe.throw(_("Doctor signature is required"))

	doc = frappe.get_doc("Patient Medication Order", name)
	_ensure_pmo_write_permission(doc)

	if doc.docstatus != 1:
		frappe.throw(_("Only submitted prescriptions can be signed"))

	doc.doctors_signature = doctors_signature
	if not cint(doc.new_system):
		doc.new_system = 1
	doc.save(ignore_permissions=True)
	doc.reload()
	doc.set_status()
	doc.reload()

	return {"name": doc.name, "status": doc.status, "doctors_signature": doc.doctors_signature}


@frappe.whitelist()
def create_subscription_medication_plan(
	prescription=None,
	medications=None,
	frequency=None,
	start_date=None,
	end_date=None,
):
	"""Create a submitted Subscription Medication Plan from a Patient Medication Order (portal).

	Mirrors Patient Medication Order.create_subscription_plan on the desk form.
	"""
	assert_editing_allowed()
	prescription = (prescription or "").strip()
	if not prescription:
		frappe.throw(_("Prescription is required"))

	if isinstance(medications, str):
		medications = frappe.parse_json(medications) or []
	if not medications:
		frappe.throw(_("Please add at least one medication"))

	frequency = (frequency or "Monthly").strip()
	if frequency not in ("Monthly", "Every 2 Months", "Every 3 Months"):
		frappe.throw(_("Invalid frequency. Choose Monthly, Every 2 Months, or Every 3 Months."))

	doc = frappe.get_doc("Patient Medication Order", prescription)
	_ensure_pmo_write_permission(doc)

	if cint(doc.docstatus) != 1:
		frappe.throw(_("Only submitted prescriptions can create a subscription plan"))

	if not doc.patient:
		frappe.throw(_("Patient is required on the prescription"))

	allowed_entries = {row.name: row for row in (doc.get("medication_orders") or [])}
	plan = frappe.new_doc("Subscription Medication Plan")
	plan.patient = doc.patient
	plan.practitioner = doc.practitioner or getattr(doc, "healthcare_practitioner", None)
	plan.company = doc.company
	plan.frequency = frequency
	plan.start_date = getdate(start_date or doc.start_date or frappe.utils.today())
	plan.end_date = getdate(end_date) if end_date else None
	plan.next_run_date = plan.start_date

	added = 0
	for raw in medications:
		row = raw or {}
		drug = (row.get("drug") or "").strip()
		if not drug:
			continue
		if row.get("is_active") in (0, "0", False, "false"):
			continue

		entry_name = (row.get("medication_order_entry") or "").strip() or None
		source = allowed_entries.get(entry_name) if entry_name else None

		child = plan.append("medications")
		child.medication_order_entry = entry_name if entry_name in allowed_entries else None
		child.drug = drug
		child.drug_name = (
			row.get("drug_name")
			or (source.drug_name if source else None)
			or frappe.db.get_value("Item", drug, "item_name")
			or drug
		)
		# Subscription child dosage is Float; PMO dosage may be Link/Data — coerce when possible.
		dosage_val = row.get("dosage")
		if dosage_val is None and source is not None:
			dosage_val = source.dosage
		try:
			child.dosage = flt(dosage_val) if dosage_val not in (None, "") else None
		except Exception:
			child.dosage = None
		child.dosage_form = row.get("dosage_form") or (source.dosage_form if source else None)
		child.instructions = row.get("instructions") or (source.instructions if source else None)
		child.patient_frequency = row.get("patient_frequency") or (
			source.patient_frequency if source else None
		)
		child.date = row.get("date") or (source.date if source else None) or plan.start_date
		child.time = row.get("time") or (source.time if source else None)
		qty = row.get("qty_per_cycle")
		if qty in (None, ""):
			qty = (source.quantity if source else None) or 1
		child.qty_per_cycle = flt(qty) or 1
		child.is_active = 1
		added += 1

	if not added:
		frappe.throw(_("Please include at least one medication with a drug code"))

	plan.insert(ignore_permissions=True)
	plan.submit()

	return {
		"name": plan.name,
		"patient": plan.patient,
		"frequency": plan.frequency,
		"start_date": plan.start_date,
		"next_run_date": plan.next_run_date,
		"status": plan.status,
	}


# @frappe.whitelist()
# def get_after_discharge_prescriptions(patient, admission=None):
#     """
#     Get prescriptions created after discharge (during medicine transfer)
#     """
#     filters = {
#         'patient': patient,
#         'after_discharge': 1,
#         'docstatus': 1  # Submitted/Completed prescriptions only
#     }
    
#     # if admission:
#     #     filters['discharge_transfer'] = ['like', f'%{admission}%']
    
#     prescriptions = frappe.get_all(
#         'Patient Medication Order',
#         filters=filters,
#         fields=[
#             'name',
#             'patient',
#             'patient_name',
#             'posting_date',
#             # 'total_amount',
#             'after_discharge',
#             # 'discharge_transfer'
#         ],
#         order_by='creation desc'
#     )
    
#     # For each prescription, get the drug details
#     for pres in prescriptions:
#         drugs = frappe.get_all(
#             'Inpatient Medication Order Entry',
#             filters={'parent': pres.name},
#             fields=['drug', 'drug_name', 'dosage', 'quantity', 'rate', 'amount']
#         )
#         pres['drugs'] = drugs
    
#     return prescriptions

def get_item_rate(item_code):
    """
    Get the selling rate for an item (per stock UOM).
    Tries standard_rate first, then selling_price (if field exists), then valuation_rate.
    Returns 0 if no rate found.
    """
    if not item_code:
        return 0

    rate = frappe.db.get_value("Item", item_code, "standard_rate")
    if rate:
        return flt(rate)

    item_meta = frappe.get_meta("Item")
    if item_meta.has_field("selling_price"):
        rate = frappe.db.get_value("Item", item_code, "selling_price")
        if rate:
            return flt(rate)

    rate = frappe.db.get_value("Item", item_code, "valuation_rate")
    if rate:
        return flt(rate)

    return 0


def get_item_rate_for_uom(item_code, uom=None):
	"""Return item selling rate for the requested UOM (stock UOM rate × conversion factor)."""
	if not item_code:
		return 0

	base_rate = get_item_rate(item_code)
	uom = (uom or "").strip()
	if not uom:
		return base_rate

	stock_uom = frappe.db.get_value("Item", item_code, "stock_uom")
	if not stock_uom or uom == stock_uom:
		return base_rate

	from erpnext.stock.get_item_details import get_conversion_factor

	cf = flt(get_conversion_factor(item_code, uom).get("conversion_factor")) or 1
	return flt(base_rate) * cf


def get_item_rates_bulk(item_codes):
    """
    Get rates for multiple items at once.
    Returns a dictionary mapping item_code to rate.
    """
    if not item_codes:
        return {}
    
    # Remove duplicates and None values
    item_codes = list(set([code for code in item_codes if code]))
    
    rates = {}
    for code in item_codes:
        rates[code] = get_item_rate(code)
    
    return rates


@frappe.whitelist()
def get_after_discharge_prescriptions(patient, admission=None):
    """
    Get prescriptions created after discharge (during medicine transfer)
    """
    filters = {
        'patient': patient,
        'after_discharge': 1,
        'docstatus': 1
    }
    
    prescriptions = frappe.get_all(
        'Patient Medication Order',
        filters=filters,
        fields=[
            'name',
            'patient',
            'patient_name',
            'posting_date',
            'after_discharge',
        ],
        order_by='creation desc'
    )
    
    # For each prescription, get the drug details
    for pres in prescriptions:
        drugs = frappe.get_all(
            'Inpatient Medication Order Entry',
            filters={'parent': pres.name},
            fields=['drug', 'drug_name', 'dosage', 'quantity']
        )
        
        # Add rate and amount to each drug using the helper function
        for drug in drugs:
            drug['rate'] = get_item_rate(drug.get('drug'))
            drug['amount'] = (drug.get('quantity') or 0) * drug['rate']
        
        pres['drugs'] = drugs
    
    return prescriptions


@frappe.whitelist()
def get_item_rate_api(item_code, uom=None):
    """
    API endpoint to get rate for a single item, optionally converted to a UOM.
    """
    return {
		'item_code': item_code,
		'rate': get_item_rate_for_uom(item_code, uom),
		'stock_uom': frappe.db.get_value("Item", item_code, "stock_uom") if item_code else None,
	}


@frappe.whitelist()
def get_item_rates_api(item_codes):
    """
    API endpoint to get rates for multiple items
    """
    if isinstance(item_codes, str):
        import json
        item_codes = json.loads(item_codes)
    
    return get_item_rates_bulk(item_codes)



@frappe.whitelist()
def get_prescriptions_by_inpatient_record(inpatient_record: str):
    """
    Get all prescriptions for a specific inpatient admission
    """
    if not inpatient_record:
        frappe.throw(_("Inpatient record is required"))
    
    filters = {
        "care_context": "Inpatient Admission",
        "inpatient_record": inpatient_record,
        "docstatus": 1,
        "status": ["!=", "Cancelled"],
    }
    pmo_meta = frappe.get_meta("Patient Medication Order")
    if pmo_meta.has_field("nursing_pharmacy_giveout"):
        filters["nursing_pharmacy_giveout"] = ["!=", 1]
    if pmo_meta.has_field("is_pharmacy_give_out"):
        filters["is_pharmacy_give_out"] = ["!=", 1]

    prescriptions = frappe.get_all(
        "Patient Medication Order",
        filters=filters,
        fields=["name", "patient", "patient_name", "status", "practitioner", "healthcare_practitioner_name"]
    )
    
    result = []
    for pres in prescriptions:
        # Get medication items
        doc = frappe.get_doc("Patient Medication Order", pres.name)
        medications = []
        for item in doc.medication_orders:
            from healthcare.api.medication_order_display import medication_entry_display_fields

            display = medication_entry_display_fields(
                item,
                parent_start_date=doc.start_date,
                parent_end_date=doc.end_date,
            )
            drug = item.drug
            drug_name = frappe.get_cached_value("Item", item.drug, "item_name") if item.drug and frappe.db.exists("Item", item.drug) else (item.drug_name or "")
            medications.append({
                "name": item.name,
                "drug": drug,
                "drug_name": drug_name,
                "medication": getattr(item, "medication", None),
                "old_medicine_code": getattr(item, "old_medicine_code", None),
                "old_medicine_name": getattr(item, "old_medicine_name", None),
                "medicine_no": getattr(item, "medicine_no", None),
                "written_frequency": getattr(item, "written_frequency", None),
                "dosage": item.dosage,
                "uom": getattr(item, "uom", None),
                "dosage_form": item.dosage_form,
                "frequency": display["display_frequency"],
                "patient_frequency": item.patient_frequency,
                "period": item.no_of_days,
                "instructions": item.instructions,
                "date": item.date,
                "start_date": display["display_start_date"],
                "end_date": str(item.end_date) if getattr(item, "end_date", None) else (str(display.get("display_end_date") or "") or None),
                "medication_status": (getattr(item, "medication_status", None) or "").strip(),
                "stopped": cint(getattr(item, "stopped", 0)),
                "stopped_date": str(item.stopped_date) if getattr(item, "stopped_date", None) else None,
                "reason_stopped": getattr(item, "reason_stopped", None),
                "effective_status": getattr(item, "effective_status", None),
                "status": item.status if hasattr(item, 'status') else "Active",
                "display_drug_name": display["display_drug_name"],
                "display_dosage": display["display_dosage"],
                "is_legacy": display["is_legacy"],
            })

        from healthcare.api.patient_medication_order_import import apply_current_item_mapping_to_medication_rows
        medications = apply_current_item_mapping_to_medication_rows(medications)
        
        result.append({
            "name": pres.name,
            "patient": pres.patient,
            "patient_name": pres.patient_name,
            "status": pres.status,
            "from_date": pres.from_date,
            "to_date": pres.to_date,
            "practitioner": pres.practitioner,
            "practitioner_name": pres.practitioner_name,
            "medications": medications
        })
    
    return result


@frappe.whitelist()
def get_medications_for_clinical_note_day(
	patient=None,
	note_date=None,
	inpatient_admission=None,
	patient_visit=None,
):
	"""
	Medications prescribed for the calendar day of a clinical / doctor progress note.

	Includes child lines when:
	- Parent Patient Medication Order was posted/created that day and the line
	  starts that day (or has no line start date), OR
	- The child line Start Date (`date`) equals that day (even if the parent
	  order was created earlier — e.g. meds added mid-admission).
	"""
	from frappe.utils import getdate

	patient = (patient or "").strip()
	if not patient:
		frappe.throw(_("Patient is required"))

	try:
		note_day = getdate(note_date) if note_date else None
	except Exception:
		note_day = None
	if not note_day:
		frappe.throw(_("Note date is required"))

	inpatient_admission = (inpatient_admission or "").strip() or None
	patient_visit = (patient_visit or "").strip() or None

	conditions = [
		"parent.patient = %(patient)s",
		"parent.docstatus != 2",
		"IFNULL(parent.status, '') != 'Cancelled'",
		"""(
			(
				DATE(IFNULL(parent.posting_date, parent.creation)) = %(note_day)s
				AND (child.date IS NULL OR child.date = '' OR child.date = %(note_day)s)
			)
			OR child.date = %(note_day)s
		)""",
	]
	params = {
		"patient": patient,
		"note_day": str(note_day),
	}

	if inpatient_admission:
		conditions.append("parent.inpatient_record = %(inpatient_admission)s")
		params["inpatient_admission"] = inpatient_admission
	elif patient_visit:
		conditions.append("parent.patient_encounter = %(patient_visit)s")
		params["patient_visit"] = patient_visit

	where_sql = " AND ".join(conditions)
	rows = frappe.db.sql(
		f"""
		SELECT
			child.name AS entry_name,
			child.drug,
			child.drug_name,
			child.medication,
			child.old_medicine_code,
			child.old_medicine_name,
			child.medicine_no,
			child.dosage,
			child.dosage_form,
			child.quantity,
			child.uom,
			child.instructions,
			child.patient_frequency,
			child.written_frequency,
			child.date,
			child.end_date,
			child.modified,
			child.reason_stopped,
			child.stopped,
			child.stopped_date,
			child.medication_status,
			child.time,
			child.is_prn,
			child.medication_type,
			child.is_pink,
			child.route_of_administration,
			child.strength,
			parent.name AS order_name,
			parent.posting_date,
			parent.start_date AS order_start_date,
			parent.end_date AS order_end_date,
			parent.status AS order_status,
			parent.practitioner,
			parent.healthcare_practitioner_name,
			parent.user_name,
			parent.inpatient_record,
			parent.patient_encounter,
			parent.care_context
		FROM `tabInpatient Medication Order Entry` AS child
		INNER JOIN `tabPatient Medication Order` AS parent
			ON child.parent = parent.name
			AND child.parenttype = 'Patient Medication Order'
		WHERE {where_sql}
		ORDER BY IFNULL(child.date, parent.posting_date) ASC, parent.creation ASC, child.idx ASC
		""",
		params,
		as_dict=True,
	)

	from healthcare.api.medication_order_display import medication_entry_display_fields

	seen = set()
	medications = []
	for row in rows:
		entry_name = row.get("entry_name")
		if entry_name and entry_name in seen:
			continue
		if entry_name:
			seen.add(entry_name)

		display = medication_entry_display_fields(
			row,
			parent_start_date=row.get("order_start_date"),
			parent_end_date=row.get("order_end_date"),
		)
		drug_name = row.get("drug_name") or ""
		if not drug_name and row.get("drug"):
			drug_name = frappe.get_cached_value("Item", row.drug, "item_name") or ""

		medications.append(
			{
				"name": entry_name,
				"order_name": row.get("order_name"),
				"drug": row.get("drug"),
				"drug_name": drug_name,
				"medication": row.get("medication"),
				"old_medicine_code": row.get("old_medicine_code"),
				"old_medicine_name": row.get("old_medicine_name"),
				"medicine_no": row.get("medicine_no"),
				"dosage": row.get("dosage"),
				"dosage_form": row.get("dosage_form"),
				"quantity": row.get("quantity"),
				"uom": row.get("uom"),
				"instructions": row.get("instructions"),
				"frequency": display["display_frequency"],
				"patient_frequency": row.get("patient_frequency"),
				"date": row.get("date"),
				"start_date": display["display_start_date"],
				"end_date": display["display_end_date"],
				"time": row.get("time"),
				"is_prn": row.get("is_prn"),
				"medication_type": row.get("medication_type") or "",
				"is_pink": row.get("is_pink"),
				"route_of_administration": row.get("route_of_administration"),
				"display_drug_name": display["display_drug_name"],
				"display_dosage": display["display_dosage"],
				"is_legacy": display["is_legacy"],
				"order_status": row.get("order_status"),
				"posting_date": str(row.get("posting_date")) if row.get("posting_date") else None,
				"practitioner": row.get("practitioner"),
				"practitioner_name": row.get("healthcare_practitioner_name") or row.get("user_name"),
				"care_context": row.get("care_context"),
			}
		)

	return {
		"note_date": str(note_day),
		"patient": patient,
		"medications": medications,
		"count": len(medications),
	}


@frappe.whitelist()
def update_medication_order_status(name: str, status: str):
    """
    Update medication order status
    """
    assert_editing_allowed()
    if not name:
        frappe.throw(_("Medication order name is required"))
    
    if status not in ['Active', 'Completed', 'Discontinued']:
        frappe.throw(_("Invalid status. Must be Active, Completed, or Discontinued"))
    
    doc = frappe.get_doc("Patient Medication Order", name)
    doc.status = status
    
    if status == 'Completed':
        doc.to_date = frappe.utils.today()
    
    doc.save(ignore_permissions=False)
    frappe.db.commit()
    
    return {
        "success": True,
        "message": f"Prescription {name} status updated to {status}"
    }


_MEDICATION_ENTRY_DATE_FIELDS = frozenset({"date", "end_date", "no_of_days", "time"})
_MEDICATION_ENTRY_CHECKBOX_FIELDS = frozenset({"is_pink", "is_prn", "is_long_acting_medicine"})
# Any change to these fields discontinues the line and creates a replacement.
_MEDICATION_ENTRY_AMEND_FIELDS = frozenset(
	{
		"drug",
		"dosage",
		"uom",
		"dosage_form",
		"instructions",
		"patient_frequency",
		"long_acting_frequency",
		"route_of_administration",
		"reference_no",
		"is_pink",
		"is_prn",
		"is_long_acting_medicine",
		"medication_type",
		"frequency_in_a_day",
		"healthcare_practitioner",
	}
)
_MEDICATION_ENTRY_ALLOWED_FIELDS = [
	"drug",
	"drug_name",
	"dosage",
	"uom",
	"dosage_form",
	"no_of_days",
	"instructions",
	"date",
	"end_date",
	"time",
	"patient_frequency",
	"route_of_administration",
	"reference_no",
	"is_pink",
	"is_prn",
	"is_long_acting_medicine",
	"long_acting_frequency",
	"medication_type",
	"frequency_in_a_day",
	"healthcare_practitioner",
	"healthcare_practitioner_name",
]


def _norm_medication_entry_value(field, value):
	if field in _MEDICATION_ENTRY_CHECKBOX_FIELDS:
		return cint(value)
	if field in ("date", "end_date"):
		if not value:
			return ""
		try:
			return str(getdate(value))
		except Exception:
			return cstr(value).strip()
	if field == "no_of_days":
		return flt(value)
	if field == "medication_type":
		return _normalize_prescription_type(value)
	if field == "frequency_in_a_day":
		return cint(value)
	text = cstr(value).strip() if value is not None else ""
	if field in ("uom", "dosage_form", "route_of_administration", "patient_frequency", "long_acting_frequency"):
		return text.casefold()
	return text


def _medication_entry_clinical_changes(entry, updates):
	clinical = []
	date_only = []
	for field in _MEDICATION_ENTRY_ALLOWED_FIELDS:
		if field not in updates:
			continue
		old = _norm_medication_entry_value(field, getattr(entry, field, None))
		new = _norm_medication_entry_value(field, updates.get(field))
		if old == new:
			continue
		if field in _MEDICATION_ENTRY_DATE_FIELDS:
			date_only.append(field)
		elif field in _MEDICATION_ENTRY_AMEND_FIELDS:
			clinical.append(field)
	return clinical, date_only


def _discontinue_medication_entry(doc, entry, reason):
	entry.medication_status = "Discontinued"
	if hasattr(entry, "stopped"):
		entry.stopped = 1
	if hasattr(entry, "reason_stopped"):
		entry.reason_stopped = reason
	if hasattr(entry, "stopped_date"):
		entry.stopped_date = nowdate()
	if hasattr(entry, "stop_by"):
		entry.stop_by = frappe.session.user
	# End the line on the discontinue day (UI inactive/period uses end_date).
	if entry.meta.has_field("end_date"):
		entry.end_date = nowdate()


@frappe.whitelist()
def update_medication_order_entry(patient_medication_order, order_entry_name, updates, reason=None):
    """Update a single medication order entry (child table row) in a Patient Medication Order.

    Date / duration-only changes are saved on the same line.
    Changing dose, frequency, UOM, route, type, or instructions discontinues the
    existing line and appends a replacement so the original order is preserved.
    """
    assert_editing_allowed()
    import json
    if isinstance(updates, str):
        updates = json.loads(updates)

    doc = frappe.get_doc("Patient Medication Order", patient_medication_order)
    _ensure_pmo_write_permission(doc)
    entry = None
    for row in doc.get("medication_orders", []):
        if row.name == order_entry_name:
            entry = row
            break

    if not entry:
        frappe.throw(f"Medication order entry {order_entry_name} not found")

    if (entry.get("medication_status") or "").strip() == "Discontinued" or cint(entry.get("stopped")):
        frappe.throw(_("This medicine has been discontinued and cannot be edited."))

    allowed_fields = list(_MEDICATION_ENTRY_ALLOWED_FIELDS)
    clinical_changed, _date_changed = _medication_entry_clinical_changes(entry, updates)

    if clinical_changed:
        reason = cstr(reason or updates.get("change_reason") or "").strip()
        if not reason:
            frappe.throw(
                _("A reason is required when changing dosage, dosage form, unit of measure, route, prescription type, frequency, or other details.")
            )
        old_drug = entry.get("drug")
        old_drug_name = entry.get("drug_name")
        old_uom = entry.get("uom")
        old_route = entry.get("route_of_administration")
        _discontinue_medication_entry(doc, entry, reason)

        skip = {
            "name",
            "owner",
            "creation",
            "modified",
            "modified_by",
            "parent",
            "parentfield",
            "parenttype",
            "idx",
            "docstatus",
            "doctype",
            "medication_status",
            "stopped",
            "reason_stopped",
            "stopped_date",
            "stop_by",
            "is_completed",
            "quantity",
            "amount",
        }
        new_data = {
            k: v
            for k, v in entry.as_dict().items()
            if k not in skip
        }
        for field, value in updates.items():
            if field in allowed_fields:
                new_data[field] = value
        new_data.pop("change_reason", None)
        new_entry = _set_medication_row(doc, new_data)
        if new_entry.meta.has_field("old_medicine_name"):
            new_entry.old_medicine_name = old_drug_name or old_drug
        if new_entry.meta.has_field("old_unit") and old_uom:
            new_entry.old_unit = old_uom
        if new_entry.meta.has_field("old_route") and old_route:
            new_entry.old_route = old_route

        if "healthcare_practitioner" in updates or "practitioner" in updates:
            _apply_entry_healthcare_practitioner(
                new_entry,
                updates.get("healthcare_practitioner") or updates.get("practitioner"),
                parent_doc=doc,
            )

        if (
            cint(getattr(new_entry, "is_pink", 0))
            and not cstr(getattr(new_entry, "reference_no", "") or "").strip()
            and _pink_reference_required_for_pmo(doc)
        ):
            drug_label = getattr(new_entry, "drug_name", None) or getattr(new_entry, "drug", None)
            frappe.throw(
                _("Reference No is required for pink medication: {0}").format(drug_label),
                title=_("Missing Reference No"),
            )

        normalized = _normalize_long_acting_medication_row(new_entry.as_dict())
        if normalized.get("patient_frequency"):
            new_entry.patient_frequency = normalized["patient_frequency"]
            new_entry.frequency_in_a_day = frappe.db.get_value(
                "Prescription Frequency", new_entry.patient_frequency, "frequency_in_a_day"
            ) or 0
        if normalized.get("is_long_acting_medicine") or (
            (normalized.get("medication_type") or "").strip() == "Long Acting Medicine"
        ):
            new_entry.is_long_acting_medicine = 1
            if new_entry.meta.has_field("long_acting_frequency") and normalized.get("long_acting_frequency"):
                new_entry.long_acting_frequency = normalized["long_acting_frequency"]

        doc.save(ignore_permissions=True)
        log = frappe.new_doc("Medication Status Log")
        log.patient_medication_order = doc.name
        log.medication_entry = entry.name
        log.patient = doc.get("patient")
        log.drug = entry.get("drug")
        log.drug_name = entry.get("drug_name")
        log.action = "Discontinue"
        log.new_status = "Discontinued"
        log.reason = reason
        log.insert(ignore_permissions=True)
        long_acting = []
        if _entry_is_long_acting(new_entry):
            long_acting = _create_long_acting_medicine_for_entries(doc, only_entry_names=[new_entry.name])
        frappe.db.commit()
        return {
            "ok": True,
            "amended": True,
            "entry": new_entry.as_dict(),
            "discontinued_entry": entry.name,
            "long_acting_medicine": long_acting,
        }

    for field, value in updates.items():
        if field in allowed_fields:
            entry.set(field, value)

    if "healthcare_practitioner" in updates or "practitioner" in updates:
        _apply_entry_healthcare_practitioner(
            entry,
            updates.get("healthcare_practitioner") or updates.get("practitioner"),
            parent_doc=doc,
        )

    if (
        cint(getattr(entry, "is_pink", 0))
        and not cstr(getattr(entry, "reference_no", "") or "").strip()
        and _pink_reference_required_for_pmo(doc)
    ):
        drug_label = getattr(entry, "drug_name", None) or getattr(entry, "drug", None) or order_entry_name
        frappe.throw(
            _("Reference No is required for pink medication: {0}").format(drug_label),
            title=_("Missing Reference No"),
        )

    normalized = _normalize_long_acting_medication_row(entry.as_dict())
    if normalized.get("patient_frequency"):
        entry.patient_frequency = normalized["patient_frequency"]
        entry.frequency_in_a_day = frappe.db.get_value(
            "Prescription Frequency", entry.patient_frequency, "frequency_in_a_day"
        ) or 0
    if normalized.get("is_long_acting_medicine") or (
        (normalized.get("medication_type") or "").strip() == "Long Acting Medicine"
    ):
        entry.is_long_acting_medicine = 1
        if entry.meta.has_field("long_acting_frequency") and normalized.get("long_acting_frequency"):
            entry.long_acting_frequency = normalized["long_acting_frequency"]

    doc.save(ignore_permissions=True)
    long_acting = []
    if _entry_is_long_acting(entry):
        long_acting = _create_long_acting_medicine_for_entries(doc, only_entry_names=[entry.name])
    frappe.db.commit()

    return {"ok": True, "entry": entry.as_dict(), "long_acting_medicine": long_acting}


@frappe.whitelist()
def add_medication_order_entry(patient_medication_order, entry_data):
    """Add a new medication order entry to an existing Patient Medication Order.

    Args:
        patient_medication_order: Parent document name
        entry_data: JSON string or dict of new entry fields
    """
    import json
    if isinstance(entry_data, str):
        entry_data = json.loads(entry_data)

    entry_data = _normalize_long_acting_medication_row(entry_data)

    # Doctor who added this line (any doctor may add after the original Rx)
    hp = cstr(
        entry_data.get("healthcare_practitioner") or entry_data.get("practitioner") or ""
    ).strip()
    if not hp:
        frappe.throw(_("Doctor is required when adding a medication"), title=_("Missing Doctor"))
    entry_data["healthcare_practitioner"] = hp

    doc = frappe.get_doc("Patient Medication Order", patient_medication_order)

    if (
        cint(entry_data.get("is_pink"))
        and not cstr(entry_data.get("reference_no") or "").strip()
        and _pink_reference_required_for_pmo(doc)
    ):
        drug_label = entry_data.get("drug_name") or entry_data.get("drug") or ""
        frappe.throw(
            _("Reference No is required for pink medication: {0}").format(drug_label or _("Unknown")),
            title=_("Missing Reference No"),
        )

    new_entry = _set_medication_row(doc, entry_data)

    doc.save(ignore_permissions=True)
    long_acting = []
    if _entry_is_long_acting(new_entry):
        long_acting = _create_long_acting_medicine_for_entries(doc, only_entry_names=[new_entry.name])
    frappe.db.commit()

    return {
        "ok": True,
        "entry": new_entry.as_dict(),
        "prescription": doc.name,
        "long_acting_medicine": long_acting,
    }


@frappe.whitelist()
def check_medicine_given_for_entry(patient_medication_order, order_entry_name):
    """Check if any medicine has been given for a specific medication order entry.

    Returns True if there's at least one Medicine Given record that references
    this medication order entry.
    """
    doc = frappe.get_doc("Patient Medication Order", patient_medication_order)
    entry = None
    for row in doc.get("medication_orders", []):
        if row.name == order_entry_name:
            entry = row
            break

    if not entry:
        return {"has_given": False}

    # Medicine Given is a child table of Admission Detail, linked via medication_order (PMO name)
    # and medicine_code (Item code). There is no direct link to the order entry row.
    admission = getattr(doc, "inpatient_record", None)
    if not admission:
        return {"has_given": False, "count": 0}

    admission_detail_name = frappe.db.get_value("Admission Detail", {"admission": admission}, "name")
    if not admission_detail_name:
        return {"has_given": False, "count": 0}

    # Primary check: match by PMO link and drug code on Medicine Given child rows
    count = frappe.db.count("Medicine Given", filters={
        "parent": admission_detail_name,
        "parenttype": "Admission Detail",
        "medication_order": patient_medication_order,
        "medicine_code": entry.drug,
    })

    if count == 0:
        # Fallback: match by drug code only (in case medication_order was not set on older rows)
        count = frappe.db.count("Medicine Given", filters={
            "parent": admission_detail_name,
            "parenttype": "Admission Detail",
            "medicine_code": entry.drug,
        })

    return {"has_given": count > 0, "count": count}


@frappe.whitelist()
def get_given_status_for_prescription(patient_medication_order):
    """Return given/not-given status for every medication order entry in a prescription.

    Returns a dict keyed by entry name with {has_given: bool, count: int}.
    Efficient batch version — does a single DB query for all Medicine Given rows.
    """
    doc = frappe.get_doc("Patient Medication Order", patient_medication_order)
    entries = doc.get("medication_orders", [])

    result = {}
    if not entries:
        return result

    admission = getattr(doc, "inpatient_record", None)
    if not admission:
        for row in entries:
            result[row.name] = {"has_given": False, "count": 0}
        return result

    admission_detail_name = frappe.db.get_value(
        "Admission Detail", {"admission": admission}, "name"
    )
    if not admission_detail_name:
        for row in entries:
            result[row.name] = {"has_given": False, "count": 0}
        return result

    given_rows = frappe.get_all(
        "Medicine Given",
        filters={
            "parent": admission_detail_name,
            "parenttype": "Admission Detail",
        },
        fields=["medicine_code", "medication_order"],
        ignore_permissions=True,
    )

    given_by_pmo_drug: dict[tuple, int] = {}
    given_by_drug: dict[str, int] = {}
    for g in given_rows:
        key = (g.get("medication_order") or "", g.get("medicine_code") or "")
        given_by_pmo_drug[key] = given_by_pmo_drug.get(key, 0) + 1
        drug = g.get("medicine_code") or ""
        if drug:
            given_by_drug[drug] = given_by_drug.get(drug, 0) + 1

    pmo_name = doc.name
    for row in entries:
        primary = given_by_pmo_drug.get((pmo_name, row.drug), 0)
        if primary > 0:
            result[row.name] = {"has_given": True, "count": primary}
        else:
            fallback = given_by_drug.get(row.drug, 0)
            result[row.name] = {"has_given": fallback > 0, "count": fallback}

    return result


def _resolve_sales_order_reference(pmo):
	"""Return (ref_doctype, ref_name) for healthcare context on Sales Order."""
	ref_doctype = None
	ref_name = None
	if pmo.care_context == "Inpatient Admission" and pmo.inpatient_record:
		ref_doctype = "Inpatient Admission"
		ref_name = pmo.inpatient_record
	elif pmo.care_context == "Patient Visit" and pmo.patient_encounter:
		ref_doctype = "Patient Visit"
		ref_name = pmo.patient_encounter
	elif pmo.inpatient_record:
		ref_doctype = "Inpatient Admission"
		ref_name = pmo.inpatient_record
	elif pmo.patient_encounter:
		ref_doctype = "Patient Visit"
		ref_name = pmo.patient_encounter
	return ref_doctype, ref_name


def _pharmacy_giveout_billing_groups_from_pmo(pmo):
	"""Build SO/DN billing groups with batch and dispensing lot from pharmacy give-out stock lines.

	When a medicine qty spans multiple dispensing lots, one group is emitted per lot
	allocation so the Delivery Note can consume each lot correctly.
	"""
	stock_lines = getattr(getattr(pmo, "flags", None), "pharmacy_giveout_item_stock", None) or []
	groups = []
	for idx, row in enumerate(pmo.get("medication_orders") or []):
		if not getattr(row, "drug", None):
			continue
		stock = stock_lines[idx] if idx < len(stock_lines) else {}
		row_qty = flt(getattr(row, "quantity", 0)) or 1
		allocations = stock.get("allocations") or []
		if not allocations:
			allocations = [
				{
					"medicine_code": row.drug,
					"batch_no": stock.get("batch_no"),
					"dispensing_lot": stock.get("dispensing_lot"),
					"qty": row_qty,
				}
			]
		for alloc in allocations:
			groups.append(
				{
					"medicine_code": row.drug,
					"medicine_name": getattr(row, "drug_name", None) or row.drug,
					"qty": flt(alloc.get("qty")) or row_qty,
					"batch_no": alloc.get("batch_no") or stock.get("batch_no"),
					"dispensing_lot": alloc.get("dispensing_lot") or stock.get("dispensing_lot"),
				}
			)
	return groups


def _delivery_notes_for_sales_order(sales_order):
	"""Draft or submitted Delivery Notes linked to a Sales Order."""
	if not sales_order:
		return []
	return frappe.db.sql_list(
		"""
		SELECT DISTINCT dn.name
		FROM `tabDelivery Note` dn
		INNER JOIN `tabDelivery Note Item` dni ON dni.parent = dn.name
		WHERE dni.against_sales_order = %s AND dn.docstatus < 2
		ORDER BY dn.creation DESC
		""",
		sales_order,
	)


def _cancel_submitted_or_delete_draft(doctype, name):
	"""Cancel a submitted document or delete a draft. Returns the name if handled."""
	if not name or not frappe.db.exists(doctype, name):
		return None
	doc = frappe.get_doc(doctype, name)
	if doc.docstatus == 2:
		return None
	doc.flags.ignore_permissions = True
	if doc.docstatus == 1:
		doc.cancel()
		return name
	frappe.delete_doc(doctype, name, ignore_permissions=True, force=True)
	return name


def _cancel_delivery_notes_for_sales_order(sales_order):
	cancelled = []
	for dn_name in _delivery_notes_for_sales_order(sales_order):
		handled = _cancel_submitted_or_delete_draft("Delivery Note", dn_name)
		if handled:
			cancelled.append(handled)
	return cancelled


def _sales_orders_for_pharmacy_giveout(pmo_name, pmo_doc=None):
	"""Sales Orders for a give-out: PMO reference and/or SO custom_base_reference."""
	names = []
	seen = set()

	def _add(name):
		name = (name or "").strip()
		if not name or name in seen:
			return
		if frappe.db.exists("Sales Order", name):
			seen.add(name)
			names.append(name)

	if pmo_doc is not None:
		if pmo_doc.get("reference_doctype") == "Sales Order":
			_add(pmo_doc.get("reference_document_name"))

	so_meta = frappe.get_meta("Sales Order")
	if so_meta.has_field("custom_base_reference_name"):
		filters = {"custom_base_reference_name": pmo_name, "docstatus": ["<", 2]}
		if so_meta.has_field("custom_base_reference"):
			filters["custom_base_reference"] = "Patient Medication Order"
		for so_name in frappe.get_all("Sales Order", filters=filters, pluck="name"):
			_add(so_name)

	return names


def _names_from_optional_doctype(doctype, sales_order, pmo_name=None):
	"""Find Selling Note / Sales Invoice / similar docs linked to this give-out SO."""
	if not doctype or not frappe.db.exists("DocType", doctype):
		return []
	meta = frappe.get_meta(doctype)
	found = set()

	def _add_parents(child_dt, fieldname, value):
		if not value or not frappe.db.exists("DocType", child_dt):
			return
		child_meta = frappe.get_meta(child_dt)
		if not child_meta.has_field(fieldname):
			return
		for parent in frappe.get_all(
			child_dt,
			filters={fieldname: value},
			pluck="parent",
		):
			if parent:
				found.add(parent)

	for df in meta.get_table_fields() or []:
		_add_parents(df.options, "against_sales_order", sales_order)
		_add_parents(df.options, "sales_order", sales_order)

	filters_candidates = []
	if meta.has_field("sales_order"):
		filters_candidates.append({"sales_order": sales_order, "docstatus": ["<", 2]})
	if meta.has_field("against_sales_order"):
		filters_candidates.append({"against_sales_order": sales_order, "docstatus": ["<", 2]})
	if pmo_name and meta.has_field("custom_base_reference_name"):
		ref_filters = {"custom_base_reference_name": pmo_name, "docstatus": ["<", 2]}
		if meta.has_field("custom_base_reference"):
			ref_filters["custom_base_reference"] = "Patient Medication Order"
		filters_candidates.append(ref_filters)

	for filters in filters_candidates:
		for name in frappe.get_all(doctype, filters=filters, pluck="name"):
			found.add(name)

	# Keep only live (draft/submitted) documents.
	live = []
	for name in found:
		if frappe.db.exists(doctype, name) and frappe.db.get_value(doctype, name, "docstatus") != 2:
			live.append(name)
	return live


def _sales_invoices_for_sales_order(sales_order):
	if not sales_order:
		return []
	parents = frappe.get_all(
		"Sales Invoice Item",
		filters={"sales_order": sales_order},
		pluck="parent",
	)
	names = []
	seen = set()
	for parent in parents:
		if parent in seen:
			continue
		seen.add(parent)
		if frappe.db.exists("Sales Invoice", parent) and frappe.db.get_value(
			"Sales Invoice", parent, "docstatus"
		) != 2:
			names.append(parent)
	return names


def _cancel_selling_documents_for_sales_order(sales_order, pmo_name=None):
	"""Cancel Selling Note (if present) and linked Sales Invoices for the SO."""
	cancelled = {"selling_notes": [], "sales_invoices": []}
	for sn_name in _names_from_optional_doctype("Selling Note", sales_order, pmo_name):
		handled = _cancel_submitted_or_delete_draft("Selling Note", sn_name)
		if handled:
			cancelled["selling_notes"].append(handled)
	for si_name in _sales_invoices_for_sales_order(sales_order):
		handled = _cancel_submitted_or_delete_draft("Sales Invoice", si_name)
		if handled:
			cancelled["sales_invoices"].append(handled)
	return cancelled


def _cancel_service_requests_for_sales_order(sales_order):
	cancelled = []
	if not sales_order or not frappe.db.exists("DocType", "Service Request"):
		return cancelled
	names = frappe.get_all(
		"Service Request",
		filters={
			"reference_document_type": "Sales Order",
			"reference_document_name": sales_order,
			"docstatus": ["<", 2],
		},
		pluck="name",
	)
	for sr_name in names:
		handled = _cancel_submitted_or_delete_draft("Service Request", sr_name)
		if handled:
			cancelled.append(handled)
	return cancelled


def _apply_stock_to_sales_order_item_row(item_row, batch_no=None, dispensing_lot=None):
	"""Set batch and dispensing lot on a Sales Order item dict when fields exist."""
	batch_no = (batch_no or "").strip() or None
	dispensing_lot = (dispensing_lot or "").strip() or None
	if batch_no and frappe.get_meta("Sales Order Item").has_field("batch_no"):
		item_row["batch_no"] = batch_no
	if dispensing_lot:
		if frappe.db.has_column("Sales Order Item", "custom_dispensing_lot"):
			item_row["custom_dispensing_lot"] = dispensing_lot
		elif frappe.get_meta("Sales Order Item").has_field("serial_no"):
			serial_no = frappe.db.get_value("Dispensing Lot", dispensing_lot, "serial_no")
			if serial_no:
				item_row["serial_no"] = serial_no


def _resolve_pharmacy_giveout_charge_percent(no_charges=None, charge_percent=None):
	"""Resolve medicine billing percent for pharmacy give-out (0–100).

	``no_charges`` (ECT / included-in-session) forces 0%. Omitting both defaults to 100%.
	Important: 0 is a valid percent (no charges) — never coalesce it with ``or 100``.
	"""
	if cint(no_charges):
		return 0.0
	if charge_percent is None or charge_percent == "":
		return 100.0
	pct = flt(charge_percent)
	if pct < 0 or pct > 100:
		frappe.throw(_("Charge percent must be between 0 and 100"))
	return pct


def _pmo_giveout_charge_percent(pmo, charge_percent=None):
	"""Prefer explicit charge_percent; else PMO field; else 100. Treat 0 as no charges."""
	if charge_percent is not None and charge_percent != "":
		return _resolve_pharmacy_giveout_charge_percent(None, charge_percent)
	if pmo is not None and frappe.get_meta("Patient Medication Order").has_field("giveout_charge_percent"):
		val = getattr(pmo, "giveout_charge_percent", None)
		if val is not None and val != "":
			return _resolve_pharmacy_giveout_charge_percent(None, val)
	return 100.0


def _apply_giveout_charge_percent(full_rate, charge_percent):
	"""Apply give-out charge % to a list rate. Returns (billed_rate, price_list_rate)."""
	full_rate = flt(full_rate)
	pct = flt(charge_percent)
	if pct >= 100:
		return full_rate, full_rate
	if pct <= 0:
		# Keep price_list_rate at 0 too so ERPNext cannot fall back to list price.
		return 0.0, 0.0
	return flt(full_rate) * pct / 100.0, full_rate


def _set_giveout_item_pricing(item_row, full_rate, charge_percent):
	"""Write rate / price list / amount for a give-out SO item (mutates item_row)."""
	billed_rate, price_list_rate = _apply_giveout_charge_percent(full_rate, charge_percent)
	pct = flt(charge_percent)
	qty = flt(item_row.get("qty") or 0)
	item_row["rate"] = billed_rate
	item_row["price_list_rate"] = price_list_rate
	item_row["amount"] = flt(billed_rate) * qty
	if pct <= 0:
		item_row["discount_percentage"] = 0
		item_row["discount_amount"] = 0
	elif pct < 100 and full_rate:
		item_row["discount_percentage"] = 100.0 - pct
		item_row["discount_amount"] = flt(full_rate - billed_rate) * qty


def _force_giveout_medicine_so_rates(so, pmo, charge_percent):
	"""Re-apply medicine rates after ERPNext pricing may have overwritten zeros."""
	pct = flt(charge_percent)
	if pct >= 100:
		return

	drug_codes = {
		(getattr(row, "drug", None) or "").strip()
		for row in (pmo.get("medication_orders") or [])
		if getattr(row, "drug", None)
	}
	drug_codes.discard("")
	if not drug_codes:
		return

	for item in so.get("items") or []:
		code = (getattr(item, "item_code", None) or "").strip()
		if code not in drug_codes:
			continue
		qty = flt(getattr(item, "qty", 0))
		if pct <= 0:
			item.rate = 0
			item.price_list_rate = 0
			item.amount = 0
			if hasattr(item, "net_rate"):
				item.net_rate = 0
			if hasattr(item, "net_amount"):
				item.net_amount = 0
			if hasattr(item, "base_rate"):
				item.base_rate = 0
			if hasattr(item, "base_amount"):
				item.base_amount = 0
			if hasattr(item, "discount_percentage"):
				item.discount_percentage = 0
			if hasattr(item, "discount_amount"):
				item.discount_amount = 0
		else:
			full = flt(getattr(item, "price_list_rate", 0)) or get_item_rate_for_uom(
				code, getattr(item, "uom", None)
			)
			billed = flt(full) * pct / 100.0
			item.price_list_rate = full
			item.rate = billed
			item.amount = billed * qty
			if hasattr(item, "discount_percentage"):
				item.discount_percentage = 100.0 - pct

	if hasattr(so, "calculate_taxes_and_totals"):
		so.calculate_taxes_and_totals()


def _append_sales_order_items_from_pmo(so, pmo, warehouse=None, charge_percent=None):
	"""Append Sales Order items (with rates/taxes) from PMO medication rows.

	Pharmacy give-out may split one PMO medicine across several SO lines when the
	qty is allocated across multiple dispensing lots.
	"""
	tax_templates_added = set()
	stock_lines = getattr(getattr(pmo, "flags", None), "pharmacy_giveout_item_stock", None) or []
	charge_percent = _pmo_giveout_charge_percent(pmo, charge_percent)

	for idx, row in enumerate(pmo.get("medication_orders") or []):
		if not getattr(row, "drug", None):
			continue
		row_qty = flt(getattr(row, "quantity", 0)) or 1
		uom = (getattr(row, "uom", None) or "").strip() or frappe.db.get_value("Item", row.drug, "stock_uom")
		full_rate = flt(getattr(row, "rate", 0)) or get_item_rate_for_uom(row.drug, uom)

		stock = stock_lines[idx] if idx < len(stock_lines) else {}
		allocations = stock.get("allocations") or []
		if not allocations:
			allocations = [
				{
					"qty": row_qty,
					"batch_no": stock.get("batch_no"),
					"dispensing_lot": stock.get("dispensing_lot"),
				}
			]

		from erpnext.stock.get_item_details import get_conversion_factor

		conversion_factor = 1
		if uom:
			conversion_factor = flt(get_conversion_factor(row.drug, uom).get("conversion_factor")) or 1

		for alloc in allocations:
			qty = flt(alloc.get("qty")) or row_qty
			item_row = {
				"item_code": row.drug,
				"qty": qty,
				"description": getattr(row, "drug_name", None) or row.drug,
			}
			if uom:
				item_row["uom"] = uom
				item_row["conversion_factor"] = conversion_factor
			_set_giveout_item_pricing(item_row, full_rate, charge_percent)
			if warehouse:
				item_row["warehouse"] = warehouse
			_apply_stock_to_sales_order_item_row(
				item_row,
				batch_no=alloc.get("batch_no") or stock.get("batch_no"),
				dispensing_lot=alloc.get("dispensing_lot") or stock.get("dispensing_lot"),
			)
			so.append("items", item_row)

		tax_info = get_item_tax(row.drug, pmo.company)
		tax_template = tax_info.get("tax_template")
		if tax_template and tax_template not in tax_templates_added:
			tax_account = get_tax_account(tax_template)
			if tax_account:
				so.append(
					"taxes",
					{
						"charge_type": "On Net Total",
						"account_head": tax_account,
						"description": f"Tax: {tax_template}",
						"rate": tax_info.get("tax_rate", 0),
						"included_in_print_rate": 0,
						"included_in_paid_amount": 0,
					},
				)
				tax_templates_added.add(tax_template)

	return tax_templates_added


def _append_sales_order_service_items(so, services, company=None, tax_templates_added=None):
	"""Append non-stock pharmacy/other service lines to the give-out Sales Order (not on PMO)."""
	tax_templates_added = tax_templates_added if tax_templates_added is not None else set()
	for svc in services or []:
		item_code = (svc.get("item_code") or svc.get("id") or "").strip()
		if not item_code:
			continue
		qty = flt(svc.get("quantity") or svc.get("qty") or 1) or 1
		uom = (svc.get("uom") or "").strip() or frappe.db.get_value("Item", item_code, "stock_uom")
		rate = flt(svc.get("rate") or svc.get("price") or 0)
		if rate <= 0:
			rate = get_item_rate_for_uom(item_code, uom)
		if rate <= 0:
			frappe.throw(
				_("Enter an amount for pharmacy service: {0}").format(
					svc.get("item_name") or svc.get("label") or item_code
				)
			)
		item_row = {
			"item_code": item_code,
			"qty": qty,
			"rate": rate,
			"price_list_rate": rate,
			"description": svc.get("item_name") or svc.get("label") or item_code,
		}
		if uom:
			item_row["uom"] = uom
		so.append("items", item_row)

		tax_info = get_item_tax(item_code, company)
		tax_template = tax_info.get("tax_template")
		if tax_template and tax_template not in tax_templates_added:
			tax_account = get_tax_account(tax_template)
			if tax_account:
				so.append(
					"taxes",
					{
						"charge_type": "On Net Total",
						"account_head": tax_account,
						"description": f"Tax: {tax_template}",
						"rate": tax_info.get("tax_rate", 0),
						"included_in_print_rate": 0,
						"included_in_paid_amount": 0,
					},
				)
				tax_templates_added.add(tax_template)

	return tax_templates_added


def _create_submitted_sales_order_for_pmo(pmo, cost_center=None, warehouse=None, services=None, charge_percent=None):
	"""Create and submit Sales Order for a submitted PMO; link back on PMO.

	``services`` are billed on the Sales Order only (not written to the PMO).
	``charge_percent`` applies to medicine lines only (0 = no drug charges).
	"""
	if pmo.docstatus != 1:
		frappe.throw(_("Only submitted Patient Medication Orders can create Sales Orders"))

	if getattr(pmo, "reference_doctype", None) == "Sales Order" and getattr(pmo, "reference_document_name", None):
		if frappe.db.exists("Sales Order", pmo.reference_document_name):
			so = frappe.get_doc("Sales Order", pmo.reference_document_name)
			return so

	if not pmo.company:
		frappe.throw(_("Company is required on Patient Medication Order"))
	if not pmo.patient:
		frappe.throw(_("Patient is required on Patient Medication Order"))

	ref_doctype, ref_name = _resolve_sales_order_reference(pmo)
	if not ref_doctype or not ref_name:
		frappe.throw(
			_("Patient Medication Order {0} must be linked to a Patient Visit or Inpatient Admission to create a Sales Order.").format(
				pmo.name
			)
		)

	customer = frappe.db.get_value("Patient", pmo.patient, "customer")
	if not customer:
		frappe.throw(
			_("Patient {0} has no Customer linked. Link a customer on the patient record first.").format(pmo.patient)
		)

	so = frappe.new_doc("Sales Order")
	so.company = pmo.company
	so.patient = pmo.patient
	so.customer = customer
	so.transaction_date = nowdate()
	so.delivery_date = nowdate()
	if getattr(pmo, "patient_name", None):
		so.custom_patient_name = pmo.patient_name
	so.custom_patient = pmo.patient
	so.custom_reference_type = ref_doctype
	so.custom_reference_name = ref_name
	so.custom_base_reference = "Patient Medication Order"
	so.custom_base_reference_name = pmo.name

	if warehouse and hasattr(so, "set_warehouse"):
		so.set_warehouse = warehouse

	if getattr(pmo, "nursing_pharmacy_giveout", 0) and hasattr(so, "reserve_stock"):
		so.reserve_stock = 0
		if frappe.get_meta("Sales Order").has_field("custom_is_pharmacy_give_out"):
			so.custom_is_pharmacy_give_out = 1

	charge_percent = _pmo_giveout_charge_percent(pmo, charge_percent)

	if flt(charge_percent) <= 0 and frappe.get_meta("Sales Order").has_field("custom_no_charges"):
		so.custom_no_charges = 1

	# Prevent ERPNext pricing rules / price list from restoring full rates on no-charge lines.
	so.ignore_pricing_rule = 1
	so.flags.ignore_pricing_rule = True

	tax_templates_added = _append_sales_order_items_from_pmo(
		so, pmo, warehouse=warehouse, charge_percent=charge_percent
	)
	_append_sales_order_service_items(
		so, services, company=pmo.company, tax_templates_added=tax_templates_added
	)

	if not so.items:
		frappe.throw(_("No medication items found to create a Sales Order"))

	cc = cost_center or cost_center_from_patient_medication_order(pmo, ref_doctype, ref_name)
	apply_cost_center_to_sales_order(so, cc)

	_force_giveout_medicine_so_rates(so, pmo, charge_percent)
	so.insert(ignore_permissions=True)
	_force_giveout_medicine_so_rates(so, pmo, charge_percent)
	if flt(charge_percent) < 100:
		so.flags.ignore_pricing_rule = True
		so.save(ignore_permissions=True)
	so.submit()

	# PMO is already submitted — persist the SO link without a full save.
	pmo.db_set("reference_doctype", "Sales Order", update_modified=False)
	pmo.db_set("reference_document_name", so.name, update_modified=False)
	pmo.reference_doctype = "Sales Order"
	pmo.reference_document_name = so.name

	return so


def _resolve_hst_for_pharmacy_service(item_code=None, template_dn=None):
	"""Resolve Healthcare Service Template for a pharmacy/other service item."""
	template_dn = (template_dn or "").strip() or None
	if template_dn and frappe.db.exists("Healthcare Service Template", template_dn):
		return template_dn
	item_code = (item_code or "").strip()
	if not item_code:
		return None
	name = frappe.db.get_value(
		"Healthcare Service Template",
		{"item_code": item_code, "disabled": 0},
		"name",
	)
	if name:
		return name
	return frappe.db.get_value(
		"Healthcare Service Template",
		{"service_id": item_code, "disabled": 0},
		"name",
	)


def _create_completed_service_requests_for_giveout(
	services,
	patient,
	inpatient_record=None,
	patient_visit=None,
	cost_center=None,
	practitioner=None,
	company=None,
	sales_order=None,
):
	"""Create Other Service SRs for give-out services already billed on the Sales Order, then complete them."""
	created = []
	for svc in services or []:
		item_code = (svc.get("item_code") or svc.get("id") or "").strip()
		template_dn = _resolve_hst_for_pharmacy_service(
			item_code=item_code, template_dn=svc.get("template_dn")
		)
		if not template_dn:
			frappe.throw(
				_(
					"No Healthcare Service Template found for service {0}. "
					"Link an Other Service template to this item before giving out."
				).format(svc.get("item_name") or item_code or _("Unknown"))
			)

		qty = flt(svc.get("quantity") or svc.get("qty") or 1) or 1
		rate = flt(svc.get("rate") or svc.get("price") or 0)
		amount = rate * qty

		sr = frappe.new_doc("Service Request")
		sr.patient = patient
		if patient_visit:
			sr.patient_visit = patient_visit
		if inpatient_record:
			sr.inpatient_record = inpatient_record
		sr.template_dt = "Healthcare Service Template"
		sr.template_dn = template_dn
		if practitioner:
			sr.practitioner = practitioner
		if cost_center:
			sr.cost_center = cost_center
		if company and frappe.get_meta("Service Request").has_field("company"):
			sr.company = company
		sr.order_date = nowdate()
		sr.quantity = qty
		sr.cost = amount
		sr.grand_total = amount
		sr.status = "draft-Request Status"
		sr.naming_series = "HSR-"
		sr.insert(ignore_permissions=True)

		sr.db_set("patient_accepted_cost", 1)
		if sales_order:
			sr.db_set("reference_document_type", "Sales Order")
			sr.db_set("reference_document_name", sales_order)
		if frappe.get_meta("Service Request").has_field("booked"):
			sr.db_set("booked", 1)
		sr.db_set("status", "completed-Request Status")
		if sr.docstatus == 0:
			try:
				sr.reload()
				sr.submit()
			except Exception:
				frappe.log_error(
					frappe.get_traceback(),
					f"Pharmacy give-out: could not submit Service Request {sr.name}",
				)
		created.append(sr.name)
	return created


@frappe.whitelist()
def get_pharmacy_giveout_service_items(search=None, care_context=None):
	"""Pharmacy / Other Service items for nursing pharmacy give-out Add Service."""
	if not _user_can_access_patient_medication_order_portal():
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	search = (search or "").strip()
	care_context = (care_context or "").strip().upper()
	is_op = care_context in ("OP", "PATIENT VISIT", "OUTPATIENT")

	out = []
	seen_items = set()

	def _append_row(item_code, label, rate, uom, template_dn=None):
		item_code = (item_code or "").strip()
		if not item_code or item_code in seen_items:
			return
		if not frappe.db.exists("Item", item_code):
			return
		if cint(frappe.db.get_value("Item", item_code, "disabled")):
			return
		seen_items.add(item_code)
		stock_uom = uom or frappe.db.get_value("Item", item_code, "stock_uom") or "Nos"
		resolved_rate = flt(rate)
		if resolved_rate <= 0:
			resolved_rate = get_item_rate_for_uom(item_code, stock_uom)
		out.append(
			{
				"id": item_code,
				"name": label or frappe.db.get_value("Item", item_code, "item_name") or item_code,
				"item_code": item_code,
				"price": resolved_rate,
				"rate": resolved_rate,
				"uom": stock_uom,
				"template_dt": "Healthcare Service Template" if template_dn else None,
				"template_dn": template_dn,
				"is_pharmacy_service": 1,
			}
		)

	templates = frappe.get_all(
		"Healthcare Service Template",
		filters={"disabled": 0},
		fields=["name", "service_name", "service_id", "item_code", "rate", "op_rate", "category"],
		order_by="service_name asc",
		limit_page_length=200,
	)
	for t in templates:
		item_code = (t.get("item_code") or t.get("service_id") or "").strip()
		if not item_code:
			continue
		label = (t.get("service_name") or item_code).strip()
		category = (t.get("category") or "").strip()
		is_other = category.lower() in ("other service", "other services")
		if search:
			term = search.lower()
			if (
				term not in label.lower()
				and term not in item_code.lower()
				and term not in (t.get("name") or "").lower()
			):
				continue
		elif not is_other:
			continue
		rate = flt(t.get("op_rate") if is_op and flt(t.get("op_rate")) > 0 else t.get("rate"))
		_append_row(item_code, label, rate, None, template_dn=t.get("name"))

	if frappe.db.has_column("Item", "custom_is_pharmacy_service"):
		items = frappe.get_all(
			"Item",
			filters={"disabled": 0, "custom_is_pharmacy_service": 1},
			fields=["name", "item_name", "stock_uom"],
			order_by="item_name asc",
			limit_page_length=100,
		)
		for item in items:
			if search:
				term = search.lower()
				if term not in (item.item_name or "").lower() and term not in (item.name or "").lower():
					continue
			template_dn = _resolve_hst_for_pharmacy_service(item_code=item.name)
			_append_row(item.name, item.item_name, 0, item.stock_uom, template_dn=template_dn)

	out.sort(key=lambda r: (r.get("name") or "").lower())
	return out[:50]


def _resolve_nursing_pharmacy_giveout_warehouse(cost_center, warehouse=None):
	"""Validate and resolve warehouse for pharmacy give-out from Healthcare Settings."""
	from healthcare.api.common import (
		get_pharmacy_giveout_warehouses,
		resolve_pharmacy_giveout_default_warehouse,
	)

	allowed = get_pharmacy_giveout_warehouses()
	if not allowed:
		frappe.throw(
			_(
				"No Pharmacy Give Out warehouses configured in Healthcare Settings. "
				"Add warehouses under Stock → Pharmacy Give Out."
			)
		)

	allowed_names = {row["name"] for row in allowed}
	warehouse = (warehouse or "").strip() or None
	if warehouse:
		if warehouse not in allowed_names:
			frappe.throw(
				_("Warehouse {0} is not configured for Pharmacy Give Out in Healthcare Settings.").format(warehouse)
			)
		return warehouse

	default_wh, _allowed = resolve_pharmacy_giveout_default_warehouse(cost_center)
	if not default_wh:
		frappe.throw(
			_(
				"No Pharmacy Give Out warehouse could be resolved for cost center {0}. "
				"Configure Pharmacy Give Out warehouses in Healthcare Settings."
			).format(cost_center or _("(not set)"))
		)
	return default_wh


@frappe.whitelist()
def get_nursing_pharmacy_giveout_warehouses(inpatient_record=None, patient_visit=None):
	"""Warehouses allowed for nursing pharmacy give-out plus default (nurse mini warehouse when listed).

	IP give-outs pass inpatient_record; OP give-outs pass patient_visit instead.
	"""
	if not _user_can_access_patient_medication_order_portal():
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if not inpatient_record and not patient_visit:
		frappe.throw(_("Inpatient Admission or Patient Visit is required"))
	if inpatient_record and not frappe.db.exists("Inpatient Admission", inpatient_record):
		frappe.throw(_("Inpatient Admission {0} does not exist").format(inpatient_record))
	if not inpatient_record and not frappe.db.exists("Patient Visit", patient_visit):
		frappe.throw(_("Patient Visit {0} does not exist").format(patient_visit))

	from healthcare.api.common import (
		get_pharmacy_giveout_warehouses,
		get_warehouse_for_cost_center,
		resolve_branch_pharmacy_warehouse,
		resolve_pharmacy_giveout_default_warehouse,
	)

	if inpatient_record:
		cost_center = frappe.db.get_value("Inpatient Admission", inpatient_record, "cost_center")
	else:
		cost_center = frappe.db.get_value("Patient Visit", patient_visit, "cost_center")
	warehouses = get_pharmacy_giveout_warehouses()
	default_warehouse, _allowed = resolve_pharmacy_giveout_default_warehouse(cost_center)
	mini_warehouse = get_warehouse_for_cost_center(cost_center) if cost_center else None
	pharmacy_warehouse = resolve_branch_pharmacy_warehouse(cost_center) if cost_center else None

	return {
		"warehouses": warehouses,
		"default_warehouse": default_warehouse,
		"mini_warehouse": mini_warehouse,
		"pharmacy_warehouse": pharmacy_warehouse,
		"cost_center": cost_center,
		"display_batch_and_lot_on_pharmacy_giveout": _display_batch_and_lot_on_pharmacy_giveout(),
	}


def _display_batch_and_lot_on_pharmacy_giveout() -> bool:
	from healthcare.api.medicine_given import display_batch_and_lot_on_pharmacy_giveout

	return display_batch_and_lot_on_pharmacy_giveout()


def _format_pharmacy_giveout_error(exc, warehouse=None):
	"""Turn stock/billing failures into readable portal messages."""
	raw = ""
	if isinstance(exc, frappe.ValidationError):
		raw = str(exc.args[0]) if exc.args else str(exc)
	else:
		raw = str(exc)

	raw = re.sub(r"<[^>]+>", " ", raw or "")
	raw = re.sub(r"\s+", " ", raw).strip()
	if not raw:
		return _("Pharmacy give-out could not be completed. Please try again.")

	wh_label = (warehouse or "").strip() or _("the selected warehouse")
	lower = raw.lower()

	if "allow zero valuation rate" in lower or (
		"zero rate" in lower and "valuation" in lower
	) or ("has zero rate" in lower and "allow zero" in lower):
		item_match = re.search(r"Item\s+([A-Za-z0-9\-_/]+)", raw, flags=re.IGNORECASE)
		item_code = item_match.group(1) if item_match else None
		if item_code:
			return _(
				"Item {0} has zero stock valuation rate. Set a valuation rate on the item/batch, or retry — pharmacy give-out now allows zero valuation on Delivery Note lines."
			).format(frappe.bold(item_code))
		return _(
			"One or more medicines have zero stock valuation rate. Set valuation rate on the item/batch, then retry."
		)

	if any(
		phrase in lower
		for phrase in (
			"negative stock",
			"not enough stock",
			"not enough batch stock",
			"insufficient stock",
			"stock balance for batch",
			"qty must be less than or equal to",
		)
	):
		# Prefer detailed shortage text when we already validated batches.
		if "need" in lower and "available" in lower:
			return raw
		return _(
			"Not enough stock in {0} for one or more medicines. Check batch quantities or choose another warehouse."
		).format(wh_label)

	if "needed" in lower and "warehouse" in lower:
		return raw

	if "please select a batch" in lower:
		return _("Please select a batch for each medicine that requires batch tracking.")

	if "please select a dispensing lot" in lower:
		return _("Please select a dispensing lot for each medicine that requires lot tracking.")

	if "please select a lot number" in lower:
		return _("Please select a lot number for each serialized medicine.")

	if "traceback" in lower:
		for part in reversed(re.split(r"[.\n]", raw)):
			part = part.strip()
			if part and "traceback" not in part.lower() and len(part) > 8:
				return part

	return raw


@frappe.whitelist()
def create_nursing_pharmacy_giveout(
	patient,
	inpatient_record=None,
	medication_orders=None,
	source_prescription=None,
	practitioner=None,
	warehouse=None,
	patient_visit=None,
	services=None,
	no_charges=None,
	charge_percent=None,
):
	"""Nursing pharmacy give-out: create PMO from edited prescription lines, bill via submitted Sales Order.

	IP give-outs pass inpatient_record; OP give-outs pass patient_visit instead.
	``services`` are billed on the Sales Order only (not written onto the PMO) and
	create completed Other Service Requests.

	Medicine billing:
	- ``no_charges`` / ``charge_percent=0``: stock still goes out; drug lines billed at 0
	  (e.g. ECT session where the session is charged separately).
	- ``charge_percent`` 1–100: bill medicines at that percent of list price.
	- Default: 100% (full charge). Services always bill at the entered rate.
	"""
	if not _user_can_access_patient_medication_order_portal():
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	if not patient:
		frappe.throw(_("Patient is required"))
	if not inpatient_record and not patient_visit:
		frappe.throw(_("Inpatient Admission or Patient Visit is required"))
	if inpatient_record and not frappe.db.exists("Inpatient Admission", inpatient_record):
		frappe.throw(_("Inpatient Admission {0} does not exist").format(inpatient_record))
	if not inpatient_record and not frappe.db.exists("Patient Visit", patient_visit):
		frappe.throw(_("Patient Visit {0} does not exist").format(patient_visit))

	if isinstance(medication_orders, str):
		import json

		medication_orders = json.loads(medication_orders)
	if isinstance(services, str):
		import json

		services = json.loads(services)

	if not medication_orders or not isinstance(medication_orders, list):
		frappe.throw(_("At least one medication is required"))

	valid_rows = [row for row in medication_orders if row.get("drug")]
	if not valid_rows:
		frappe.throw(_("At least one medication with a drug is required"))

	resolved_charge_percent = _resolve_pharmacy_giveout_charge_percent(no_charges, charge_percent)

	service_rows = []
	for row in services or []:
		if not isinstance(row, dict):
			continue
		item_code = (row.get("item_code") or row.get("id") or "").strip()
		if item_code:
			service_rows.append(row)

	if service_rows and not (practitioner or "").strip():
		frappe.throw(_("Practitioner is required when adding services to pharmacy give-out"))

	if inpatient_record:
		context_doc = frappe.get_doc("Inpatient Admission", inpatient_record)
		context_label = _("Inpatient Admission {0}").format(inpatient_record)
	else:
		context_doc = frappe.get_doc("Patient Visit", patient_visit)
		context_label = _("Patient Visit {0}").format(patient_visit)
	if context_doc.patient and context_doc.patient != patient:
		frappe.throw(_("Patient does not match the selected care episode"))

	company = context_doc.get("company") or frappe.defaults.get_user_default("Company")
	if not company:
		frappe.throw(_("Company is required on {0}").format(context_label))

	if inpatient_record:
		cost_center = _cost_center_from_inpatient_admission(inpatient_record)
	else:
		cost_center = context_doc.get("cost_center")
	if not cost_center:
		frappe.throw(_("Cost Center is not set on {0}. Please set it on the record.").format(context_label))

	warehouse = _resolve_nursing_pharmacy_giveout_warehouse(cost_center, warehouse)

	try:
		return _create_nursing_pharmacy_giveout_documents(
			patient=patient,
			inpatient_record=inpatient_record,
			valid_rows=valid_rows,
			context_doc=context_doc,
			company=company,
			cost_center=cost_center,
			practitioner=practitioner,
			source_prescription=source_prescription,
			warehouse=warehouse,
			patient_visit=patient_visit,
			services=service_rows,
			charge_percent=resolved_charge_percent,
		)
	except frappe.ValidationError as exc:
		frappe.throw(_format_pharmacy_giveout_error(exc, warehouse=warehouse), exc=exc)
	except Exception as exc:
		frappe.log_error(message=frappe.get_traceback(), title="Nursing pharmacy give-out failed")
		frappe.throw(_format_pharmacy_giveout_error(exc, warehouse=warehouse))


def _create_nursing_pharmacy_giveout_documents(
	patient,
	inpatient_record,
	valid_rows,
	context_doc,
	company,
	cost_center,
	practitioner=None,
	source_prescription=None,
	warehouse=None,
	patient_visit=None,
	services=None,
	charge_percent=100,
):
	from healthcare.api.medicine_given import (
		_item_requires_dispensing_lot,
		_validate_medicine_given_batch_lot,
		allocate_dispensing_lots_for_qty,
		auto_resolve_medicine_given_batch_lot,
	)

	manual_batch_lot_pick = _display_batch_and_lot_on_pharmacy_giveout()
	start_date = nowdate()
	services = services or []
	charge_percent = _pmo_giveout_charge_percent(None, charge_percent)

	doc = frappe.new_doc("Patient Medication Order")
	doc.trans_no = get_next_transaction_number("Patient Medication Order", fieldname="trans_no")
	doc.patient = patient
	doc.company = company
	doc.start_date = start_date
	if inpatient_record:
		doc.care_context = "Inpatient Admission"
		doc.inpatient_record = inpatient_record
	else:
		doc.care_context = "Patient Visit"
		doc.patient_encounter = patient_visit
	doc.patient_name = context_doc.get("patient_name")
	doc.cost_center = cost_center
	if practitioner:
		doc.practitioner = practitioner
	elif context_doc.get("primary_practitioner"):
		doc.practitioner = context_doc.primary_practitioner
	elif context_doc.get("secondary_practitioner"):
		doc.practitioner = context_doc.secondary_practitioner
	elif context_doc.get("practitioner"):
		doc.practitioner = context_doc.practitioner

	doc.nursing_pharmacy_giveout = 1
	doc.is_pharmacy_give_out = 1
	if frappe.get_meta("Patient Medication Order").has_field("giveout_charge_percent"):
		doc.giveout_charge_percent = charge_percent
	if source_prescription and frappe.db.exists("Patient Medication Order", source_prescription):
		doc.source_prescription = source_prescription

	if warehouse:
		from healthcare.api.common import get_item_codes_with_stock

		in_stock = get_item_codes_with_stock(warehouse)
		missing = []
		for row in valid_rows:
			drug = (row.get("drug") or "").strip()
			if drug and drug not in in_stock:
				missing.append(row.get("drug_name") or drug)
		if missing:
			frappe.throw(
				_("No stock at {0} for: {1}. Only medicines with stock in this branch warehouse can be given out.").format(
					warehouse, ", ".join(missing)
				)
			)

	doc.flags.pharmacy_giveout_item_stock = []
	for row in valid_rows:
		row = dict(row)
		if not row.get("date"):
			row["date"] = start_date
		row_time = (row.get("time") or "").strip()
		if not row_time or row_time in ("00:00:00", "00:00"):
			row["time"] = nowtime()
		if not row.get("quantity") and not row.get("qty"):
			row["quantity"] = 1
		drug = (row.get("drug") or "").strip()
		allocations = []
		if drug:
			batch_no = row.get("batch_no")
			lot_no = row.get("lot_no")
			dispensing_lot = row.get("dispensing_lot")
			if not manual_batch_lot_pick:
				batch_no, lot_no, dispensing_lot = auto_resolve_medicine_given_batch_lot(
					drug,
					inpatient_record,
					batch_no,
					lot_no,
					dispensing_lot,
					warehouse=warehouse,
				)
				row["batch_no"] = batch_no
				row["lot_no"] = lot_no
				row["dispensing_lot"] = dispensing_lot

			qty = flt(row.get("quantity") or row.get("qty") or 1)
			if _item_requires_dispensing_lot(drug):
				# Open additional FIFO lots when the first lot cannot cover the full qty.
				allocations = allocate_dispensing_lots_for_qty(
					drug,
					warehouse,
					qty,
					batch_no=batch_no,
					preferred_dispensing_lot=dispensing_lot,
				)
				if allocations:
					row["dispensing_lot"] = allocations[0].get("dispensing_lot")
					row["batch_no"] = allocations[0].get("batch_no") or batch_no
				for alloc in allocations:
					_validate_medicine_given_batch_lot(
						drug,
						inpatient_record,
						alloc.get("batch_no") or batch_no,
						lot_no,
						alloc.get("dispensing_lot"),
						warehouse=warehouse,
					)
			else:
				allocations = [
					{
						"batch_no": (batch_no or "").strip() or None,
						"dispensing_lot": None,
						"qty": qty,
					}
				]
				_validate_medicine_given_batch_lot(
					drug,
					inpatient_record,
					batch_no,
					lot_no,
					dispensing_lot,
					warehouse=warehouse,
				)
		_set_medication_row(doc, row)
		doc.flags.pharmacy_giveout_item_stock.append(
			{
				"batch_no": (row.get("batch_no") or "").strip() or None,
				"dispensing_lot": (row.get("dispensing_lot") or "").strip() or None,
				"allocations": allocations,
			}
		)

	if doc.medication_orders:
		last_dates = [r.date for r in doc.medication_orders if r.date]
		if last_dates:
			doc.end_date = max(last_dates)
		doc.completed_orders = len(doc.medication_orders)

	doc.insert(ignore_permissions=True)
	doc.submit()

	so = _create_submitted_sales_order_for_pmo(
		doc,
		cost_center=cost_center,
		warehouse=warehouse,
		services=services,
		charge_percent=charge_percent,
	)

	service_requests = []
	if services:
		service_requests = _create_completed_service_requests_for_giveout(
			services=services,
			patient=patient,
			inpatient_record=inpatient_record,
			patient_visit=patient_visit,
			cost_center=cost_center,
			practitioner=practitioner or getattr(doc, "practitioner", None),
			company=company,
			sales_order=so.name,
		)

	from healthcare.api.nursing_inventory import _create_delivery_note_for_sales_order

	billing_groups = _pharmacy_giveout_billing_groups_from_pmo(doc)
	dn = _create_delivery_note_for_sales_order(
		so.name,
		patient,
		start_date,
		billing_groups,
		warehouse=warehouse,
	)

	frappe.db.commit()

	return {
		"patient_medication_order": doc.name,
		"sales_order": so.name,
		"sales_order_status": so.status,
		"delivery_note": dn.name,
		"delivery_note_status": dn.status,
		"pmo_status": frappe.db.get_value("Patient Medication Order", doc.name, "status"),
		"source_prescription": source_prescription,
		"service_requests": service_requests,
		"giveout_charge_percent": charge_percent,
		"no_charges": cint(charge_percent <= 0),
	}


def _pharmacy_giveout_service_lines_from_sales_order(pmo_name, sales_order):
	"""Sales Order lines billed as services (not PMO medication drugs)."""
	if not sales_order or not frappe.db.exists("Sales Order", sales_order):
		return []

	pmo_drugs = {
		(d or "").strip()
		for d in frappe.db.sql_list(
			"""
			SELECT drug FROM `tabInpatient Medication Order Entry`
			WHERE parent = %s AND IFNULL(drug, '') != ''
			""",
			pmo_name,
		)
		if (d or "").strip()
	}

	lines = []
	for row in frappe.get_all(
		"Sales Order Item",
		filters={"parent": sales_order},
		fields=["item_code", "item_name", "qty", "rate", "amount", "uom"],
		order_by="idx asc",
	):
		item_code = (row.get("item_code") or "").strip()
		if item_code and item_code not in pmo_drugs:
			lines.append(row)
	return lines


def _pharmacy_giveout_services_summary(service_lines):
	labels = []
	for row in service_lines or []:
		name = (row.get("item_name") or row.get("item_code") or "").strip()
		if not name:
			continue
		qty = flt(row.get("qty")) or 1
		rate = flt(row.get("rate"))
		label = f"{name} x{qty:g}"
		if rate:
			label += f" @ {rate:g}"
		labels.append(label)
	return ", ".join(labels)


@frappe.whitelist()
def get_nursing_pharmacy_giveout_services(name):
	"""Return service lines billed on the linked Sales Order for a pharmacy give-out PMO."""
	if not name:
		frappe.throw(_("Give-out record name is required"))
	if not _user_can_access_patient_medication_order_portal():
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	if not frappe.db.exists("Patient Medication Order", name):
		frappe.throw(_("Patient Medication Order {0} does not exist").format(frappe.bold(name)))

	doc = frappe.get_doc("Patient Medication Order", name)
	pmo_meta = frappe.get_meta("Patient Medication Order")
	if not pmo_meta.has_field("nursing_pharmacy_giveout") or not doc.get("nursing_pharmacy_giveout"):
		frappe.throw(_("This is not a nursing pharmacy give-out record"))

	sales_order = None
	if doc.get("reference_doctype") == "Sales Order" and doc.get("reference_document_name"):
		sales_order = doc.reference_document_name

	lines = _pharmacy_giveout_service_lines_from_sales_order(name, sales_order)
	return {
		"sales_order": sales_order,
		"services": lines,
		"services_summary": _pharmacy_giveout_services_summary(lines),
	}


@frappe.whitelist()
def get_nursing_pharmacy_giveouts(
	limit=50,
	offset=0,
	patient=None,
	inpatient_record=None,
	from_date=None,
	to_date=None,
	search=None,
):
	"""List submitted Patient Medication Orders marked as nursing pharmacy give-out."""
	from healthcare.api.common import get_permitted_cost_centers

	if not _user_can_access_patient_medication_order_portal():
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	pmo_meta = frappe.get_meta("Patient Medication Order")
	if not pmo_meta.has_field("nursing_pharmacy_giveout"):
		return []

	limit = int(limit) if limit else 50
	offset = int(offset) if offset else 0

	fields = [
		"name",
		"patient",
		"patient_name",
		"posting_date",
		"start_date",
		"status",
		"inpatient_record",
		"reference_doctype",
		"reference_document_name",
		"total_orders",
	]
	if pmo_meta.has_field("source_prescription"):
		fields.append("source_prescription")
	if pmo_meta.has_field("giveout_charge_percent"):
		fields.append("giveout_charge_percent")

	conditions = ["docstatus = 1", "nursing_pharmacy_giveout = 1"]
	params = {}

	if patient:
		conditions.append("patient = %(patient)s")
		params["patient"] = patient
	if inpatient_record:
		conditions.append("inpatient_record = %(inpatient_record)s")
		params["inpatient_record"] = inpatient_record
	if from_date:
		conditions.append("posting_date >= %(from_date)s")
		params["from_date"] = from_date
	if to_date:
		conditions.append("posting_date <= %(to_date)s")
		params["to_date"] = to_date
	if search:
		conditions.append(
			"(name LIKE %(search)s OR patient_name LIKE %(search)s OR patient LIKE %(search)s)"
		)
		params["search"] = f"%{search}%"

	permitted_cc = get_permitted_cost_centers()
	if permitted_cc is not None:
		if not permitted_cc:
			return []
		placeholders = ", ".join(f"%(cc_{i})s" for i in range(len(permitted_cc)))
		for i, cc in enumerate(permitted_cc):
			params[f"cc_{i}"] = cc
		admission_placeholders = ", ".join(f"%(adm_cc_{i})s" for i in range(len(permitted_cc)))
		for i, cc in enumerate(permitted_cc):
			params[f"adm_cc_{i}"] = cc
		conditions.append(
			f"""(
				cost_center IN ({placeholders})
				OR (
					IFNULL(cost_center, '') = ''
					AND inpatient_record IN (
						SELECT name FROM `tabInpatient Admission`
						WHERE cost_center IN ({admission_placeholders})
					)
				)
			)"""
		)

	where_sql = " AND ".join(conditions)
	orders = frappe.db.sql(
		f"""
		SELECT {", ".join(fields)}
		FROM `tabPatient Medication Order`
		WHERE {where_sql}
		ORDER BY posting_date DESC, creation DESC
		LIMIT %(limit)s OFFSET %(offset)s
		""",
		{**params, "limit": limit, "offset": offset},
		as_dict=True,
	)

	child_dt = "Inpatient Medication Order Entry"
	for row in orders:
		row["sales_order"] = (
			row.get("reference_document_name")
			if row.get("reference_doctype") == "Sales Order"
			else None
		)
		row["invoice"] = _invoice_for_sales_order(row.get("sales_order"))
		entries = frappe.get_all(
			child_dt,
			filters={"parent": row.name},
			fields=["drug_name", "drug", "quantity"],
			limit=5,
			ignore_permissions=True,
		)
		row["medication_count"] = len(entries)
		labels = []
		for e in entries:
			label = (e.get("drug_name") or e.get("drug") or "").strip()
			qty = flt(e.get("quantity")) or 1
			if label:
				labels.append(f"{label} x{qty:g}")
		if row.get("total_orders") and row["total_orders"] > len(entries):
			labels.append("…")
		row["medications_summary"] = ", ".join(labels) if labels else ""
		service_lines = _pharmacy_giveout_service_lines_from_sales_order(
			row.name, row.get("sales_order")
		)
		row["service_count"] = len(service_lines)
		row["services_summary"] = _pharmacy_giveout_services_summary(service_lines)

	return orders


@frappe.whitelist()
def cancel_nursing_pharmacy_giveout(name):
	"""Cancel a nursing pharmacy give-out and its Sales Order, Delivery Note, and selling docs."""
	if not name:
		frappe.throw(_("Give-out record name is required"))
	if not _user_can_access_patient_medication_order_portal():
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	if not frappe.db.exists("Patient Medication Order", name):
		frappe.throw(_("Patient Medication Order {0} does not exist").format(frappe.bold(name)))

	doc = frappe.get_doc("Patient Medication Order", name)
	_ensure_pmo_write_permission(doc)

	pmo_meta = frappe.get_meta("Patient Medication Order")
	if not pmo_meta.has_field("nursing_pharmacy_giveout") or not doc.get("nursing_pharmacy_giveout"):
		frappe.throw(_("This is not a nursing pharmacy give-out record"))

	if doc.docstatus != 1:
		frappe.throw(_("Only submitted give-out records can be cancelled"))

	from healthcare.api.common import get_permitted_cost_centers

	permitted_cc = get_permitted_cost_centers()
	if permitted_cc is not None:
		if not permitted_cc:
			frappe.throw(_("Not permitted"), frappe.PermissionError)
		cc = doc.get("cost_center")
		if not cc and doc.get("inpatient_record"):
			cc = _cost_center_from_inpatient_admission(doc.inpatient_record)
		if cc and cc not in permitted_cc:
			frappe.throw(_("Not permitted for this cost center"), frappe.PermissionError)

	sales_orders = _sales_orders_for_pharmacy_giveout(doc.name, doc)
	cancelled_sales_orders = []
	cancelled_delivery_notes = []
	cancelled_selling_notes = []
	cancelled_invoices = []
	cancelled_service_requests = []

	for sales_order in sales_orders:
		selling = _cancel_selling_documents_for_sales_order(sales_order, doc.name)
		cancelled_selling_notes.extend(selling.get("selling_notes") or [])
		cancelled_invoices.extend(selling.get("sales_invoices") or [])
		cancelled_delivery_notes.extend(_cancel_delivery_notes_for_sales_order(sales_order))
		cancelled_service_requests.extend(_cancel_service_requests_for_sales_order(sales_order))

		# Unlink PMO from SO so ERPNext can cancel the order.
		if (
			doc.get("reference_doctype") == "Sales Order"
			and doc.get("reference_document_name") == sales_order
		):
			frappe.db.set_value(
				"Patient Medication Order",
				doc.name,
				{"reference_doctype": None, "reference_document_name": None},
				update_modified=False,
			)
			doc.reference_doctype = None
			doc.reference_document_name = None

		handled = _cancel_submitted_or_delete_draft("Sales Order", sales_order)
		if handled:
			cancelled_sales_orders.append(handled)

	if doc.docstatus == 1:
		doc.reload()
		doc.flags.ignore_permissions = True
		doc.cancel()

	frappe.db.commit()
	return {
		"cancelled": name,
		"sales_order": cancelled_sales_orders[0] if cancelled_sales_orders else None,
		"sales_orders": cancelled_sales_orders,
		"delivery_notes": cancelled_delivery_notes,
		"selling_notes": cancelled_selling_notes,
		"sales_invoices": cancelled_invoices,
		"service_requests": cancelled_service_requests,
	}


@frappe.whitelist()
def delete_nursing_pharmacy_giveout(name):
	"""Deprecated alias — cancels the give-out record."""
	return cancel_nursing_pharmacy_giveout(name)