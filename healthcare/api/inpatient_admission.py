# -*- coding: utf-8 -*-
# Copyright (c) 2025, Healthcare and contributors
# For license information, please see license.txt


import frappe
import re
from frappe import _
from datetime import timedelta

from frappe.utils import cint, cstr, flt, format_timedelta, get_datetime, getdate, today
from healthcare.api.patient_visit import create_invoice
from healthcare.api.utils.api_utility import get_next_inpatient_case_number
from healthcare.controllers.discount_validation import apply_insurance_discounts
from healthcare.healthcare.doctype.observation.observation import vacate_active_observation_rooms_for_patient
from healthcare.healthcare.editing_lock import assert_editing_allowed

try:
	from erpnext import get_default_currency
except ImportError:
	# Fallback if erpnext is not available
	def get_default_currency():
		return frappe.db.get_single_value('Global Defaults', 'default_currency') or 'BHD'


@frappe.whitelist()
def get_next_case_number():
	"""Get the next case number for a new Inpatient Admission."""
	return get_next_inpatient_case_number()


@frappe.whitelist()
def get_patient_active_admission(patient):
	"""Get patient's most recent active admission (Admitted or Discharge Scheduled status)."""
	if not patient:
		frappe.throw(_("Patient is required"))

	records = frappe.get_all(
		"Inpatient Admission",
		filters={
			"patient": patient,
			"status": ["in", ["Admitted", "Discharge Scheduled"]],
		},
		fields=["name", "patient", "patient_name", "status", "cost_center", "company"],
		order_by="scheduled_date desc",
		limit=1,
	)

	if not records:
		return None

	rec = records[0]
	return {
		"name": rec.name,
		"patient": rec.patient,
		"patient_name": rec.patient_name,
		"status": rec.status,
		"cost_center": rec.get("cost_center"),
		"company": rec.get("company"),
	}


@frappe.whitelist()
def get_patient_blocking_admission(patient):
	"""Return an open admission that should block scheduling a new one.

	Includes Admitted, Admission Scheduled, and Discharge Scheduled.
	"""
	if not patient:
		frappe.throw(_("Patient is required"))

	records = frappe.get_all(
		"Inpatient Admission",
		filters={
			"patient": patient,
			"status": ["in", ["Admitted", "Admission Scheduled", "Discharge Scheduled"]],
		},
		fields=["name", "patient", "patient_name", "status", "case_no", "scheduled_date"],
		order_by="modified desc",
		limit=1,
	)
	if not records:
		return None

	rec = records[0]
	return {
		"name": rec.name,
		"patient": rec.patient,
		"patient_name": rec.patient_name,
		"status": rec.status,
		"case_no": rec.get("case_no"),
		"scheduled_date": rec.get("scheduled_date"),
	}


@frappe.whitelist()
def get_inpatient_records(
	status=None,
	search=None,
	patient=None,
	practitioner=None,
	from_date=None,
	to_date=None,
	exclude_cancelled=None,
	cost_center=None,
	discharge_in_progress=None,
	include_patient_discharged=None,
	limit=20,
	offset=0,
):
	"""Get list of Inpatient Admissions with optional status, search, patient, practitioner and date filters.

	Always enforces Cost Center User Permissions so that users restricted to a
	specific cost center cannot see admissions belonging to other cost centers.

	discharge_in_progress (optional, UI grouping only — does not change stored status):
	  1 → only admissions with a draft Discharge
	  0 → exclude admissions that have a draft Discharge
	include_patient_discharged: when a patient is in scope, also return that patient's
	Discharged admissions even if status/date/doctor filters would hide them.
	Returns { data: [...], total_count: N }
	"""
	from healthcare.api.common import get_permitted_cost_centers
	permitted_cc = get_permitted_cost_centers()
	limit = cint(limit) or 20
	offset = cint(offset) or 0
	exclude_cancelled = cint(exclude_cancelled)
	# None = no filter; "0"/"1" (or 0/1) = exclude / only draft-discharge admissions
	dip_filter = None if discharge_in_progress in (None, "") else cint(discharge_in_progress)
	include_patient_discharged = cint(include_patient_discharged) and bool(patient)
	if include_patient_discharged and (status or "").strip() in ("Discharged", "Cancelled"):
		include_patient_discharged = 0

	# Use SQL path when we have search, practitioner, date, status, or exclude_cancelled filters
	use_sql = bool(
		search
		or practitioner
		or from_date
		or to_date
		or status
		or exclude_cancelled
		or cost_center
		or dip_filter is not None
		or include_patient_discharged
	)

	if use_sql:
		conditions = ["1=1"]
		history_conditions = ["ia.status = 'Discharged'"]
		params = {}
		if patient:
			conditions.append("ia.patient = %(patient)s")
			history_conditions.append("ia.patient = %(patient)s")
			params['patient'] = patient
		if status:
			conditions.append("ia.status = %(status)s")
			params['status'] = status
		elif exclude_cancelled:
			conditions.append("ia.status != 'Cancelled'")
		if search:
			conditions.append("(ia.name LIKE %(search)s OR ia.patient_name LIKE %(search)s OR ia.patient LIKE %(search)s OR p.file_no LIKE %(search)s)")
			history_conditions.append("(ia.name LIKE %(search)s OR ia.patient_name LIKE %(search)s OR ia.patient LIKE %(search)s OR p.file_no LIKE %(search)s)")
			params['search'] = f'%{search}%'
		if practitioner:
			# The list's doctor filter targets the Admission By Doctor field (matches the table column).
			conditions.append("ia.admission_by_doctor = %(practitioner)s")
			params['practitioner'] = practitioner
		if from_date:
			conditions.append("ia.scheduled_date >= %(from_date)s")
			params['from_date'] = from_date
		if to_date:
			conditions.append("ia.scheduled_date <= %(to_date)s")
			params['to_date'] = to_date
		if cost_center:
			conditions.append("ia.cost_center = %(cost_center_filter)s")
			history_conditions.append("ia.cost_center = %(cost_center_filter)s")
			params['cost_center_filter'] = cost_center
		if dip_filter == 1:
			conditions.append(
				"EXISTS (SELECT 1 FROM `tabDischarge` d WHERE d.admission = ia.name AND d.docstatus = 0)"
			)
		elif dip_filter == 0:
			conditions.append(
				"NOT EXISTS (SELECT 1 FROM `tabDischarge` d WHERE d.admission = ia.name AND d.docstatus = 0)"
			)

		# ── Cost-centre User Permission enforcement ──────────────────────────
		if permitted_cc is not None:
			if not permitted_cc:
				return {"data": [], "total_count": 0}
			placeholders = ", ".join(f"%(cc_{i})s" for i in range(len(permitted_cc)))
			cc_sql = f"ia.cost_center IN ({placeholders})"
			conditions.append(cc_sql)
			history_conditions.append(cc_sql)
			for i, cc in enumerate(permitted_cc):
				params[f"cc_{i}"] = cc

		where_sql = " AND ".join(conditions)
		if include_patient_discharged:
			where_sql = f"({where_sql}) OR ({' AND '.join(history_conditions)})"

		count_result = frappe.db.sql("""
			SELECT COUNT(*) as cnt
			FROM `tabInpatient Admission` ia
			LEFT JOIN `tabPatient` p ON ia.patient = p.name
			WHERE """ + where_sql,
			params,
			as_dict=True
		)
		total_count = count_result[0].cnt if count_result else 0

		params['limit'] = limit
		params['offset'] = offset
		records = frappe.db.sql("""
			SELECT 
				ia.name,
				ia.patient,
				ia.patient_name,
				p.file_no,
				ia.status,
				ia.scheduled_date,
				ia.admitted_datetime,
				ia.admission_date,
				ia.admission_time,
				ia.discharge_datetime,
				ia.expected_discharge,
				ia.admission_service_unit_type,
				ia.medical_department,
				ia.primary_practitioner,
				ia.secondary_practitioner,
				ia.admission_encounter,
				ia.expected_length_of_stay,
				ia.case_no,
				ia.admission_by_doctor,
				ia.admission_doctor_name,
				ia.resident_doctor_name,
				ia.psychologist_doctor_name,
				ia.room_service_no,
				ia.bed_no,
				p.file_no AS file_no,
				ia.cost_center
			FROM `tabInpatient Admission` ia
			LEFT JOIN `tabPatient` p ON ia.patient = p.name
			WHERE """ + where_sql + """
			ORDER BY ia.scheduled_date DESC
			LIMIT %(limit)s OFFSET %(offset)s""",
			params,
			as_dict=True
		)
	else:
		filters = {}
		if status:
			filters['status'] = status
		elif exclude_cancelled:
			filters['status'] = ['!=', 'Cancelled']
		if patient:
			filters['patient'] = patient

		# ── Cost-centre User Permission enforcement ──────────────────────────
		if permitted_cc is not None:
			if not permitted_cc:
				return {"data": [], "total_count": 0}
			filters['cost_center'] = ['in', permitted_cc]

		total_count = len(frappe.get_all(
			'Inpatient Admission',
			filters=filters,
			fields=['name'],
			limit=0,
		))

		records = frappe.get_all(
			'Inpatient Admission',
			filters=filters,
			fields=[
				'name',
				'patient',
				'patient_name',
				'status',
				'scheduled_date',
				'admitted_datetime',
				'admission_date',
				'admission_time',
				'discharge_datetime',
				'expected_discharge',
				'admission_service_unit_type',
				'medical_department',
				'primary_practitioner',
				'secondary_practitioner',
				'admission_encounter',
				'expected_length_of_stay',
				'case_no',
				'admission_by_doctor',
				'admission_doctor_name',
				'resident_doctor_name',
				'psychologist_doctor_name',
				'room_service_no',
				'bed_no',
				'cost_center',
			],
			order_by='scheduled_date desc',
			limit=limit,
			start=offset,
		)
		# get_all path has no Patient join — attach File No. per patient
		_patient_ids = list({r.patient for r in records if r.get("patient")})
		if _patient_ids:
			_file_map = {
				row.name: row.file_no
				for row in frappe.get_all("Patient", filters={"name": ["in", _patient_ids]}, fields=["name", "file_no"])
			}
			for r in records:
				r["file_no"] = _file_map.get(r.get("patient"))

	from healthcare.api.common import fill_missing_patient_names
	fill_missing_patient_names(records)
	_annotate_discharge_in_progress(records)
	return {"data": records, "total_count": total_count}


def _annotate_discharge_in_progress(records) -> None:
	"""Flag admissions that have a draft Discharge (started but not submitted).

	Also attaches ``draft_discharge_date`` from the draft Discharge doctype so the
	UI can show admission → planned discharge while status is still Admitted.
	"""
	if not records:
		return
	names = [r.get("name") for r in records if r.get("name")]
	for r in records:
		r["discharge_in_progress"] = 0
		r["draft_discharge_date"] = None
	if not names:
		return

	drafts = frappe.get_all(
		"Discharge",
		filters={"admission": ["in", names], "docstatus": 0},
		fields=["admission", "discharge_date", "modified"],
		order_by="modified desc",
	)
	draft_dates = {}
	for row in drafts:
		adm = row.get("admission")
		if not adm or adm in draft_dates:
			continue
		draft_dates[adm] = row.get("discharge_date")

	for r in records:
		if r.get("name") in draft_dates:
			r["discharge_in_progress"] = 1
			r["draft_discharge_date"] = draft_dates[r["name"]]


def _enrich_inpatient_records_with_file_no(records):
	"""Attach Patient.file_no for admission list display."""
	if not records:
		return records
	patient_ids = list({r.get("patient") for r in records if r.get("patient")})
	if not patient_ids:
		for row in records:
			row["file_no"] = None
		return records
	file_map = {
		row.name: row.file_no
		for row in frappe.get_all(
			"Patient",
			filters={"name": ["in", patient_ids]},
			fields=["name", "file_no"],
		)
	}
	for row in records:
		row["file_no"] = file_map.get(row.get("patient"))
	return records


@frappe.whitelist()
def get_internal_transfers(limit=50, offset=0, patient=None, admission=None, search=None):
	"""Get Transfer Admission Event rows for internal transfer listing."""
	from healthcare.api.common import get_permitted_cost_centers
	permitted_cc = get_permitted_cost_centers()

	conditions = ["1=1"]
	params = {
		"limit": cint(limit or 50),
		"offset": cint(offset or 0),
	}

	if patient:
		conditions.append("tae.patient = %(patient)s")
		params["patient"] = patient

	if admission:
		conditions.append("tae.inpatient_admission = %(admission)s")
		params["admission"] = admission

	if search:
		conditions.append(
			"(tae.name LIKE %(search)s OR tae.patient_name LIKE %(search)s OR tae.inpatient_admission LIKE %(search)s)"
		)
		params["search"] = f"%{search}%"

	if permitted_cc is not None:
		if not permitted_cc:
			return []
		placeholders = ", ".join(f"%(cc_{i})s" for i in range(len(permitted_cc)))
		conditions.append(f"(tae.from_cost_center IN ({placeholders}) OR tae.to_cost_center IN ({placeholders}))")
		for i, cc in enumerate(permitted_cc):
			params[f"cc_{i}"] = cc

	where_sql = " AND ".join(conditions)

	rows = frappe.db.sql(
		"""
		SELECT
			tae.name,
			tae.inpatient_admission,
			tae.patient,
			tae.patient_name,
			tae.transfer_datetime,
			tae.from_cost_center,
			tae.to_cost_center,
			tae.from_service_unit,
			tae.to_service_unit,
			tae.transferred_by,
			tae.reason,
			tae.company
		FROM `tabTransfer Admission Event` tae
		WHERE """
		+ where_sql
		+ """
		ORDER BY tae.transfer_datetime DESC, tae.modified DESC
		LIMIT %(limit)s OFFSET %(offset)s
		""",
		params,
		as_dict=True,
	)

	return rows


@frappe.whitelist()
def get_inpatient_record(name):
	"""Get single Inpatient Admission by name"""
	if not name:
		frappe.throw(_("Inpatient Admission name is required"))

	record = frappe.get_doc('Inpatient Admission', name)
	
	# Get current occupancy (bed) information
	current_occupancy = None
	if record.inpatient_occupancies:
		for occupancy in record.inpatient_occupancies:
			if not occupancy.left:  # Current active occupancy
				service_unit_name = None
				if occupancy.service_unit:
					service_unit_name = frappe.db.get_value('Healthcare Service Unit', occupancy.service_unit, 'healthcare_service_unit_name')
				
				current_occupancy = {
					'service_unit': occupancy.service_unit,
					'service_unit_name': service_unit_name,
					'check_in': occupancy.check_in,
					'check_out': occupancy.check_out,
					'invoiced': occupancy.invoiced
				}
				break

	service_unit_selections = [
		{"service_unit": row.service_unit}
		for row in (getattr(record, "service_unit", None) or [])
		if getattr(row, "service_unit", None)
	]

	inpatient_occupancies_out = []
	for occ in record.inpatient_occupancies or []:
		su_label = None
		if occ.service_unit:
			su_label = frappe.db.get_value(
				"Healthcare Service Unit", occ.service_unit, "healthcare_service_unit_name"
			)
		inpatient_occupancies_out.append({
			"name": occ.name,
			"service_unit": occ.service_unit,
			"service_unit_name": su_label,
			"check_in": occ.check_in,
			"check_out": occ.check_out,
			"left": occ.left,
			"invoiced": occ.invoiced,
		})
	
	# Get charges information
	charges_info = {
		'admission_cost': record.admission_cost,
		'case_management_fee': record.case_management_fee,
		'room_charges': record.room_charges
	}
	
	# Patient relatives (guardian/relative details)
	relatives = []
	for row in getattr(record, "patient_relatives", []) or []:
		relatives.append({
			"relative_relation": getattr(row, "relationship_with_patient", None) or getattr(row, "relative_relation", None),
			"relationship_with_patient": getattr(row, "relationship_with_patient", None) or getattr(row, "relative_relation", None),
			"relative_name": getattr(row, "relative_name", None),
			"relative_id_num": getattr(row, "cpr__id_no", None) or getattr(row, "relative_id_num", None),
			"cpr__id_no": getattr(row, "cpr__id_no", None) or getattr(row, "relative_id_num", None),
			"relative_phone_no": getattr(row, "relative_phone_no", None),
			"relative_alternative_phone_no": getattr(row, "relative_alternative_phone_no", None),
			"relative_alternative_phone_no_2": getattr(row, "relative_alternative_phone_no_2", None),
			"relation_email": getattr(row, "relation_email", None),
			"any_remarks": getattr(row, "any_remarks", None),
		})

	visitors = []
	for row in getattr(record, "patient_visitors", []) or []:
		visitors.append({
			"name": row.name,
			"visitors_name": row.visitors_name,
			"relationship_with_patient": row.relationship_with_patient,
			"cpr__id_no": row.cpr__id_no,
			"any_remarks": row.any_remarks,
			"entered_by": row.entered_by,
			"entered_date": row.entered_date,
		})

	e_signatures = []
	for row in getattr(record, "e_signatures", []) or []:
		e_signatures.append({
			"file_name": getattr(row, "file_name", None),
			"document_type": getattr(row, "document_type", None),
			"transaction_no": getattr(row, "transaction_no", None),
			"upload_remarks": getattr(row, "upload_remarks", None),
			"document": getattr(row, "document", None),
			"patient_relation": getattr(row, "patient_relation", None),
			"signee_name": getattr(row, "signee_name", None),
		})

	return {
		'name': record.name,
		'patient': record.patient,
		'patient_name': record.patient_name,
		'status': record.status,
		'scheduled_date': record.scheduled_date,
		'admitted_datetime': record.admitted_datetime,
		'admission_date': getattr(record, "admission_date", None),
		'admission_time': getattr(record, "admission_time", None),
		'expected_discharge': record.expected_discharge,
		'admission_service_unit_type': record.admission_service_unit_type,
		'medical_department': record.medical_department,
		'primary_practitioner': record.primary_practitioner,
		'secondary_practitioner': record.secondary_practitioner,
		'admission_encounter': record.admission_encounter,
		'expected_length_of_stay': record.expected_length_of_stay,
		'patient_ip_category': getattr(record, "patient_ip_category", None),
		'bed_no': getattr(record, "bed_no", None),
		'service_unit_selections': service_unit_selections,
		'inpatient_occupancies': inpatient_occupancies_out,
		'current_occupancy': current_occupancy,
		'charges': charges_info,
		'patient_relatives': relatives,
		'patient_visitors': visitors,
		'e_signatures': e_signatures,
		'patient_documents': e_signatures,
		'signature': getattr(record, "signature", None),
		'gender': getattr(record, "gender", None),
		'blood_group': getattr(record, "blood_group", None),
		'dob': getattr(record, "dob", None),
		'mobile': getattr(record, "mobile", None),
		'email': getattr(record, "email", None),
		'phone': getattr(record, "phone", None),
		'company': getattr(record, "company", None),
		'cost_center': getattr(record, "cost_center", None),
		'admission_ordered_for': getattr(record, "admission_ordered_for", None),
		'admission_by_cpr': getattr(record, "admission_by_cpr", None),
		'reference_by': getattr(record, "reference_by", None),
		'admission_practitioner': getattr(record, "admission_practitioner", None),
		'admission_instruction': getattr(record, "admission_instruction", None),
		'admission_doctor_name': getattr(record, "admission_doctor_name", None),
		'admission_by_doctor': getattr(record, "admission_by_doctor", None),
		'admission_by_nm': getattr(record, "admission_by_nm", None),
		'psychologist_doctor_name': getattr(record, "psychologist_doctor_name", None),
		'psychologist_doctor': getattr(record, "psychologist_doctor", None),
		'resident_doctor_name': getattr(record, "resident_doctor_name", None),
		'residents_doctor_no': getattr(record, "residents_doctor_no", None),
		'escort': getattr(record, "escort", None),
		'guardian_name': getattr(record, "guardian_name", None),
		'contact_relationship': getattr(record, "contact_relationship", None),
		'contact_mobile': getattr(record, "contact_mobile", None),
		'contact_phone': getattr(record, "contact_phone", None),
		'contact_email': getattr(record, "contact_email", None),
		'admission_cost': getattr(record, "admission_cost", None),
		'case_management_fee': getattr(record, "case_management_fee", None),
		'room_charges': getattr(record, "room_charges", None),
		'weight': getattr(record, "weight", None),
		'height': getattr(record, "height", None),
		'blood_pressure': getattr(record, "blood_pressure", None),
		'pulse': getattr(record, "pulse", None),
		'temp': getattr(record, "temp", None),
		'resp_rate': getattr(record, "resp_rate", None),
		'general_condition': getattr(record, "general_condition", None),
		'cns': getattr(record, "cns", None),
		'cvs_resp': getattr(record, "cvs_resp", None),
		'git': getattr(record, "git", None),
		'others': getattr(record, "others", None),
		'allergies': getattr(record, "allergies", None),
		'medication_history': getattr(record, "medication_history", None),
		'medical_history': getattr(record, "medical_history", None),
		'surgical_history': getattr(record, "surgical_history", None),
		'discharge_ordered_date': getattr(record, "discharge_ordered_date", None),
		'discharge_datetime': getattr(record, "discharge_datetime", None),
		'discharge_instructions': getattr(record, "discharge_instructions", None),
		'discharge_note': getattr(record, "discharge_note", None),
		'followup_date': getattr(record, "followup_date", None),
		'discharge_practitioner': getattr(record, "discharge_practitioner", None),
		'admission_nursing_checklist_template': getattr(record, "admission_nursing_checklist_template", None),
		'discharge_nursing_checklist_template': getattr(record, "discharge_nursing_checklist_template", None),
		**_draft_discharge_fields(record.name),
	}


def _draft_discharge_fields(admission_name: str) -> dict:
	"""UI helpers for an in-progress (draft) Discharge on this admission."""
	draft = frappe.db.get_value(
		"Discharge",
		{"admission": admission_name, "docstatus": 0},
		["name", "discharge_date"],
		as_dict=True,
	)
	if not draft:
		return {"discharge_in_progress": 0, "draft_discharge_date": None}
	return {
		"discharge_in_progress": 1,
		"draft_discharge_date": draft.get("discharge_date"),
	}


@frappe.whitelist()
def get_package_details(admission_no):
	"""Get Package Details for an Inpatient Admission"""
	if not admission_no:
		frappe.throw(_("Admission No is required"))

	# Get company from Inpatient Admission
	inpatient_record = frappe.get_doc('Inpatient Admission', admission_no)
	company = inpatient_record.company if hasattr(inpatient_record, 'company') and inpatient_record.company else frappe.defaults.get_user_default("Company")
	
	# Get company default currency
	default_currency = frappe.db.get_value('Company', company, 'default_currency') if company else None
	if not default_currency:
		from erpnext import get_default_currency
		default_currency = get_default_currency() or 'SAR'

	packages = frappe.get_all(
		'Package Detail',
		filters={'admission_no': admission_no},
		fields=[
			'name',
			'admission_no',
			'from_date',
			'to_date',
			'total_days',
			'transaction_amount',
			'currency',
			'vch_status',
			'remarks'
		]
	)

	# Return packages with default currency info
	return {
		'packages': packages,
		'default_currency': default_currency
	}


@frappe.whitelist()
def get_package_detail_dashboard(patient=None):
	"""Return data for Package Detail view: available Inpatient Packages, active admission, assigned package (from Quotation)."""
	# 1) Available Inpatient Packages (master list)
	available = frappe.get_all(
		'Inpatient Package',
		filters={'active': 1},
		fields=['name', 'package_name', 'package_category', 'no_of_days', 'package_rate', 'cost_center'],
		order_by='package_name',
	)
	for p in available:
		if p.get('package_category'):
			p['category_name'] = frappe.db.get_value('Room Category', p.package_category, 'room_category_name') or p.package_category

	company = frappe.defaults.get_user_default('Company')
	default_currency = frappe.db.get_value('Company', company, 'default_currency') if company else None
	if not default_currency:
		try:
			from erpnext import get_default_currency
			default_currency = get_default_currency() or 'BHD'
		except ImportError:
			default_currency = 'BHD'

	result = {
		'available_packages': available,
		'packages_available_count': len(available),
		'default_currency': default_currency,
		'active_admission': None,
		'assigned_package': None,
		'package_detail_records': [],
	}

	if not patient:
		return result

	# 2) Active admission for patient
	admission = frappe.db.get_value(
		'Inpatient Admission',
		{'patient': patient, 'status': ['in', ['Admitted', 'Discharge Scheduled']]},
		['name', 'patient', 'patient_name', 'status', 'scheduled_date', 'admitted_datetime', 'expected_discharge'],
		order_by='scheduled_date desc',
		as_dict=True,
	)
	if not admission:
		return result

	result['active_admission'] = {
		'name': admission.name,
		'patient': admission.patient,
		'patient_name': admission.patient_name,
		'status': admission.status,
		'scheduled_date': str(admission.scheduled_date) if admission.scheduled_date else None,
		'admitted_datetime': str(admission.admitted_datetime) if admission.admitted_datetime else None,
		'expected_discharge': str(admission.expected_discharge) if admission.expected_discharge else None,
	}

	# 3) Assigned package from Quotation (custom_package, custom_inpatient_admission)
	quotation = frappe.db.get_value(
		'Quotation',
		{'custom_inpatient_admission': admission.name, 'docstatus': ['<', 2]},
		['name', 'custom_package'],
		order_by='modified desc',
		as_dict=True,
	)
	if quotation and quotation.get('custom_package'):
		pkg = frappe.db.get_value(
			'Inpatient Package',
			quotation.custom_package,
			['name', 'package_name', 'no_of_days', 'package_rate'],
			as_dict=True,
		)
		result['assigned_package'] = {
			'quotation_name': quotation.name,
			'inpatient_package': quotation.custom_package,
			'package_name': pkg.package_name if pkg else quotation.custom_package,
			'no_of_days': pkg.no_of_days if pkg else None,
			'package_rate': pkg.package_rate if pkg else None,
			'admission_no': admission.name,
		}

	# 4) Package Detail records for this admission (standalone doctype Package Detail)
	pd_records = frappe.get_all(
		'Package Detail',
		filters={'admission_no': admission.name},
		fields=['name', 'admission_no', 'from_date', 'to_date', 'total_days', 'transaction_amount', 'currency', 'vch_status', 'remarks'],
		order_by='from_date desc',
	)
	result['package_detail_records'] = pd_records

	return result


@frappe.whitelist()
def get_service_units(service_unit_type=None, occupancy_status=None, search=None, room_category=None, cost_center=None):
	"""Get Healthcare Service Units with optional filters and search.

	Used by the React Admit Patient modal to pick a room/bed.
	We always restrict this to inpatient units that are currently vacant.

	Room type matching is fuzzy so "Private Room" matches rooms typed as "Private Rooms".
	"""
	import re
	from frappe.utils import flt

	def _normalize_room_type_key(name: str) -> str:
		s = re.sub(r"\s+", " ", (name or "").strip().lower())
		parts = s.split(" ")
		if parts:
			w = parts[-1]
			if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
				parts[-1] = w[:-1]
		return " ".join(parts)

	def _matching_type_names(selected: str) -> list[str]:
		"""Exact name plus any HSUT whose normalized name matches (Room ≈ Rooms)."""
		selected = (selected or "").strip()
		if not selected:
			return []
		target = _normalize_room_type_key(selected)
		matched = {selected}
		for row in frappe.get_all(
			"Healthcare Service Unit Type",
			fields=["name", "service_unit_type"],
			limit=500,
		):
			for candidate in (row.name, row.service_unit_type):
				if candidate and _normalize_room_type_key(candidate) == target:
					matched.add(row.name)
					if row.service_unit_type:
						matched.add(row.service_unit_type)
		# Also include any type name already used on units that normalizes the same
		for used in frappe.db.sql(
			"""
			SELECT DISTINCT service_unit_type
			FROM `tabHealthcare Service Unit`
			WHERE IFNULL(service_unit_type, '') != ''
			LIMIT 500
			""",
			as_dict=True,
		):
			if _normalize_room_type_key(used.service_unit_type) == target:
				matched.add(used.service_unit_type)
		return list(matched)

	filters = {"inpatient_occupancy": 1}
	# Do not filter service_unit_type in SQL with exact equality — fuzzy-match below
	if occupancy_status:
		filters["occupancy_status"] = occupancy_status
	if room_category:
		filters["room_category"] = room_category
	# Rooms with no cost center are available for any branch/cost center.
	# Exact cost_center match is applied in SQL below when needed.

	type_names = _matching_type_names(service_unit_type) if service_unit_type else []

	def _cost_center_clause(alias: str = "") -> str:
		col = f"{alias}.cost_center" if alias else "cost_center"
		return f"(IFNULL({col}, '') = '' OR {col} = %(cost_center)s)"

	if search or cost_center:
		query = """
			SELECT
				name,
				healthcare_service_unit_name,
				service_unit_type,
				occupancy_status,
				company,
				room_category,
				cost_center
			FROM `tabHealthcare Service Unit`
			WHERE
				inpatient_occupancy = 1
		"""
		params: dict = {}
		if search:
			query += """
				AND (healthcare_service_unit_name LIKE %(search)s
				OR name LIKE %(search)s)
			"""
			params["search"] = f"%{search}%"

		if occupancy_status:
			query += " AND occupancy_status = %(occupancy_status)s"
			params["occupancy_status"] = occupancy_status
		if room_category:
			query += " AND room_category = %(room_category)s"
			params["room_category"] = room_category
		if cost_center:
			query += f" AND {_cost_center_clause()}"
			params["cost_center"] = cost_center
		if type_names:
			query += " AND service_unit_type IN %(type_names)s"
			params["type_names"] = tuple(type_names)

		units = frappe.db.sql(query, params, as_dict=True)[:50]
	else:
		fields = [
			"name",
			"healthcare_service_unit_name",
			"service_unit_type",
			"occupancy_status",
			"company",
			"room_category",
			"cost_center",
		]
		if type_names:
			filters["service_unit_type"] = ["in", type_names]
		units = frappe.get_all(
			"Healthcare Service Unit",
			filters=filters,
			fields=fields,
			limit=50,
		)

	# Attach room multiplier — resolve via normalized type key so Private Rooms
	# picks up multiplier defined on Private Room (and vice versa).
	multiplier_by_norm = {}
	if frappe.db.has_column("Healthcare Service Unit Type", "room_multiplier"):
		for row in frappe.get_all(
			"Healthcare Service Unit Type",
			fields=["name", "service_unit_type", "room_multiplier"],
			limit=500,
		):
			mult = flt(row.room_multiplier) if row.room_multiplier is not None else None
			if mult is None:
				continue
			for candidate in (row.name, row.service_unit_type):
				if candidate:
					multiplier_by_norm[_normalize_room_type_key(candidate)] = mult

	for u in units:
		key = _normalize_room_type_key(u.get("service_unit_type") or "")
		u["room_multiplier"] = multiplier_by_norm.get(key, 1.0)

	return units


@frappe.whitelist()
def get_service_unit_charge_item(service_unit: str) -> dict:
	"""Return the billing item configured on a Healthcare Service Unit's type."""
	service_unit = (service_unit or "").strip()
	if not service_unit:
		return {}

	item_code = _item_code_from_healthcare_service_unit(service_unit)
	if not item_code:
		return {}

	service_unit_type = frappe.db.get_value(
		"Healthcare Service Unit", service_unit, "service_unit_type"
	)
	rate = flt(
		frappe.db.get_value("Healthcare Service Unit Type", service_unit_type, "rate")
	) if service_unit_type else 0

	return {
		"item_code": item_code,
		"service_unit_type": service_unit_type,
		"rate": rate,
	}


def _resolve_quotation_service_unit(admission_name, explicit_service_unit=None):
	"""Pick a Healthcare Service Unit for quotation line item: explicit, then admission multiselect, then bed."""
	if explicit_service_unit:
		return explicit_service_unit
	if not admission_name:
		return None
	bed = frappe.db.get_value("Inpatient Admission", admission_name, "bed_no")
	if bed:
		su = frappe.db.get_value("Bed No", bed, "service_unit")
		if su:
			return su
	rows = frappe.get_all(
		"Service Unit Multiselect",
		filters={"parent": admission_name, "parenttype": "Inpatient Admission"},
		pluck="service_unit",
		limit=1,
	)
	return rows[0] if rows else None


@frappe.whitelist()
def get_bed_numbers(
	occupancy_status=None,
	search=None,
	cost_center=None,
	service_units=None,
):
	"""Vacant Bed No records for admission UI (each links to a Healthcare Service Unit / room).

	If ``service_units`` is provided (list or JSON array string), only beds in those rooms are returned.
	Pass an empty list to get no beds.
	"""
	allowed_su = None

	if service_units is not None:
		if isinstance(service_units, str):
			service_units = frappe.parse_json(service_units)
		if not isinstance(service_units, (list, tuple)):
			service_units = []
		allowed_su = [str(s).strip() for s in service_units if s]
		if not allowed_su:
			return []

	if cost_center:
		# Include rooms for this cost center plus rooms with no cost center set.
		su_with_cc = [
			row[0]
			for row in frappe.db.sql(
				"""
				SELECT name
				FROM `tabHealthcare Service Unit`
				WHERE IFNULL(cost_center, '') = '' OR cost_center = %s
				""",
				(cost_center,),
			)
		]
		if not su_with_cc:
			return []
		if allowed_su is not None:
			allowed_su = list(set(allowed_su) & set(su_with_cc))
			if not allowed_su:
				return []
		else:
			allowed_su = su_with_cc

	occ = occupancy_status or "Vacant"
	out_fields = ["name", "bed_no", "service_unit", "occupancy_status"]

	if search:
		txt = f"%{search}%"
		conditions = ["occupancy_status = %(occ)s", "(bed_no LIKE %(txt)s OR name LIKE %(txt)s)"]
		params = {"occ": occ, "txt": txt}
		if allowed_su is not None:
			placeholders = ", ".join(f"%(su{i})s" for i in range(len(allowed_su)))
			conditions.append(f"service_unit in ({placeholders})")
			for i, n in enumerate(allowed_su):
				params[f"su{i}"] = n
		where_sql = " AND ".join(conditions)
		return frappe.db.sql(
			f"""
			SELECT name, bed_no, service_unit, occupancy_status
			FROM `tabBed No`
			WHERE {where_sql}
			ORDER BY bed_no ASC
			LIMIT 50
			""",
			params,
			as_dict=True,
		)

	filters = {"occupancy_status": occ}
	if allowed_su is not None:
		filters["service_unit"] = ["in", allowed_su]

	return frappe.get_all(
		"Bed No",
		filters=filters,
		fields=out_fields,
		order_by="bed_no asc",
		limit=50,
	)


@frappe.whitelist()
def get_hospital_beds(
	occupancy_status=None,
	search=None,
	room_category=None,
	company=None,
	cost_center=None,
	service_units=None,
):
	"""Backward-compatible alias — returns Bed No records for the admission UI."""
	return get_bed_numbers(
		occupancy_status=occupancy_status,
		search=search,
		cost_center=cost_center,
		service_units=service_units,
	)


@frappe.whitelist()
def add_patient_visitor(admission: str, visitors_name: str, relationship_with_patient: str, cpr__id_no: str | None = None, any_remarks: str | None = None):
	"""Append a Patient Visitor row to an Inpatient Admission and return the created row."""
	if not admission:
		frappe.throw(_("Inpatient Admission is required"))
	if not visitors_name:
		frappe.throw(_("Visitor name is required"))
	if not relationship_with_patient:
		frappe.throw(_("Relationship with patient is required"))

	doc = frappe.get_doc("Inpatient Admission", admission)

	row = doc.append("patient_visitors", {
		"visitors_name": visitors_name,
		"relationship_with_patient": relationship_with_patient,
		"cpr__id_no": cpr__id_no,
		"any_remarks": any_remarks,
		"entered_by": frappe.session.user,
		"entered_date": frappe.utils.today(),
	})

	doc.save(ignore_permissions=True)

	return {
		"name": row.name,
		"visitors_name": row.visitors_name,
		"relationship_with_patient": row.relationship_with_patient,
		"cpr__id_no": row.cpr__id_no,
		"any_remarks": row.any_remarks,
		"entered_by": row.entered_by,
		"entered_date": row.entered_date,
	}


DISCHARGE_PORTAL_ROLES = frozenset(
	{
		"Administrator",
		"System Manager",
		"Healthcare Administrator",
		"Website Manager",
		"Reception",
		"Receptionist",
		"Doctor",
		"Nurse",
		"Nursing User",
		"Physician",
		"Psychologist",
		"Anesthesiologist",
		"Therapist",
		"Nutritionist",
		"Pharmacist",
		"Pharmacy User",
	}
)


def _user_can_access_discharge_portal() -> bool:
	if frappe.session.user in ("Guest", ""):
		return False
	roles = set(frappe.get_roles(frappe.session.user))
	if DISCHARGE_PORTAL_ROLES & roles:
		return True
	lower = {r.lower() for r in roles}
	return any("pharmacist" in r or "pharmacy" in r for r in lower)


def _ensure_discharge_admission_access(admission_name: str) -> None:
	"""Portal discharge APIs: allow clinical/reception roles without Inpatient Admission DocPerm."""
	admission_name = (admission_name or "").strip()
	if not admission_name:
		frappe.throw(_("Admission is required"))

	if not frappe.db.exists("Inpatient Admission", admission_name):
		frappe.throw(_("Inpatient Admission {0} not found").format(admission_name))

	if frappe.has_permission("Inpatient Admission", "read", admission_name):
		return

	if not _user_can_access_discharge_portal():
		frappe.throw(
			_("You need the 'read' permission on Inpatient Admission {0} to perform this action.").format(
				admission_name
			),
			frappe.PermissionError,
		)

	from healthcare.api.common import get_permitted_cost_centers

	permitted_cc = get_permitted_cost_centers()
	if permitted_cc is None:
		return

	if not permitted_cc:
		frappe.throw(_("Not permitted to access this admission"), frappe.PermissionError)

	admission_cc = frappe.db.get_value("Inpatient Admission", admission_name, "cost_center")
	if admission_cc and admission_cc not in permitted_cc:
		frappe.throw(_("Not permitted to access this admission"), frappe.PermissionError)


DISCHARGE_CHILD_TABLE_KEYS = frozenset(
	{
		"patient_documents",
		"patient_document",
		"discharge_checklist",
		"nursing_checklist",
		"patient_relatives",
		"extra_charges",
	}
)

DISCHARGE_EXTRA_CHARGE_TYPES = ("Room Charges", "Medical Supervision", "Observation")

# Set only on the server when an observation is first created — never from portal JSON.
DISCHARGE_SERVER_OWNED_FIELDS = frozenset({"observation_record", "today_charge_sales_order"})


def _parse_discharge_sync_charge_types(sync_charge_types) -> list[str] | None:
	"""Normalize portal charge-type filter; None means sync every enabled charge."""
	if sync_charge_types in (None, ""):
		return None
	parsed = frappe.parse_json(sync_charge_types)
	if not isinstance(parsed, list) or not parsed:
		return None
	filtered = []
	for charge_type in parsed:
		charge_type = (charge_type or "").strip()
		if charge_type in DISCHARGE_EXTRA_CHARGE_TYPES and charge_type not in filtered:
			filtered.append(charge_type)
	return filtered or None

DISCHARGE_PORTAL_SCALAR_FIELDS = (
	"discharge_type",
	"ama_type",
	"discharge_date",
	"discharge_time",
	"final_discharge_date",
	"final_discharge_time",
	"discharged_by_user",
	"final_discharge_user_id",
	"receiving_doctors",
	"discharge_receptionist",
	"discharge_doctor",
	"discharge_nurse",
	"discharge_template",
	"nurse_discharge_template",
	"discharge_treatment_plan",
	"discharge_reason",
	"discharge_diagnosis",
	"discharge_conditions",
	"discharge_instructions",
	"final_exam_mental_status_summary",
	"management_in_hospital",
	"prognosis",
	"next_appointment_date",
	"next_appointment_time",
	"nurse_discharge_template",
	"today_charge",
	"room_charge_today",
	"room_charge_service_unit",
	"room_charges",
	"medical_supervision_amount",
	"today_charge_obs",
	"discharge_to_observation",
	"charge_observation_today",
	"observation_level",
	"observation_room",
	"observation_start_date",
	"observation_practitioner",
	"observation_department",
	"observation_designated_security_personel",
	"observation_amount",
	"observation_duration",
	"observation_note",
	"observation_record",
	"today_charge_sales_order",
)

DISCHARGE_PORTAL_CHECK_FIELDS = frozenset(
	{
		"today_charge",
		"room_charge_today",
		"discharge_to_observation",
		"charge_observation_today",
	}
)

DISCHARGE_PORTAL_CURRENCY_FIELDS = frozenset(
	{"room_charges", "medical_supervision_amount", "today_charge_obs", "observation_amount"}
)


def _get_submitted_discharge_name(admission_name: str) -> str | None:
	return frappe.db.get_value(
		"Discharge",
		{"admission": admission_name, "docstatus": 1},
		"name",
	)


def _get_draft_discharge_name(admission_name: str) -> str | None:
	
	data =  frappe.db.get_value(
		"Discharge",
		{"admission": admission_name, "docstatus": 0},
		"name",
	)
	return data


def _apply_discharge_payload(discharge_doc, discharge_data: dict) -> None:
	"""Apply portal discharge form JSON onto a Discharge document (draft or before submit)."""
	discharge_data = discharge_data or {}

	for key, value in discharge_data.items():
		if key in DISCHARGE_CHILD_TABLE_KEYS:
			continue
		if key in DISCHARGE_SERVER_OWNED_FIELDS:
			continue
		if not hasattr(discharge_doc, key):
			continue
		if key in DISCHARGE_PORTAL_CHECK_FIELDS:
			discharge_doc.set(key, cint(value))
			continue
		if key in DISCHARGE_PORTAL_CURRENCY_FIELDS:
			discharge_doc.set(key, flt(value) if value not in (None, "") else 0)
			continue
		if value not in (None, ""):
			discharge_doc.set(key, value)

	# Only replace child tables when the portal sends them. Doctors/reception do not
	# have the Nursing tab; an empty nursing_checklist in their payload must not wipe
	# rows nurses already completed on the same draft.
	if "discharge_checklist" in discharge_data:
		checklist = frappe.parse_json(discharge_data.get("discharge_checklist") or [])
		from healthcare.healthcare.discharge_checklist_permissions import (
			enrich_checklist_rows_with_template_departments,
			merge_checklist_rows_with_department_permissions,
		)

		template_name = discharge_data.get("discharge_template") or discharge_doc.get("discharge_template")
		if isinstance(checklist, list):
			checklist = enrich_checklist_rows_with_template_departments(checklist, template_name)
			checklist = merge_checklist_rows_with_department_permissions(
				checklist,
				discharge_doc.get("discharge_checklist"),
			)
		discharge_doc.set("discharge_checklist", [])
		if isinstance(checklist, list):
			for idx, row in enumerate(checklist, start=1):
				if not isinstance(row, dict):
					continue
				child = {
					"idx": idx,
					"action_required": _checklist_string_value(row.get("action_required")),
					"department": _checklist_string_value(row.get("department")),
					"user": _checklist_string_value(row.get("user")),
					"name1": _checklist_string_value(row.get("name1")),
					"date_time": _checklist_datetime_value(row.get("date_time")),
					"click": cint(row.get("click") or 0),
					"description": _checklist_string_value(row.get("description")),
					"sr_num": _checklist_string_value(row.get("sr_num")),
				}
				dept_2 = _checklist_string_value(row.get("department_2"))
				if dept_2:
					child["department_2"] = dept_2
				dept_3 = _checklist_string_value(row.get("department_3"))
				if dept_3:
					child["department_3"] = dept_3
				discharge_doc.append("discharge_checklist", child)

	if "nursing_checklist" in discharge_data:
		nursing_checklist = frappe.parse_json(discharge_data.get("nursing_checklist") or [])
		discharge_doc.set("nursing_checklist", [])
		if isinstance(nursing_checklist, list):
			for idx, row in enumerate(nursing_checklist, start=1):
				if not isinstance(row, dict):
					continue
				dept_name = _checklist_string_value(
					row.get("department_name") or row.get("department_label")
				)
				discharge_doc.append(
					"nursing_checklist",
					{
						"idx": idx,
						"action_required": _checklist_string_value(row.get("action_required")),
						"department": _checklist_string_value(row.get("department")),
						"department_name": dept_name or "Nursing",
						"user": _checklist_string_value(row.get("user")),
						"name1": _checklist_string_value(row.get("name1")),
						"date_time": _checklist_datetime_value(row.get("date_time")),
						"click": cint(row.get("click") or 0),
						"description": _checklist_string_value(row.get("description")),
						"sr_num": _checklist_string_value(row.get("sr_num")) or str(idx),
						"cr_id": _checklist_string_value(row.get("cr_id")),
						"cr_date": _checklist_datetime_value(row.get("cr_date")),
						"up_id": _checklist_string_value(row.get("up_id")),
						"up_date": _checklist_datetime_value(row.get("up_date")),
						"auto_create": _checklist_string_value(row.get("auto_create")),
					},
				)

	documents = frappe.parse_json(
		discharge_data.get("patient_documents") or discharge_data.get("patient_document") or []
	)
	discharge_doc.set("patient_documents", [])
	if isinstance(documents, list):
		for idx, row in enumerate(documents, start=1):
			if not isinstance(row, dict):
				continue
			if not (
				row.get("file_name")
				or row.get("document")
				or row.get("document_type")
				or row.get("patient_relation")
				or row.get("signee_name")
			):
				continue
			discharge_doc.append(
				"patient_documents",
				{
					"idx": idx,
					"file_name": (row.get("file_name") or row.get("signee_name") or "").strip() or None,
					"document_type": (row.get("document_type") or "").strip() or None,
					"transaction_no": (row.get("transaction_no") or "").strip() or None,
					"upload_remarks": (row.get("upload_remarks") or "").strip() or None,
					"document": (row.get("document") or "").strip() or None,
					"patient_relation": (row.get("patient_relation") or "").strip() or None,
					"signee_name": (row.get("signee_name") or "").strip() or None,
				},
			)

	relatives = frappe.parse_json(discharge_data.get("patient_relatives") or [])
	discharge_doc.set("patient_relatives", [])
	if isinstance(relatives, list):
		for row in relatives:
			if not isinstance(row, dict):
				continue
			child = discharge_doc.append("patient_relatives", {})
			for key in (
				"relationship_with_patient",
				"relative_name",
				"cpr__id_no",
				"any_remarks",
				"relative_phone_no",
				"relative_alternative_phone_no",
				"relative_alternative_phone_no_2",
			):
				if key in row:
					value = (row.get(key) or "").strip()
					if value:
						child.set(key, value)

	if "extra_charges" in discharge_data:
		extra_rows = frappe.parse_json(discharge_data.get("extra_charges") or [])
		discharge_doc.set("extra_charges", [])
		if isinstance(extra_rows, list):
			for idx, row in enumerate(extra_rows, start=1):
				if not isinstance(row, dict):
					continue
				charge_type = (row.get("charge_type") or "").strip()
				if charge_type not in DISCHARGE_EXTRA_CHARGE_TYPES:
					continue
				discharge_doc.append(
					"extra_charges",
					{
						"idx": idx,
						"charge_type": charge_type,
						"charge_today": cint(row.get("charge_today") or 0),
						"service_unit": (row.get("service_unit") or "").strip() or None,
						"amount": flt(row.get("amount") or 0),
						"sales_order": (row.get("sales_order") or "").strip() or None,
						"item_code": (row.get("item_code") or "").strip() or None,
					},
				)


def _portal_dt_string(value) -> str:
	if not value:
		return ""
	from frappe.utils import get_datetime

	try:
		return get_datetime(value).strftime("%Y-%m-%dT%H:%M")
	except Exception:
		return str(value)


def _portal_date_string(value) -> str:
	if not value:
		return ""
	return str(getdate(value))


def _portal_time_string(value) -> str:
	if not value:
		return ""
	if isinstance(value, timedelta):
		return format_timedelta(value)
	return str(value)


def _portal_scalar_string(value) -> str:
	if value is None or value == "":
		return ""
	if isinstance(value, timedelta):
		return _portal_time_string(value)
	return str(value)


def _checklist_string_value(value) -> str | None:
	if value is None or value == "":
		return None
	if isinstance(value, str):
		text = value.strip()
		return text or None
	return str(value).strip() or None


def _checklist_datetime_value(value):
	"""Normalize checklist datetimes from portal JSON or existing draft rows."""
	if not value:
		return None
	if isinstance(value, str):
		text = value.strip()
		return text or None
	try:
		return get_datetime(value)
	except Exception:
		text = str(value).strip()
		return text or None


def _serialize_checklist_row(row, default_department: str = "") -> dict:
	"""Map discharge or nursing checklist child row for the portal."""
	from healthcare.healthcare.discharge_checklist_permissions import resolve_department_link_label

	dept = (getattr(row, "department", None) or "") or default_department
	if not dept:
		dept_name = getattr(row, "department_name", None) or ""
		if dept_name:
			from healthcare.healthcare.discharge_checklist_permissions import resolve_department_link

			dept = resolve_department_link(dept_name) or dept_name
	dept_2 = getattr(row, "department_2", None) or ""
	dept_3 = getattr(row, "department_3", None) or ""
	raw_dt = getattr(row, "date_time", None)
	if raw_dt:
		date_time = _portal_dt_string(raw_dt)
	else:
		date_time = ""
	return {
		"name": row.name or f"row-{getattr(row, 'idx', 0)}",
		"action_required": getattr(row, "action_required", None) or "",
		"department": dept,
		"department_label": resolve_department_link_label(dept) or dept or default_department,
		"department_2": dept_2,
		"department_2_label": resolve_department_link_label(dept_2) if dept_2 else "",
		"department_3": dept_3,
		"department_3_label": resolve_department_link_label(dept_3) if dept_3 else "",
		"user": getattr(row, "user", None) or "",
		"name1": getattr(row, "name1", None) or "",
		"date_time": date_time,
		"click": bool(getattr(row, "click", 0)),
		"description": getattr(row, "description", None) or "",
		"sr_num": getattr(row, "sr_num", None) or "",
	}


def _serialize_checklist_rows(rows, default_department: str = "") -> list[dict]:
	return [_serialize_checklist_row(row, default_department) for row in (rows or [])]


def _serialize_discharge_draft_for_portal(discharge_doc) -> dict:
	form_data = {}
	for field in DISCHARGE_PORTAL_SCALAR_FIELDS:
		val = discharge_doc.get(field)
		if field == "discharge_date":
			# Portal uses datetime-local; append midnight when doctype stores Date only.
			d = _portal_date_string(val)
			form_data[field] = f"{d}T00:00" if d else ""
		elif field in DISCHARGE_PORTAL_CHECK_FIELDS:
			form_data[field] = cint(val)
		elif field in DISCHARGE_PORTAL_CURRENCY_FIELDS:
			form_data[field] = flt(val) if val not in (None, "") else 0
		elif field in ("final_discharge_date", "next_appointment_date", "observation_start_date"):
			form_data[field] = _portal_date_string(val)
		elif field == "final_discharge_time":
			form_data[field] = _portal_time_string(val)
		else:
			form_data[field] = _portal_scalar_string(val)

	template_name = discharge_doc.get("discharge_template")
	checklist_rows = _serialize_checklist_rows(discharge_doc.get("discharge_checklist"))
	if template_name:
		from healthcare.healthcare.discharge_checklist_permissions import (
			enrich_checklist_rows_with_template_departments,
		)

		if not checklist_rows:
			from healthcare.api.common import get_discharge_checklist_from_template

			checklist_rows = get_discharge_checklist_from_template(template_name)
		else:
			checklist_rows = enrich_checklist_rows_with_template_departments(
				checklist_rows, template_name
			)

	return {
		"name": discharge_doc.name,
		"docstatus": discharge_doc.docstatus,
		"form_data": form_data,
		"discharge_checklist": checklist_rows,
		"nursing_checklist": _serialize_checklist_rows(
			discharge_doc.get("nursing_checklist"), default_department="Nursing"
		),
		"patient_documents": [
			{
				"file_name": row.file_name or "",
				"document_type": row.document_type or "",
				"transaction_no": row.transaction_no or "",
				"upload_remarks": row.upload_remarks or "",
				"document": row.document or "",
				"patient_relation": getattr(row, "patient_relation", None) or "",
				"signee_name": _discharge_document_signee_name(row),
			}
			for row in (discharge_doc.get("patient_documents") or [])
		],
		"patient_relatives": [
			{
				"relationship_with_patient": row.relationship_with_patient or "",
				"relative_name": row.relative_name or "",
				"relative_phone_no": row.relative_phone_no or "",
				"relative_alternative_phone_no": row.relative_alternative_phone_no or "",
				"relative_alternative_phone_no_2": row.relative_alternative_phone_no_2 or "",
				"cpr__id_no": row.cpr__id_no or "",
				"any_remarks": row.any_remarks or "",
			}
			for row in (discharge_doc.get("patient_relatives") or [])
		],
		"extra_charges": [
			{
				"charge_type": row.charge_type or "",
				"charge_today": cint(row.charge_today),
				"service_unit": row.service_unit or "",
				"amount": flt(row.amount or 0),
				"sales_order": row.sales_order or "",
				"item_code": row.item_code or "",
			}
			for row in (discharge_doc.get("extra_charges") or [])
		],
	}


def _discharge_document_signee_name(row) -> str:
	"""Signee name for discharge document rows (with legacy file_name fallback)."""
	signee = (getattr(row, "signee_name", None) or "").strip()
	if signee:
		return signee
	doc_type = (getattr(row, "document_type", None) or "").strip().lower()
	relation = (getattr(row, "patient_relation", None) or "").strip()
	is_signature = "signature" in doc_type or bool(relation)
	if not is_signature:
		return ""
	from_file = (getattr(row, "file_name", None) or "").strip()
	if not from_file or from_file.lower().startswith("signature"):
		return ""
	return from_file


def _get_or_create_draft_discharge(admission_name: str):
	from healthcare.healthcare.doctype.inpatient_admission.inpatient_admission import (
		create_discharge_from_inpatient_admission,
	)

	_ensure_discharge_admission_access(admission_name)

	if _get_submitted_discharge_name(admission_name):
		frappe.throw(_("This admission has already been discharged."))

	draft_name = _get_draft_discharge_name(admission_name)
	if draft_name:
		return frappe.get_doc("Discharge", draft_name, ignore_permissions=True)

	return create_discharge_from_inpatient_admission(
		admission_name,
		ignore_permissions=True,
	)


@frappe.whitelist()
def get_discharge_draft_for_admission(admission_name):
	"""Return draft Discharge (docstatus 0) for portal resume, or null."""
	if not admission_name:
		frappe.throw(_("Admission is required"))

	_ensure_discharge_admission_access(admission_name)

	draft_name = _get_draft_discharge_name(admission_name)
	if not draft_name:
		return None
	
	discharge_doc = frappe.get_doc("Discharge", draft_name, ignore_permissions=True)
	
	return _serialize_discharge_draft_for_portal(discharge_doc)


def _bill_pending_given_medicine_on_discharge_start(
	admission_name: str,
	*,
	first_item_is_complete: bool,
	force: bool = False,
):
	"""Charge unbilled given medicine once discharge has started.

	The first checklist item being checked means the patient will be discharged today,
	so remaining Medicine Given cannot wait for the daily/weekly consumption job.
	Later saves (and submit) retry any rows still missing a Sales Order / Delivery Note.

	Requires Healthcare Settings → Create Pending Given Medicine on Discharge.
	"""
	if not cint(
		frappe.db.get_single_value("Healthcare Settings", "create_pending_given_medicine_on_discharge")
	):
		return None

	if not force and not first_item_is_complete:
		return None

	from healthcare.api.nursing_inventory import create_pending_medicine_sales_orders_for_admission

	try:
		return create_pending_medicine_sales_orders_for_admission(admission_name)
	except Exception:
		frappe.log_error(
			title=f"Failed to bill pending given medicine for admission {admission_name}",
			message=frappe.get_traceback(),
		)
		raise


def _apply_medicine_billing_to_discharge_response(response: dict, medicine_result) -> None:
	if not medicine_result:
		return
	so_name = medicine_result.get("sales_order")
	dn_name = medicine_result.get("delivery_note")
	if so_name:
		response["medicine_sales_order"] = so_name
	if dn_name:
		response["medicine_delivery_note"] = dn_name
	linked = medicine_result.get("linked_rows")
	if linked:
		response["medicine_linked_rows"] = linked
	if so_name:
		if dn_name:
			med_msg = _("Given medicine Sales Order {0} and Delivery Note {1} created.").format(
				so_name, dn_name
			)
		else:
			med_msg = _("Given medicine Sales Order {0} created.").format(so_name)
		base = (response.get("message") or "").rstrip(".")
		response["message"] = f"{base}. {med_msg}" if base else med_msg


def _discharge_stay_charge_as_of(discharge_doc):
	"""End date for remaining stay days: later of draft dates and today.

	A stale or wrong draft discharge_date (this admission had 4 Aug, before
	admission) must not zero out the charge window while the patient is still in.
	"""
	candidates = [getdate(frappe.utils.today())]
	for field in ("discharge_date", "final_discharge_date"):
		val = discharge_doc.get(field)
		if val:
			candidates.append(getdate(val))
	return max(candidates)


def _bill_pending_package_on_discharge_start(
	admission_name: str,
	discharge_doc,
	*,
	first_item_is_complete: bool,
	force: bool = False,
):
	"""Charge remaining package/room days through the discharge date.

	Family may already have paid some stay days mid-admission. Once discharge has
	started (first checklist item ticked + discharge date), bill from the last
	charged day through that final date so the stay is fully covered.

	Requires Healthcare Settings → Create Pending Room Charges on Discharge.
	"""
	if not cint(
		frappe.db.get_single_value("Healthcare Settings", "create_pending_room_charges_on_discharge")
	):
		return None

	if not force and not first_item_is_complete:
		return None

	as_of = _discharge_stay_charge_as_of(discharge_doc)
	from healthcare.api.package_charge_to_today import charge_pending_package_days_for_admission

	try:
		return charge_pending_package_days_for_admission(admission_name, as_of=as_of)
	except Exception:
		frappe.log_error(
			title=f"Failed to bill pending package days for admission {admission_name}",
			message=frappe.get_traceback(),
		)
		raise


def _apply_package_billing_to_discharge_response(response: dict, package_result) -> None:
	if not package_result:
		return
	so_name = package_result.get("sales_order")
	if so_name:
		response["package_sales_order"] = so_name
	days = package_result.get("days_charged")
	if days:
		response["package_days_charged"] = days
	if package_result.get("from_date"):
		response["package_from_date"] = package_result.get("from_date")
	if package_result.get("to_date"):
		response["package_to_date"] = package_result.get("to_date")
	if so_name:
		from_date = package_result.get("from_date") or ""
		to_date = package_result.get("to_date") or ""
		pkg_msg = _("Package/room Sales Order {0} created for {1} day(s) ({2} to {3}).").format(
			so_name, days or 0, from_date, to_date
		)
		base = (response.get("message") or "").rstrip(".")
		response["message"] = f"{base}. {pkg_msg}" if base else pkg_msg


@frappe.whitelist()
def save_discharge_draft(admission_name, discharge_data, sync_observation=None, sync_charge_types=None):
	"""Create or update a draft Discharge without submitting."""
	if not admission_name:
		frappe.throw(_("Admission is required"))

	from healthcare.healthcare.discharge_checklist_permissions import is_first_checklist_item_complete

	discharge_data = frappe.parse_json(discharge_data or {})
	sync_observation = cint(sync_observation)
	charge_types = _parse_discharge_sync_charge_types(sync_charge_types)
	discharge_doc = _get_or_create_draft_discharge(admission_name)
	_apply_discharge_payload(discharge_doc, discharge_data)
	# Nursing Checklist Template names may be stored in nurse_discharge_template (Link → DNT).
	discharge_doc.flags.ignore_links = True
	discharge_doc.save(ignore_permissions=True)
	discharge_doc.reload()

	observation_result = None
	if charge_types is None or "Observation" in charge_types:
		observation_result = _create_observation_from_discharge_if_needed(discharge_doc, admission_name)
		discharge_doc.reload()
	if (
		sync_observation
		and cint(discharge_doc.get("discharge_to_observation"))
		and _is_active_discharge_observation(discharge_doc.get("observation_record"))
	):
		_sync_observation_from_discharge_if_linked(discharge_doc)

	charge_result = _sync_discharge_extra_charge_sales_orders(
		discharge_doc, admission_name, charge_types=charge_types
	)
	discharge_doc.reload()
	if charge_result and charge_result.get("sales_orders"):
		for charge_type, so_name in charge_result["sales_orders"].items():
			if charge_type == "Room Charges":
				_persist_discharge_charge_sales_order_link(discharge_doc, so_name)

	first_item_complete = is_first_checklist_item_complete(discharge_doc.get("discharge_checklist"))
	medicine_result = _bill_pending_given_medicine_on_discharge_start(
		admission_name,
		first_item_is_complete=first_item_complete,
	)
	package_result = _bill_pending_package_on_discharge_start(
		admission_name,
		discharge_doc,
		first_item_is_complete=first_item_complete,
	)

	frappe.db.commit()

	response = {
		"name": discharge_doc.name,
		"message": _("Discharge draft saved"),
	}
	if discharge_doc.get("observation_record"):
		response["observation_record"] = discharge_doc.observation_record
	if discharge_doc.get("today_charge_sales_order"):
		response["today_charge_sales_order"] = discharge_doc.today_charge_sales_order
	if observation_result:
		response["observation"] = observation_result.get("name")
		response["observation_trans_no"] = observation_result.get("trans_no")
		if observation_result.get("sales_order"):
			response["sales_order"] = observation_result.get("sales_order")
		if observation_result.get("existing"):
			response["message"] = _(
				"Discharge draft saved. Observation {0} already linked."
			).format(observation_result.get("name"))
		else:
			response["message"] = _(
				"Discharge draft saved. Observation {0} created."
			).format(observation_result.get("name"))
			if observation_result.get("sales_order"):
				response["message"] = _(
					"Discharge draft saved. Observation {0} and Sales Order {1} created."
				).format(observation_result.get("name"), observation_result.get("sales_order"))

	if charge_result:
		sales_orders = charge_result.get("sales_orders") or {}
		if sales_orders:
			response["charge_sales_orders"] = sales_orders
			first_so = next(iter(sales_orders.values()))
			response["charge_sales_order"] = first_so
			if sales_orders.get("Room Charges"):
				response["today_charge_sales_order"] = sales_orders["Room Charges"]
			created = [
				info["sales_order"]
				for info in (charge_result.get("details") or {}).values()
				if info and not info.get("existing")
			]
			if created:
				response["message"] = _("Discharge draft saved. Sales Order(s) created: {0}").format(
					", ".join(created)
				)
			elif charge_result.get("existing"):
				response["message"] = _("Discharge draft saved. Linked Sales Orders updated.")

	_apply_medicine_billing_to_discharge_response(response, medicine_result)
	_apply_package_billing_to_discharge_response(response, package_result)

	return response


def _is_active_discharge_observation(observation_name: str | None) -> bool:
	"""True when observation exists and is not cancelled."""
	observation_name = (observation_name or "").strip()
	if not observation_name or not frappe.db.exists("Observation", observation_name):
		return False
	return cint(frappe.db.get_value("Observation", observation_name, "docstatus")) < 2


def _clear_discharge_observation_link(discharge_doc) -> None:
	"""Drop a stale observation_record pointer on the discharge draft."""
	if not discharge_doc.name or not (discharge_doc.get("observation_record") or "").strip():
		return
	frappe.db.set_value(
		"Discharge",
		discharge_doc.name,
		"observation_record",
		"",
		update_modified=False,
	)
	discharge_doc.observation_record = ""


def _persist_discharge_observation_link(discharge_doc, observation_name: str) -> None:
	"""Store the one observation document created for this discharge draft."""
	observation_name = (observation_name or "").strip()
	if not observation_name or not discharge_doc.name:
		return
	if discharge_doc.get("observation_record") == observation_name:
		return
	frappe.db.set_value(
		"Discharge",
		discharge_doc.name,
		"observation_record",
		observation_name,
		update_modified=False,
	)
	discharge_doc.observation_record = observation_name


def _resolve_discharge_observation_link(discharge_doc, admission_name: str) -> str | None:
	"""Return the active observation linked to this discharge, if any."""
	linked = (discharge_doc.get("observation_record") or "").strip()
	if linked:
		if _is_active_discharge_observation(linked):
			return linked
		_clear_discharge_observation_link(discharge_doc)

	# Backfill link when an observation was created earlier but observation_record was not stored.
	filters = {"admission_no": admission_name, "dc_date": ["is", "not set"], "docstatus": ["<", 2]}
	rows = frappe.get_all(
		"Observation",
		filters=filters,
		fields=["name"],
		order_by="creation desc",
		limit=1,
	)
	if not rows:
		patient = discharge_doc.file_no or frappe.db.get_value(
			"Inpatient Admission", admission_name, "patient"
		)
		if patient:
			rows = frappe.get_all(
				"Observation",
				filters={"patient": patient, "dc_date": ["is", "not set"], "docstatus": ["<", 2]},
				fields=["name"],
				order_by="creation desc",
				limit=1,
			)

	if rows:
		observation_name = rows[0].name
		if _is_active_discharge_observation(observation_name):
			_persist_discharge_observation_link(discharge_doc, observation_name)
			return observation_name

	return None


def _ensure_observation_sales_order(observation_name: str) -> dict:
	"""Create a Sales Order for an observation when missing."""
	from healthcare.api.observation import create_sales_order_from_observation

	order_created = frappe.db.get_value("Observation", observation_name, "order_created")
	if order_created and frappe.db.exists("Sales Order", order_created):
		return {"sales_order": order_created, "existing": True}

	so_result = create_sales_order_from_observation(observation_name)
	return {
		"sales_order": (so_result or {}).get("sales_order"),
		"existing": bool((so_result or {}).get("existing")),
	}


def _create_observation_from_discharge_if_needed(discharge_doc, admission_name: str) -> dict | None:
	"""When discharge is to observation, create the Observation record and Sales Order once."""
	if not cint(discharge_doc.get("discharge_to_observation")):
		return None

	existing = _resolve_discharge_observation_link(discharge_doc, admission_name)
	if existing:
		from healthcare.api.observation import _submit_observation_if_draft

		_submit_observation_if_draft(existing)
		so_info = _ensure_observation_sales_order(existing)
		return {
			"name": existing,
			"trans_no": frappe.db.get_value("Observation", existing, "trans_no"),
			"sales_order": so_info.get("sales_order"),
			"existing": True,
		}

	level = (discharge_doc.get("observation_level") or "").strip()
	room = (discharge_doc.get("observation_room") or "").strip()

	admission = frappe.get_doc("Inpatient Admission", admission_name)
	patient = discharge_doc.file_no or admission.patient
	if not patient:
		frappe.throw(_("Patient is required to create an observation"))

	from healthcare.api.observation import create_observation

	start_date = discharge_doc.get("observation_start_date") or discharge_doc.discharge_date or frappe.utils.today()
	if hasattr(start_date, "date"):
		start_date = start_date.date()
	start_date = frappe.utils.getdate(start_date)

	amount = flt(discharge_doc.get("observation_amount")) or flt(discharge_doc.get("today_charge_obs"))

	obs_payload = {
		"patient": patient,
		"admission_no": admission_name,
		"company": admission.company or frappe.defaults.get_user_default("Company"),
		"practitioner": (
			discharge_doc.get("observation_practitioner")
			or discharge_doc.discharge_doctor
			or admission.primary_practitioner
		),
		"department": discharge_doc.get("observation_department") or admission.medical_department,
		"observation_level": level,
		"designated_security_personel": discharge_doc.get("observation_designated_security_personel") or "",
		"note": discharge_doc.get("observation_note") or "",
		"duration": discharge_doc.get("observation_duration") or "",
		"room": room,
		"start_date": start_date,
		"amount": amount,
	}
	created = create_observation(obs_payload)
	if not created or not created.get("name"):
		frappe.throw(_("Failed to create observation for this discharge"))

	observation_name = created["name"]
	try:
		so_info = _ensure_observation_sales_order(observation_name)
	except Exception as exc:
		frappe.log_error(
			title=f"Observation sales order failed for {observation_name}",
			message=frappe.get_traceback(),
		)
		frappe.throw(
			_("Observation {0} was created but Sales Order could not be created: {1}").format(
				observation_name, exc
			)
		)

	if discharge_doc.get("observation_record") != observation_name:
		_persist_discharge_observation_link(discharge_doc, observation_name)

	return {
		**created,
		"sales_order": so_info.get("sales_order"),
		"existing": False,
	}


def _sync_observation_from_discharge_if_linked(discharge_doc) -> None:
	"""Push discharge observation fields onto the linked Observation document."""
	observation_name = (discharge_doc.get("observation_record") or "").strip()
	if not observation_name or not _is_active_discharge_observation(observation_name):
		if observation_name:
			_clear_discharge_observation_link(discharge_doc)
		return

	obs = frappe.get_doc("Observation", observation_name)
	if obs.get("dc_date"):
		return
	if cint(obs.docstatus) != 0:
		# Submitted or cancelled observations cannot be edited from discharge fields.
		return

	new_room = frappe.utils.cstr(discharge_doc.get("observation_room") or "").strip()
	if new_room and new_room != frappe.utils.cstr(obs.get("room") or "").strip():
		from healthcare.api.observation import validate_observation_room_available

		validate_observation_room_available(new_room)

	level = (discharge_doc.get("observation_level") or "").strip()
	if level:
		obs.observation_level = level
	if new_room:
		obs.room = new_room

	obs.note = discharge_doc.get("observation_note") or ""
	obs.designated_security_personel = discharge_doc.get("observation_designated_security_personel") or ""
	obs.amount = flt(discharge_doc.get("observation_amount")) or flt(discharge_doc.get("today_charge_obs"))
	obs.duration = discharge_doc.get("observation_duration") or ""

	start_date = discharge_doc.get("observation_start_date")
	if start_date:
		obs.start_date = getdate(start_date)

	practitioner = (
		discharge_doc.get("observation_practitioner") or discharge_doc.get("discharge_doctor") or ""
	).strip()
	if practitioner:
		obs.healthcare_practitioner = practitioner

	department = (discharge_doc.get("observation_department") or "").strip()
	if department:
		obs.medical_department = department

	obs.flags.ignore_permissions = True
	obs.save()


def _persist_discharge_charge_sales_order_link(discharge_doc, sales_order_name: str) -> None:
	sales_order_name = (sales_order_name or "").strip()
	if not sales_order_name or not discharge_doc.name:
		return
	if discharge_doc.get("today_charge_sales_order") == sales_order_name:
		return
	frappe.db.set_value(
		"Discharge",
		discharge_doc.name,
		"today_charge_sales_order",
		sales_order_name,
		update_modified=False,
	)
	discharge_doc.today_charge_sales_order = sales_order_name


def _existing_discharge_charge_sales_order(discharge_name: str) -> str | None:
	rows = frappe.get_all(
		"Sales Order",
		filters={
			"custom_base_reference": "Discharge",
			"custom_base_reference_name": discharge_name,
			"docstatus": ["<", 2],
		},
		pluck="name",
		order_by="creation desc",
		limit=1,
	)
	return rows[0] if rows else None


def _resolve_discharge_charge_sales_order_link(discharge_doc) -> str | None:
	linked = (discharge_doc.get("today_charge_sales_order") or "").strip()
	if linked and frappe.db.exists("Sales Order", linked):
		return linked

	existing = _existing_discharge_charge_sales_order(discharge_doc.name)
	if existing:
		_persist_discharge_charge_sales_order_link(discharge_doc, existing)
		return existing
	return None


def _item_code_from_healthcare_service_unit_type(service_unit_type: str) -> str | None:
	"""Resolve billing Item from Healthcare Service Unit Type.item / item_code."""
	service_unit_type = (service_unit_type or "").strip()
	if not service_unit_type or not frappe.db.exists("Healthcare Service Unit Type", service_unit_type):
		return None

	row = frappe.db.get_value(
		"Healthcare Service Unit Type",
		service_unit_type,
		["item", "item_code", "service_unit_type"],
		as_dict=True,
	)
	if not row:
		return None

	for candidate in (row.get("item"), row.get("item_code")):
		item_code = (candidate or "").strip()
		if item_code and frappe.db.exists("Item", item_code):
			return item_code
	return None


def _item_code_from_healthcare_service_unit(service_unit: str) -> str | None:
	"""Resolve billing Item from Healthcare Service Unit → Healthcare Service Unit Type → Item."""
	service_unit = (service_unit or "").strip()
	if not service_unit or not frappe.db.exists("Healthcare Service Unit", service_unit):
		return None

	service_unit_type = frappe.db.get_value(
		"Healthcare Service Unit", service_unit, "service_unit_type"
	)
	return _item_code_from_healthcare_service_unit_type(service_unit_type)


def _resolve_package_quotation_item(admission, service_unit: str | None = None) -> dict:
	"""Item for package quotation lines: Service Unit Type Item (not the room/unit itself)."""
	service_unit = (service_unit or "").strip() or None
	service_unit_type = None
	room_label = None

	if service_unit and frappe.db.exists("Healthcare Service Unit", service_unit):
		su_row = frappe.db.get_value(
			"Healthcare Service Unit",
			service_unit,
			["healthcare_service_unit_name", "service_unit_type"],
			as_dict=True,
		)
		if su_row:
			room_label = su_row.healthcare_service_unit_name or service_unit
			service_unit_type = (su_row.service_unit_type or "").strip() or None

	if not service_unit_type:
		service_unit_type = (admission.get("admission_service_unit_type") or "").strip() or None

	item_code = None
	if service_unit:
		item_code = _item_code_from_healthcare_service_unit(service_unit)
	if not item_code and service_unit_type:
		item_code = _item_code_from_healthcare_service_unit_type(service_unit_type)

	if not item_code:
		type_label = service_unit_type or _("(not set)")
		frappe.throw(
			_(
				"No Item is linked on Healthcare Service Unit Type “{0}”. "
				"Set the Item on that Service Unit Type — package quotations bill the type item, not the room."
			).format(type_label)
		)

	item_name = frappe.db.get_value("Item", item_code, "item_name") or item_code
	type_label = service_unit_type or item_name
	return {
		"item_code": item_code,
		"item_name": item_name,
		"service_unit_type": service_unit_type,
		"service_unit": service_unit,
		"room_label": room_label or type_label,
		"type_label": type_label,
	}


def _resolve_discharge_room_charge_item_code(
	admission_name: str, service_unit: str | None = None
) -> str:
	service_unit = (service_unit or "").strip()
	if service_unit:
		item_code = _item_code_from_healthcare_service_unit(service_unit)
		if item_code:
			return item_code

		# Legacy fallback: room display name or unit id matching an Item code.
		service_unit_name = frappe.db.get_value(
			"Healthcare Service Unit",
			service_unit,
			"healthcare_service_unit_name",
		)
		item_code = (service_unit_name or service_unit or "").strip()
		if item_code and frappe.db.exists("Item", item_code):
			return item_code

	occupancy = frappe.get_all(
		"Inpatient Occupancy",
		filters={"parent": admission_name, "left": 0},
		fields=["service_unit"],
		order_by="check_in desc",
		limit=1,
	)
	if occupancy and occupancy[0].service_unit:
		occupancy_unit = occupancy[0].service_unit
		item_code = _item_code_from_healthcare_service_unit(occupancy_unit)
		if item_code:
			return item_code

		service_unit_name = frappe.db.get_value(
			"Healthcare Service Unit",
			occupancy_unit,
			"healthcare_service_unit_name",
		)
		item_code = (service_unit_name or occupancy_unit or "").strip()
		if item_code and frappe.db.exists("Item", item_code):
			return item_code

	item_code = (
		frappe.db.get_single_value("Healthcare Settings", "inpatient_visit_charge_item") or ""
	).strip()
	if item_code and frappe.db.exists("Item", item_code):
		return item_code

	frappe.throw(
		_(
			"Room charge item is not configured. Set the Item on the room's Healthcare Service Unit Type, "
			"set Inpatient Visit Charge Item in Healthcare Settings, or use a room with a matching Item code."
		)
	)


def get_medical_supervision_charge_config() -> dict:
	"""Resolve Healthcare Settings → Medical Supervision Item (Healthcare Service Template)."""
	template_name = (frappe.db.get_single_value("Healthcare Settings", "medical_supervision_item") or "").strip()
	if not template_name:
		return {
			"configured": False,
			"template": None,
			"service_name": None,
			"item_code": None,
			"item_name": None,
			"rate": 0,
		}

	if not frappe.db.exists("Healthcare Service Template", template_name):
		return {
			"configured": False,
			"template": template_name,
			"service_name": None,
			"item_code": None,
			"item_name": None,
			"rate": 0,
		}

	tpl = frappe.get_doc("Healthcare Service Template", template_name)
	item_code = (tpl.item_code or "").strip()
	rate = flt(tpl.rate)
	item_name = frappe.db.get_value("Item", item_code, "item_name") if item_code else None

	return {
		"configured": bool(item_code),
		"template": template_name,
		"service_name": tpl.service_name or template_name,
		"item_code": item_code,
		"item_name": item_name,
		"rate": rate,
	}


@frappe.whitelist()
def get_medical_supervision_charge_preview(service_unit: str | None = None) -> dict:
	"""API for discharge UI: medical supervision item and default rate."""
	config = get_medical_supervision_charge_config()
	service_unit = (service_unit or "").strip()
	if not service_unit:
		return config

	config = dict(config)
	config["service_unit"] = service_unit
	unit_item_code = _item_code_from_healthcare_service_unit(service_unit)
	if unit_item_code:
		config["service_unit_item_code"] = unit_item_code
		if not config.get("item_code"):
			config["item_code"] = unit_item_code
			config["configured"] = True

	service_unit_type = frappe.db.get_value(
		"Healthcare Service Unit", service_unit, "service_unit_type"
	)
	if service_unit_type:
		unit_rate = flt(frappe.db.get_value("Healthcare Service Unit Type", service_unit_type, "rate"))
		if unit_rate > 0 and not flt(config.get("rate")):
			config["rate"] = unit_rate
	return config


def _discharge_room_service_unit(discharge_doc, admission_name: str) -> str | None:
	"""Healthcare Service Unit selected for room charges, or current admission occupancy."""
	unit = (discharge_doc.get("room_charge_service_unit") or "").strip()
	if unit and frappe.db.exists("Healthcare Service Unit", unit):
		return unit

	occupancy = frappe.get_all(
		"Inpatient Occupancy",
		filters={"parent": admission_name, "left": 0},
		fields=["service_unit"],
		order_by="check_in desc",
		limit=1,
	)
	if occupancy and occupancy[0].service_unit:
		return occupancy[0].service_unit
	return None


def _resolve_discharge_medical_supervision_item_code(
	discharge_doc, admission_name: str, service_unit: str | None = None
) -> str:
	config = get_medical_supervision_charge_config()
	item_code = (config.get("item_code") or "").strip()
	if item_code and frappe.db.exists("Item", item_code):
		return item_code

	service_unit = (service_unit or "").strip() or _discharge_room_service_unit(
		discharge_doc, admission_name
	)
	if service_unit:
		item_code = _item_code_from_healthcare_service_unit(service_unit)
		if item_code:
			return item_code

	frappe.throw(
		_(
			"Medical supervision item is not configured. Set Medical Supervision Item in Healthcare Settings "
			"(Healthcare Service Template with Item), or choose a room whose Healthcare Service Unit Type has an Item."
		)
	)


def _sync_extra_charge_rows_from_scalars(discharge_doc) -> None:
	"""Keep Discharge Extra Charge rows aligned with portal scalar fields."""
	specs = {
		"Room Charges": {
			"charge_today": cint(discharge_doc.get("room_charge_today")),
			"service_unit": (discharge_doc.get("room_charge_service_unit") or "").strip() or None,
			"amount": flt(discharge_doc.get("room_charges")),
		},
		"Medical Supervision": {
			"charge_today": cint(discharge_doc.get("today_charge")),
			"service_unit": _discharge_room_service_unit(discharge_doc, discharge_doc.admission),
			"amount": flt(discharge_doc.get("medical_supervision_amount")),
		},
		"Observation": {
			"charge_today": cint(discharge_doc.get("charge_observation_today")),
			"service_unit": (discharge_doc.get("observation_room") or "").strip() or None,
			"amount": flt(discharge_doc.get("observation_amount")) or flt(discharge_doc.get("today_charge_obs")),
		},
	}

	rows_by_type = {row.charge_type: row for row in (discharge_doc.get("extra_charges") or [])}
	for charge_type, values in specs.items():
		row = rows_by_type.get(charge_type)
		if not row:
			row = discharge_doc.append(
				"extra_charges",
				{"charge_type": charge_type, "sales_order": None},
			)
			rows_by_type[charge_type] = row
		row.charge_today = values["charge_today"]
		row.service_unit = values["service_unit"]
		row.amount = values["amount"]


def _create_discharge_extra_charge_sales_order(
	discharge_doc,
	admission_name: str,
	charge_type: str,
	amount: float,
	item_code: str,
	description: str,
) -> str:
	admission = frappe.get_doc("Inpatient Admission", admission_name)
	patient = discharge_doc.file_no or admission.patient
	if not patient:
		frappe.throw(_("Patient is required to create a {0} Sales Order").format(charge_type))

	from healthcare.api.patient_file_no_charge import _ensure_patient_customer
	from healthcare.api.sales_order_cost_center import (
		apply_cost_center_to_sales_order,
		cost_center_from_visit_or_admission,
	)

	customer = _ensure_patient_customer(patient)
	company = admission.company or frappe.defaults.get_user_default("Company")
	if not company:
		frappe.throw(_("Company is required"))

	billing_date = getdate(discharge_doc.discharge_date or frappe.utils.today())
	if hasattr(billing_date, "date"):
		billing_date = billing_date.date()
	billing_date = getdate(billing_date)

	so = frappe.new_doc("Sales Order")
	so.company = company
	so.customer = customer
	so.patient = patient
	if hasattr(so, "custom_patient"):
		so.custom_patient = patient
	patient_name = frappe.db.get_value("Patient", patient, "patient_name")
	if patient_name and hasattr(so, "custom_patient_name"):
		so.custom_patient_name = patient_name

	so.custom_reference_type = "Inpatient Admission"
	so.custom_reference_name = admission_name
	so.custom_base_reference = "Discharge"
	so.custom_base_reference_name = discharge_doc.name
	so.transaction_date = billing_date
	so.delivery_date = billing_date
	so.ignore_pricing_rule = 1

	so.append(
		"items",
		{
			"item_code": item_code,
			"qty": 1,
			"rate": amount,
			"price_list_rate": amount,
			"description": description,
		},
	)

	cc = cost_center_from_visit_or_admission("Inpatient Admission", admission_name)
	apply_cost_center_to_sales_order(so, cc)

	so.insert(ignore_permissions=True)
	so.flags.ignore_permissions = True
	so.submit()
	return so.name


def _sync_discharge_extra_charge_sales_order_row(
	discharge_doc, admission_name: str, row
) -> dict | None:
	charge_type = (row.charge_type or "").strip()
	if charge_type not in DISCHARGE_EXTRA_CHARGE_TYPES:
		return None

	charge_today = cint(row.charge_today)
	linked_so = (row.sales_order or "").strip()

	if not charge_today:
		if linked_so:
			_cancel_discharge_charge_sales_order(discharge_doc.name, linked_so)
			row.sales_order = None
		return None

	if charge_type == "Room Charges":
		amount = flt(row.amount)
		if amount <= 0:
			frappe.throw(_("Room Charges must be greater than zero when Room Charge Today is enabled"))
		service_unit = (row.service_unit or "").strip()
		if not service_unit:
			frappe.throw(_("Room is required when Room Charge Today is enabled"))
		item_code = _resolve_discharge_room_charge_item_code(admission_name, service_unit)
		description = _("Discharge room charge for {0}").format(
			getdate(discharge_doc.discharge_date or frappe.utils.today())
		)
	elif charge_type == "Medical Supervision":
		amount = flt(row.amount)
		if amount <= 0:
			frappe.throw(
				_("Medical Supervision Amount must be greater than zero when Medical Supervision Charge is enabled")
			)
		service_unit = (row.service_unit or "").strip()
		item_code = _resolve_discharge_medical_supervision_item_code(
			discharge_doc, admission_name, service_unit
		)
		description = _("Discharge medical supervision for {0}").format(
			getdate(discharge_doc.discharge_date or frappe.utils.today())
		)
	elif charge_type == "Observation":
		observation_name = (discharge_doc.get("observation_record") or "").strip()
		if not observation_name:
			return None
		so_info = _ensure_observation_sales_order(observation_name)
		so_name = (so_info or {}).get("sales_order")
		if so_name:
			row.sales_order = so_name
			row.item_code = None
			return {"sales_order": so_name, "existing": bool((so_info or {}).get("existing"))}
		return None
	else:
		return None

	row.item_code = item_code

	if linked_so and frappe.db.exists("Sales Order", linked_so):
		so = frappe.get_doc("Sales Order", linked_so)
		if cint(so.docstatus) == 2:
			linked_so = ""
		elif so.items:
			so.items[0].item_code = item_code
			so.items[0].rate = amount
			so.items[0].price_list_rate = amount
			so.items[0].description = description
			so.flags.ignore_permissions = True
			so.save()
			return {"sales_order": so.name, "existing": True}

	so_name = _create_discharge_extra_charge_sales_order(
		discharge_doc, admission_name, charge_type, amount, item_code, description
	)
	row.sales_order = so_name
	return {"sales_order": so_name, "existing": False}


def _sync_discharge_extra_charge_sales_orders(
	discharge_doc, admission_name: str, charge_types: list[str] | None = None
) -> dict | None:
	"""Create or update Sales Orders for enabled discharge extra charges."""
	_sync_extra_charge_rows_from_scalars(discharge_doc)
	discharge_doc.flags.ignore_permissions = True
	discharge_doc.save()
	discharge_doc.reload()

	rows = list(discharge_doc.get("extra_charges") or [])
	if charge_types:
		allowed = set(charge_types)
		rows = [row for row in rows if (row.charge_type or "").strip() in allowed]

	has_charge = any(cint(row.charge_today) for row in rows if (row.charge_type or "") != "Observation")
	if not has_charge and (
		charge_types is None or "Observation" in (charge_types or [])
	):
		has_charge = (
			cint(discharge_doc.get("charge_observation_today"))
			and (discharge_doc.get("observation_record") or "").strip()
		)
	if not has_charge:
		return None

	sales_orders: dict[str, str] = {}
	details: dict[str, dict] = {}
	for row in rows:
		result = _sync_discharge_extra_charge_sales_order_row(discharge_doc, admission_name, row)
		if not result or not result.get("sales_order"):
			continue
		charge_type = row.charge_type
		sales_orders[charge_type] = result["sales_order"]
		details[charge_type] = result

	discharge_doc.flags.ignore_permissions = True
	discharge_doc.save()

	all_existing = bool(details) and all(d.get("existing") for d in details.values())
	return {
		"sales_orders": sales_orders,
		"details": details,
		"existing": all_existing,
	}


def _create_discharge_today_charge_sales_order_if_needed(
	discharge_doc, admission_name: str
) -> dict | None:
	"""Deprecated — use _sync_discharge_extra_charge_sales_orders."""
	return _sync_discharge_extra_charge_sales_orders(discharge_doc, admission_name)


def _sync_discharge_charge_sales_order_if_linked(discharge_doc) -> None:
	"""Deprecated — extra charges are synced via _sync_discharge_extra_charge_sales_orders."""
	pass


def _cancel_discharge_charge_sales_order(discharge_name: str, sales_order_name: str | None = None) -> None:
	"""Cancel or delete Sales Orders linked to a discharge today charge."""
	names: list[str] = []
	if sales_order_name:
		names = [sales_order_name]
	else:
		names = frappe.get_all(
			"Sales Order",
			filters={
				"custom_base_reference": "Discharge",
				"custom_base_reference_name": discharge_name,
				"docstatus": ["<", 2],
			},
			pluck="name",
		)

	for so_name in names:
		try:
			so = frappe.get_doc("Sales Order", so_name)
			so.flags.ignore_permissions = True
			if cint(so.docstatus) == 1:
				so.cancel()
			elif cint(so.docstatus) == 0:
				so.delete()
		except Exception:
			frappe.log_error(
				title=f"Failed to cancel discharge charge Sales Order {so_name}",
				message=frappe.get_traceback(),
			)


def _remove_discharge_extra_charge_rows(
	discharge_doc, charge_types: list[str] | tuple[str, ...] | None = None
) -> None:
	"""Drop extra_charges child rows (all, or only the given charge types)."""
	allowed = set(charge_types) if charge_types else None
	for row in list(discharge_doc.get("extra_charges") or []):
		if allowed is None or (row.charge_type or "").strip() in allowed:
			discharge_doc.remove(row)


def _detach_discharge_extra_charge_sales_orders(
	discharge_doc, charge_types: list[str] | tuple[str, ...] | None = None
) -> list[str]:
	"""Clear sales_order links on extra_charges rows before cancelling those orders."""
	allowed = set(charge_types) if charge_types else None
	detached: list[str] = []
	for row in discharge_doc.get("extra_charges") or []:
		if allowed is not None and (row.charge_type or "").strip() not in allowed:
			continue
		so_name = (row.sales_order or "").strip()
		if so_name:
			detached.append(so_name)
			row.sales_order = None
	return detached


def _clear_discharge_charge_fields(discharge_doc) -> None:
	for field, value in {
		"today_charge_sales_order": "",
		"today_charge": 0,
		"medical_supervision_amount": 0,
		"room_charge_today": 0,
		"room_charge_service_unit": "",
		"room_charges": 0,
		"charge_observation_today": 0,
	}.items():
		discharge_doc.set(field, value)
	_remove_discharge_extra_charge_rows(discharge_doc)
	discharge_doc.flags.ignore_permissions = True
	discharge_doc.save()


def _clear_discharge_fields_for_charge_type(discharge_doc, charge_type: str) -> None:
	"""Clear scalar fields and remove the extra-charge row for one charge type."""
	if charge_type == "Room Charges":
		discharge_doc.set("room_charge_today", 0)
		discharge_doc.set("room_charge_service_unit", "")
		discharge_doc.set("room_charges", 0)
		discharge_doc.set("today_charge_sales_order", "")
	elif charge_type == "Medical Supervision":
		discharge_doc.set("today_charge", 0)
		discharge_doc.set("medical_supervision_amount", 0)
	elif charge_type == "Observation":
		discharge_doc.set("charge_observation_today", 0)
		discharge_doc.set("today_charge_obs", 0)
	else:
		frappe.throw(_("Unknown charge type: {0}").format(charge_type))

	_remove_discharge_extra_charge_rows(discharge_doc, [charge_type])
	discharge_doc.flags.ignore_permissions = True
	discharge_doc.save()


@frappe.whitelist()
def delete_discharge_extra_charge(admission_name, charge_type):
	"""Cancel one linked extra-charge Sales Order and clear that charge section on the draft."""
	if not admission_name:
		frappe.throw(_("Admission is required"))

	charge_type = (charge_type or "").strip()
	if charge_type not in ("Room Charges", "Medical Supervision", "Observation"):
		frappe.throw(_("Invalid charge type"))

	_ensure_discharge_admission_access(admission_name)

	draft_name = _get_draft_discharge_name(admission_name)
	if not draft_name:
		frappe.throw(_("No discharge draft found for this admission"))

	discharge_doc = frappe.get_doc("Discharge", draft_name, ignore_permissions=True)
	so_to_cancel = _detach_discharge_extra_charge_sales_orders(discharge_doc, [charge_type])
	if charge_type == "Room Charges":
		so_name = _resolve_discharge_charge_sales_order_link(discharge_doc)
		if so_name:
			so_to_cancel.append(so_name)
			discharge_doc.set("today_charge_sales_order", "")

	if so_to_cancel:
		discharge_doc.flags.ignore_permissions = True
		discharge_doc.flags.ignore_links = True
		discharge_doc.save()
		for so_name in dict.fromkeys(so_to_cancel):
			_cancel_discharge_charge_sales_order(discharge_doc.name, so_name)

	_clear_discharge_fields_for_charge_type(discharge_doc, charge_type)
	frappe.db.commit()

	return {"message": _("{0} deleted").format(charge_type)}


@frappe.whitelist()
def delete_discharge_today_charge(admission_name):
	"""Cancel linked today-charge Sales Order and clear charge fields on the draft discharge."""
	if not admission_name:
		frappe.throw(_("Admission is required"))

	_ensure_discharge_admission_access(admission_name)

	draft_name = _get_draft_discharge_name(admission_name)
	if not draft_name:
		frappe.throw(_("No discharge draft found for this admission"))

	discharge_doc = frappe.get_doc("Discharge", draft_name, ignore_permissions=True)
	so_to_cancel = _detach_discharge_extra_charge_sales_orders(discharge_doc)
	so_name = _resolve_discharge_charge_sales_order_link(discharge_doc)
	if so_name:
		so_to_cancel.append(so_name)
		discharge_doc.set("today_charge_sales_order", "")

	if so_to_cancel:
		discharge_doc.flags.ignore_permissions = True
		discharge_doc.flags.ignore_links = True
		discharge_doc.save()
		for linked_so in dict.fromkeys(so_to_cancel):
			_cancel_discharge_charge_sales_order(discharge_doc.name, linked_so)

	_clear_discharge_charge_fields(discharge_doc)
	frappe.db.commit()

	return {"message": _("Room charges deleted")}


def _cancel_observation_sales_orders(observation_name: str) -> None:
	"""Cancel or delete draft Sales Orders linked to an observation."""
	sos = frappe.get_all(
		"Sales Order",
		filters={
			"custom_base_reference": "Observation",
			"custom_base_reference_name": observation_name,
			"docstatus": ["<", 2],
		},
		pluck="name",
	)
	for so_name in sos:
		try:
			so = frappe.get_doc("Sales Order", so_name)
			so.flags.ignore_permissions = True
			if cint(so.docstatus) == 1:
				so.cancel()
			elif cint(so.docstatus) == 0:
				so.delete()
		except Exception:
			frappe.log_error(
				title=f"Failed to cancel Sales Order {so_name} for observation {observation_name}",
				message=frappe.get_traceback(),
			)


def _clear_discharge_observation_fields(discharge_doc) -> None:
	"""Remove observation setup from a draft discharge."""
	for field, value in {
		"observation_record": "",
		"discharge_to_observation": 0,
		"charge_observation_today": 0,
		"observation_level": "",
		"observation_room": "",
		"observation_practitioner": "",
		"observation_department": "",
		"observation_designated_security_personel": "",
		"observation_amount": 0,
		"observation_duration": "",
		"observation_note": "",
		"today_charge_obs": 0,
	}.items():
		discharge_doc.set(field, value)
	_remove_discharge_extra_charge_rows(discharge_doc, ["Observation"])
	discharge_doc.flags.ignore_permissions = True
	discharge_doc.save()


@frappe.whitelist()
def delete_discharge_observation(admission_name):
	"""Cancel linked observation, clear discharge observation fields, and stay on draft."""
	if not admission_name:
		frappe.throw(_("Admission is required"))

	_ensure_discharge_admission_access(admission_name)

	draft_name = _get_draft_discharge_name(admission_name)
	if not draft_name:
		frappe.throw(_("No discharge draft found for this admission"))

	discharge_doc = frappe.get_doc("Discharge", draft_name, ignore_permissions=True)
	observation_name = _resolve_discharge_observation_link(discharge_doc, admission_name)

	if observation_name:
		obs = frappe.get_doc("Observation", observation_name, ignore_permissions=True)
		room = frappe.utils.cstr(obs.get("room") or "").strip()
		has_dc = bool(obs.get("dc_date"))

		# Detach SO links on discharge/observation before cancelling orders.
		_detach_discharge_extra_charge_sales_orders(discharge_doc, ["Observation"])
		frappe.db.set_value("Observation", observation_name, "order_created", None, update_modified=False)
		discharge_doc.flags.ignore_permissions = True
		discharge_doc.flags.ignore_links = True
		discharge_doc.save()

		_cancel_observation_sales_orders(observation_name)

		obs.flags.ignore_permissions = True
		if cint(obs.docstatus) == 1:
			obs.cancel()
		elif cint(obs.docstatus) == 0:
			obs.delete()

		if room and not has_dc:
			from healthcare.healthcare.doctype.observation.observation import vacate_observation_room

			vacate_observation_room(room)

	_clear_discharge_observation_fields(discharge_doc)
	frappe.db.commit()

	return {"message": _("Observation deleted")}


def _assert_discharge_checklist_ready_for_submit(discharge_doc) -> None:
	"""Full submit requires all checklist items done (finance pending uses a separate action)."""
	from healthcare.healthcare.discharge_checklist_status import summarize_checklist_status

	summary = summarize_checklist_status(discharge_doc.get("discharge_checklist"))
	status = summary.get("checklist_status")
	if status == "incomplete":
		remaining = cint(summary.get("checklist_incomplete"))
		frappe.throw(
			_(
				"Please complete all discharge checklist items. {0} item(s) remaining."
			).format(remaining)
		)
	if status == "finance_pending":
		frappe.throw(
			_(
				"Only finance checklist items remain. Use Discharge Without Finance, "
				"or complete finance and then Discharge Patient."
			)
		)


def _assert_discharge_checklist_finance_pending_only(discharge_doc) -> None:
	from healthcare.healthcare.discharge_checklist_status import summarize_checklist_status

	summary = summarize_checklist_status(discharge_doc.get("discharge_checklist"))
	if summary.get("checklist_status") != "finance_pending":
		frappe.throw(
			_(
				"Discharge Without Finance is only allowed when the only remaining "
				"checklist items are finance/accounts."
			)
		)


def _mark_admission_discharged_keeping_draft(admission_name: str, discharge_doc) -> None:
	"""Set admission (and patient) to Discharged without submitting the Discharge draft.

	Skips unbilled-services validation so finance can finish billing later.
	"""
	from frappe.utils import now_datetime
	from healthcare.healthcare.doctype.inpatient_admission.inpatient_admission import (
		check_out_inpatient,
		validate_incompleted_service_requests,
	)
	from healthcare.healthcare.utils import validate_nursing_tasks

	admission = frappe.get_doc("Inpatient Admission", admission_name)
	if (admission.status or "").strip() == "Discharged":
		return

	validate_nursing_tasks(admission)
	validate_incompleted_service_requests(admission)

	check_out_inpatient(admission)
	admission.discharge_datetime = discharge_doc.get("discharge_date") or now_datetime()
	admission.status = "Discharged"
	admission.save(ignore_permissions=True)

	if admission.patient:
		frappe.db.set_value("Patient", admission.patient, "inpatient_status", "Discharged")

	if admission.get("discharge_encounter"):
		frappe.db.set_value(
			"Patient Visit",
			admission.discharge_encounter,
			"inpatient_status",
			"Discharged",
		)

	from healthcare.healthcare.doctype.patient_follow_up.patient_follow_up import (
		create_patient_follow_up_from_discharge,
	)

	create_patient_follow_up_from_discharge(admission_name, discharge_doc=discharge_doc)


def _prepare_discharge_doc_for_action(admission_name, discharge_data):
	"""Save draft discharge payload and run observation / charge / medicine prep."""
	from healthcare.healthcare.discharge_checklist_permissions import is_first_checklist_item_complete

	discharge_data = frappe.parse_json(discharge_data or {})
	discharge_doc = _get_or_create_draft_discharge(admission_name)
	_apply_discharge_payload(discharge_doc, discharge_data)
	discharge_doc.flags.ignore_links = True
	discharge_doc.save(ignore_permissions=True)
	discharge_doc.reload()

	observation_result = _create_observation_from_discharge_if_needed(discharge_doc, admission_name)
	discharge_doc.reload()

	charge_result = _create_discharge_today_charge_sales_order_if_needed(discharge_doc, admission_name)
	discharge_doc.reload()

	first_item_complete = is_first_checklist_item_complete(discharge_doc.get("discharge_checklist"))
	medicine_result = _bill_pending_given_medicine_on_discharge_start(
		admission_name,
		first_item_is_complete=first_item_complete,
		force=True,
	)
	package_result = _bill_pending_package_on_discharge_start(
		admission_name,
		discharge_doc,
		first_item_is_complete=first_item_complete,
		force=True,
	)

	return discharge_doc, observation_result, charge_result, medicine_result, package_result


@frappe.whitelist()
def create_and_submit_discharge(admission_name, discharge_data):
	"""Create or update draft Discharge, then submit."""
	try:
		if not admission_name:
			frappe.throw(_("Admission is required"))

		frappe.logger().info(f"Creating discharge for admission {admission_name}")

		(
			discharge_doc,
			observation_result,
			_charge_result,
			medicine_result,
			package_result,
		) = _prepare_discharge_doc_for_action(admission_name, discharge_data)

		_assert_discharge_checklist_ready_for_submit(discharge_doc)

		if cint(discharge_doc.docstatus) == 0:
			discharge_doc.flags.ignore_permissions = True
			discharge_doc.submit()

		response = {
			"name": discharge_doc.name,
			"message": _("Discharge created and submitted successfully"),
		}
		if observation_result:
			response["observation"] = observation_result.get("name")
			response["observation_trans_no"] = observation_result.get("trans_no")
			if observation_result.get("sales_order"):
				response["sales_order"] = observation_result.get("sales_order")
				response["message"] = _(
					"Discharge submitted. Observation {0} and Sales Order {1} created."
				).format(observation_result.get("name"), observation_result.get("sales_order"))

		_apply_medicine_billing_to_discharge_response(response, medicine_result)
		_apply_package_billing_to_discharge_response(response, package_result)

		return response

	except Exception as e:
		import traceback

		error_message = str(e)
		frappe.log_error(traceback.format_exc(), "Create Discharge Error")

		clean_message = re.sub(r"<[^>]+>", "", error_message)
		clean_message = re.sub(r"\s+", " ", clean_message).strip()

		frappe.throw(_("Failed to create discharge: {0}").format(clean_message))


@frappe.whitelist()
def discharge_without_finance(admission_name, discharge_data):
	"""Mark admission Discharged while leaving the Discharge document as draft.

	Allowed only when incomplete checklist rows are finance/accounts items.
	Finance can complete billing later and submit the Discharge.
	"""
	try:
		if not admission_name:
			frappe.throw(_("Admission is required"))

		(
			discharge_doc,
			observation_result,
			_charge_result,
			medicine_result,
			package_result,
		) = _prepare_discharge_doc_for_action(admission_name, discharge_data)

		_assert_discharge_checklist_finance_pending_only(discharge_doc)
		_mark_admission_discharged_keeping_draft(admission_name, discharge_doc)

		frappe.db.commit()

		response = {
			"name": discharge_doc.name,
			"admission_status": "Discharged",
			"discharge_submitted": 0,
			"message": _(
				"Patient discharged without finance. Admission is Discharged; "
				"complete finance checklist and submit the Discharge when ready."
			),
		}
		if observation_result:
			response["observation"] = observation_result.get("name")
			response["observation_trans_no"] = observation_result.get("trans_no")
			if observation_result.get("sales_order"):
				response["sales_order"] = observation_result.get("sales_order")

		_apply_medicine_billing_to_discharge_response(response, medicine_result)
		_apply_package_billing_to_discharge_response(response, package_result)

		return response

	except Exception as e:
		import traceback

		error_message = str(e)
		frappe.log_error(traceback.format_exc(), "Discharge Without Finance Error")

		clean_message = re.sub(r"<[^>]+>", "", error_message)
		clean_message = re.sub(r"\s+", " ", clean_message).strip()

		frappe.throw(_("Failed to discharge without finance: {0}").format(clean_message))

def _combine_admission_and_case_management():
	return cint(
		frappe.db.get_single_value("Healthcare Settings", "combine_admission_fee_and_case_management")
	)


def _mandatory_admission_assessment_fee():
	return cint(
		frappe.db.get_single_value("Healthcare Settings", "mendatory_admission_assessment_fee")
	)


def _get_case_management_ip_rate(template_name):
	from healthcare.healthcare.doctype.healthcare_service_template.healthcare_service_template import (
		get_healthcare_service_template_rate,
	)

	return flt(
		get_healthcare_service_template_rate(
			template_name=template_name,
			patient_care_type="IP",
		)
	)


def _validate_case_management_template(template_name):
	if not template_name:
		frappe.throw(_("Case Management template is required"))
	if not frappe.db.exists("Healthcare Service Template", template_name):
		frappe.throw(_("Healthcare Service Template {0} not found").format(template_name))
	is_cm = cint(
		frappe.db.get_value("Healthcare Service Template", template_name, "is_case_management")
	)
	if not is_cm:
		frappe.throw(
			_("Healthcare Service Template {0} is not marked as Case Management").format(template_name)
		)
	disabled = cint(frappe.db.get_value("Healthcare Service Template", template_name, "disabled"))
	if disabled:
		frappe.throw(_("Healthcare Service Template {0} is disabled").format(template_name))


def _parse_case_management_services(case_management_services=None, template=None, amount=None):
	"""Normalize case management into a list of {template, amount}.

	Accepts a JSON list (or list of dicts/strings) and/or a legacy single template.
	"""
	services = []
	raw = case_management_services
	if isinstance(raw, str):
		raw = raw.strip()
		if raw:
			try:
				raw = frappe.parse_json(raw)
			except Exception:
				raw = [raw]
		else:
			raw = None

	if isinstance(raw, list):
		for entry in raw:
			if isinstance(entry, dict):
				tpl = (entry.get("template") or entry.get("name") or entry.get("case_management_template") or "").strip()
				amt = entry.get("amount")
				if entry.get("rate") is not None and amt is None:
					amt = entry.get("rate")
			else:
				tpl = cstr(entry).strip()
				amt = None
			if not tpl:
				continue
			services.append({"template": tpl, "amount": amt})

	legacy = (template or "").strip()
	if legacy and not any(s["template"] == legacy for s in services):
		services.append({"template": legacy, "amount": amount})

	# Deduplicate by template (keep first)
	seen = set()
	out = []
	for row in services:
		tpl = row["template"]
		if tpl in seen:
			continue
		seen.add(tpl)
		_validate_case_management_template(tpl)
		resolved_amount = (
			flt(row["amount"])
			if row.get("amount") is not None
			else _get_case_management_ip_rate(tpl)
		)
		out.append({"template": tpl, "amount": resolved_amount})
	return out


def _append_case_management_quotation_line(quotation, template_name, amount, package=None, admission=None):
	"""Add one IP Case Management line to a quotation."""
	_validate_case_management_template(template_name)
	line_amount = flt(amount) if amount is not None else _get_case_management_ip_rate(template_name)
	if line_amount <= 0:
		frappe.throw(_("Case Management amount must be greater than 0 for {0}").format(template_name))

	tpl = frappe.db.get_value(
		"Healthcare Service Template",
		template_name,
		["service_name", "item_code"],
		as_dict=True,
	) or {}
	cm_item_code = (tpl.get("item_code") or "").strip() or template_name
	cm_item_name = tpl.get("service_name") or template_name

	if not frappe.db.exists("Item", cm_item_code):
		item_group = (
			frappe.db.get_value("Item Group", {"name": "Services"})
			or frappe.db.get_value("Item Group", {"name": "All Item Groups"})
			or frappe.db.get_value("Item Group", {}, "name")
		)
		uom = (
			frappe.db.exists("UOM", "Unit")
			or frappe.db.get_single_value("Stock Settings", "stock_uom")
			or "Unit"
		)
		frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": cm_item_code,
				"item_name": cm_item_name,
				"item_group": item_group or "All Item Groups",
				"description": f"Case Management: {cm_item_name}",
				"is_sales_item": 1,
				"is_service_item": 1,
				"is_purchase_item": 0,
				"is_stock_item": 0,
				"stock_uom": uom,
				"disabled": 0,
			}
		).insert(ignore_permissions=True, ignore_mandatory=True)

	cm_row = quotation.append("items", {})
	cm_row.item_code = cm_item_code
	cm_row.item_name = cm_item_name
	cm_row.description = f"IP Case Management: {cm_item_name}"
	cm_row.qty = 1
	cm_row.rate = line_amount
	cm_row.amount = line_amount
	if package and getattr(package, "cost_center", None):
		cm_row.cost_center = package.cost_center
	elif admission and admission.get("cost_center"):
		cm_row.cost_center = admission.cost_center
	return line_amount


def _create_case_management_service_request(admission, template_name, amount=None):
	"""Create Service Request for IP Case Management; optionally bill via Sales Order."""
	from healthcare.api.service_request import confirm_session_payment, create_service_request

	_validate_case_management_template(template_name)
	rate = flt(amount) if amount is not None else _get_case_management_ip_rate(template_name)

	practitioner = (
		admission.get("primary_practitioner")
		or admission.get("admission_by_doctor")
		or admission.get("admission_practitioner")
	)
	if not practitioner:
		frappe.throw(
			_("Set a Primary Practitioner (or Admission Doctor) on the admission before Case Management.")
		)

	cost_center = admission.get("cost_center")
	if not cost_center:
		frappe.throw(_("Set a Cost Center on the admission before Case Management."))

	sr = create_service_request(
		{
			"patient": admission.patient,
			"inpatient_record": admission.name,
			"template_dt": "Healthcare Service Template",
			"template_dn": template_name,
			"practitioner": practitioner,
			"cost_center": cost_center,
			"cost": rate,
			"grand_total": rate,
			"override_rate": 1,
			"status": "draft-Request Status",
		}
	)

	# Ensure edited assessment fee survives any template/insurance pricing on insert.
	sr_name = (sr or {}).get("name")
	if sr_name:
		frappe.db.set_value(
			"Service Request",
			sr_name,
			{
				"cost": rate,
				"grand_total": rate,
				"discount_amount": 0,
			},
			update_modified=False,
		)

	sales_order = None
	# Separate billing: SR → Sales Order immediately. Combined billing goes on quotation.
	if not _combine_admission_and_case_management():
		result = confirm_session_payment(sr.get("name"))
		sales_order = (result or {}).get("sales_order")

	return {
		"service_request": sr.get("name"),
		"sales_order": sales_order,
		"amount": rate,
		"template": template_name,
	}


@frappe.whitelist()
def get_case_management_templates(search=None, limit=50):
	"""Healthcare Service Templates marked as Case Management (IP rate)."""
	filters = {"disabled": 0, "is_case_management": 1}
	or_filters = None
	if search:
		term = f"%{search}%"
		or_filters = [
			["service_name", "like", term],
			["item_code", "like", term],
			["name", "like", term],
		]
		filters = {"disabled": 0, "is_case_management": 1}

	rows = frappe.get_all(
		"Healthcare Service Template",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "service_name", "item_code", "rate", "op_rate"],
		limit=cint(limit) or 50,
		order_by="item_code, service_name",
	)
	for row in rows:
		row["rate"] = _get_case_management_ip_rate(row.name)
	return rows


def _get_medical_supervision_ip_rate(template_name):
	from healthcare.healthcare.doctype.healthcare_service_template.healthcare_service_template import (
		get_healthcare_service_template_rate,
	)

	return flt(
		get_healthcare_service_template_rate(
			template_name=template_name,
			patient_care_type="IP",
		)
	)


def _validate_medical_supervision_template(template_name):
	if not template_name:
		frappe.throw(_("Medical Supervision service is required"))
	if not frappe.db.exists("Healthcare Service Template", template_name):
		frappe.throw(_("Healthcare Service Template {0} not found").format(template_name))
	is_ms = cint(
		frappe.db.get_value("Healthcare Service Template", template_name, "is_medical_supervision")
	)
	if not is_ms:
		frappe.throw(
			_("Healthcare Service Template {0} is not marked as Medical Supervision").format(
				template_name
			)
		)
	disabled = cint(frappe.db.get_value("Healthcare Service Template", template_name, "disabled"))
	if disabled:
		frappe.throw(_("Healthcare Service Template {0} is disabled").format(template_name))


def _create_medical_supervision_service_request(
	admission,
	template_name,
	amount=None,
	*,
	continuous=True,
	billing_date=None,
	bill=True,
):
	"""Create Service Request for Medical Supervision; optionally bill via Sales Order.

	When continuous=True, sets is_continous_medical_supervision so the daily job keeps
	charging until stop. Use continuous=False for one-off daily charge rows.
	"""
	from healthcare.api.service_request import create_service_request

	_validate_medical_supervision_template(template_name)
	rate = flt(amount) if amount is not None else _get_medical_supervision_ip_rate(template_name)
	billing_date = getdate(billing_date or today())

	practitioner = (
		admission.get("primary_practitioner")
		or admission.get("admission_by_doctor")
		or admission.get("admission_practitioner")
	)
	if not practitioner:
		frappe.throw(
			_("Set a Primary Practitioner (or Admission Doctor) on the admission before Medical Supervision.")
		)

	cost_center = admission.get("cost_center")
	if not cost_center:
		frappe.throw(_("Set a Cost Center on the admission before Medical Supervision."))

	sr = create_service_request(
		{
			"patient": admission.patient,
			"inpatient_record": admission.name,
			"template_dt": "Healthcare Service Template",
			"template_dn": template_name,
			"practitioner": practitioner,
			"cost_center": cost_center,
			"cost": rate,
			"grand_total": rate,
			"override_rate": 1,
			"expected_date": str(billing_date),
			"status": "draft-Request Status",
		}
	)

	sr_name = (sr or {}).get("name")
	if sr_name:
		values = {
			"cost": rate,
			"grand_total": rate,
			"discount_amount": 0,
			"expected_date": str(billing_date),
		}
		if frappe.get_meta("Service Request").has_field("is_continous_medical_supervision"):
			values["is_continous_medical_supervision"] = 1 if continuous else 0
		frappe.db.set_value("Service Request", sr_name, values, update_modified=False)

	sales_order = None
	if bill and sr_name:
		from healthcare.api.medical_supervision import bill_medical_supervision_service_request

		sales_order = bill_medical_supervision_service_request(sr_name, billing_date=billing_date)

	return {
		"service_request": sr_name,
		"sales_order": sales_order,
		"amount": rate,
		"template": template_name,
		"continuous": 1 if continuous else 0,
		"billing_date": str(billing_date),
	}


@frappe.whitelist()
def get_medical_supervision_templates(search=None, limit=50):
	"""Healthcare Service Templates marked Is Medical Supervision (IP rate)."""
	filters = {"disabled": 0, "is_medical_supervision": 1}
	or_filters = None
	if search:
		term = f"%{search}%"
		or_filters = [
			["service_name", "like", term],
			["item_code", "like", term],
			["name", "like", term],
		]

	rows = frappe.get_all(
		"Healthcare Service Template",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"name",
			"service_name",
			"item_code",
			"rate",
			"op_rate",
			"default_medical_supervision",
		],
		limit=cint(limit) or 50,
		order_by="default_medical_supervision desc, item_code, service_name",
	)
	for row in rows:
		row["rate"] = _get_medical_supervision_ip_rate(row.name)
		row["default_medical_supervision"] = cint(row.get("default_medical_supervision"))
	return rows


@frappe.whitelist()
def get_admission_billing_settings():
	"""Settings that affect admission quotation / case management billing."""
	return {
		"combine_admission_fee_and_case_management": _combine_admission_and_case_management(),
		"mendatory_admission_assessment_fee": _mandatory_admission_assessment_fee(),
	}


@frappe.whitelist()
def admit_patient(
	name,
	service_unit=None,
	check_in=None,
	expected_discharge=None,
	patient_ip_category=None,
	patient_documents=None,
	patient_relatives=None,
	service_units=None,
	hospital_bed=None,
	bed_no=None,
	inpatient_package=None,
	rate_per_day=None,
	standard_package=None,
	ip_case_management=None,
	ip_case_management_fee=None,
	case_management_template=None,
	case_management_fee=None,
	case_management_services=None,
	service_unit_type=None,
	is_med_supr_required=None,
	med_supr_service_code=None,
	medical_supervision_fee=None,
):
	"""Admit a patient - wrapper for the DocType method"""
	if not name:
		frappe.throw(_("Inpatient Admission name is required"))
	if not check_in:
		frappe.throw(_("Check In datetime is required"))

	service_unit_type = (service_unit_type or "").strip() or None
	if not service_unit_type:
		frappe.throw(_("Room Type is required"))

	record = frappe.get_doc("Inpatient Admission", name)

	if record.meta.has_field("admission_service_unit_type"):
		record.admission_service_unit_type = service_unit_type

	if patient_ip_category:
		record.patient_ip_category = patient_ip_category
	elif record.patient:
		patient_category = frappe.db.get_value("Patient", record.patient, "category")
		if patient_category:
			record.patient_ip_category = patient_category

	# Set package fields if provided
	if inpatient_package and inpatient_package != '__custom__':
		record.inpatient_package = inpatient_package
	if rate_per_day is not None:
		record.rate_per_day = flt(rate_per_day)
	if standard_package is not None:
		record.standard_package = cint(standard_package)

	want_case_mgmt = cint(ip_case_management) if ip_case_management is not None else cint(
		record.get("ip_case_management")
	)
	if _mandatory_admission_assessment_fee() and not want_case_mgmt:
		frappe.throw(_("Admission Assessment Fee is mandatory. Please select Yes."))
	cm_services = []
	cm_amount = None
	case_management_template = (case_management_template or "").strip() or None
	if want_case_mgmt:
		cm_services = _parse_case_management_services(
			case_management_services,
			template=case_management_template,
			amount=case_management_fee,
		)
		if not cm_services:
			frappe.throw(_("Select at least one Admission Assessment Fee service"))
		case_management_template = cm_services[0]["template"]
		cm_amount = sum(flt(s["amount"]) for s in cm_services)

	if ip_case_management is not None and record.meta.has_field("ip_case_management"):
		record.ip_case_management = want_case_mgmt
	if record.meta.has_field("ip_case_management_fee"):
		# Fee applies whenever Case Management is selected with a priced template
		record.ip_case_management_fee = (
			cint(ip_case_management_fee)
			if ip_case_management_fee is not None
			else (1 if want_case_mgmt and cm_amount else 0)
		)
	if want_case_mgmt and record.meta.has_field("case_management_template"):
		record.case_management_template = case_management_template
	if want_case_mgmt and cm_amount is not None and record.meta.has_field("case_management_fee"):
		record.case_management_fee = cm_amount
	elif not want_case_mgmt:
		if record.meta.has_field("case_management_template"):
			record.case_management_template = None
		if record.meta.has_field("case_management_fee"):
			record.case_management_fee = 0

	want_med_supr = (
		cint(is_med_supr_required)
		if is_med_supr_required is not None
		else cint(record.get("is_med_supr_required"))
	)
	med_supr_template = (med_supr_service_code or "").strip() or None
	med_supr_amount = None
	if want_med_supr:
		if not med_supr_template:
			frappe.throw(_("Select a Medical Supervision service"))
		_validate_medical_supervision_template(med_supr_template)
		med_supr_amount = (
			flt(medical_supervision_fee)
			if medical_supervision_fee is not None
			else _get_medical_supervision_ip_rate(med_supr_template)
		)
	if record.meta.has_field("is_med_supr_required"):
		record.is_med_supr_required = want_med_supr
	if record.meta.has_field("med_supr_service_code"):
		record.med_supr_service_code = med_supr_template if want_med_supr else None

	# Table MultiSelect: apply before admit so occupancy rows are built correctly
	service_unit_list = frappe.parse_json(service_units or [])
	if isinstance(service_unit_list, list) and service_unit_list:
		record.set("service_unit", [])
		for su_name in service_unit_list:
			if su_name:
				record.append("service_unit", {"service_unit": su_name})

	selected_bed = bed_no or hospital_bed
	if selected_bed:
		record.bed_no = selected_bed

	# Perform admit (sets status, occupancy, bed no, service units)
	record.admit(
		service_unit,
		check_in,
		expected_discharge,
		hospital_bed=selected_bed,
	)

	admitted_service_units = []
	if service_unit:
		admitted_service_units.append(service_unit)
	if isinstance(service_unit_list, list):
		admitted_service_units.extend([u for u in service_unit_list if u])
	for row in record.get("service_unit") or []:
		su_name = getattr(row, "service_unit", None) or (row.get("service_unit") if isinstance(row, dict) else None)
		if su_name:
			admitted_service_units.append(su_name)
	vacate_active_observation_rooms_for_patient(
		record.patient,
		exclude_service_units=admitted_service_units,
		dc_date=check_in,
	)

	# Save patient documents if provided (stored as e-signatures)
	documents = frappe.parse_json(patient_documents or [])
	if isinstance(documents, list) and documents:
		record.set("e_signatures", [])
		for idx, row in enumerate(documents, start=1):
			if not isinstance(row, dict):
				continue
			file_name = (row.get("file_name") or "").strip()
			document_type = (row.get("document_type") or "").strip()
			signee_name = (row.get("signee_name") or "").strip()
			record.append(
				"e_signatures",
				{
					"idx": idx,
					"file_name": file_name or document_type or signee_name or None,
					"document_type": document_type or None,
					"transaction_no": (row.get("transaction_no") or "").strip() or None,
					"upload_remarks": (row.get("upload_remarks") or "").strip() or None,
					"document": (row.get("document") or "").strip() or None,
					"patient_relation": (row.get("patient_relation") or "").strip() or None,
					"signee_name": signee_name or None,
				},
			)

	# Save patient relatives (guardians) if provided.
	# IP Patient Relative child table uses: relationship_with_patient (required), relative_name, cpr__id_no, any_remarks
	relatives = frappe.parse_json(patient_relatives or [])
	if isinstance(relatives, list) and relatives:
		record.set("patient_relatives", [])
		for row in relatives:
			if not isinstance(row, dict):
				continue
			# Map frontend keys to child doctype field names
			relation = (row.get("relationship_with_patient") or row.get("relative_relation") or "").strip()
			name_val = (row.get("relative_name") or "").strip()
			id_no = (row.get("cpr__id_no") or row.get("relative_id_num") or "").strip()
			relative_phone_no = (row.get("relative_phone_no") or "").strip()
	
			relative_alternative_phone_no = (row.get("relative_alternative_phone_no") or "").strip()
			relative_alternative_phone_no_2 = (row.get("relative_alternative_phone_no_2") or "").strip()
			remarks = (row.get("any_remarks") or "").strip()
			# Skip empty rows; child doctype requires relationship_with_patient
			if not relation:
				continue
			child = record.append("patient_relatives", {})
			child.relationship_with_patient = relation
			if name_val:
				child.relative_name = name_val
			if id_no:
				child.cpr__id_no = id_no
			if remarks:
				child.any_remarks = remarks
			if relative_phone_no:
				child.relative_phone_no = relative_phone_no
			if relative_alternative_phone_no:
				child.relative_alternative_phone_no = relative_alternative_phone_no
			if relative_alternative_phone_no_2:
				child.relative_alternative_phone_no_2 = relative_alternative_phone_no_2

	record.save(ignore_permissions=True)

	# Re-assert bed occupancy after post-admit saves (documents / relatives).
	if getattr(record, "bed_no", None):
		from healthcare.healthcare.doctype.inpatient_admission.inpatient_admission import (
			occupy_hospital_bed,
		)

		occupy_hospital_bed(record.bed_no)

	case_mgmt_billings = []
	if want_case_mgmt and cm_services:
		# Reload so SR sees saved case-management fields / cost center
		record.reload()
		for cm in cm_services:
			case_mgmt_billings.append(
				_create_case_management_service_request(
					record,
					cm["template"],
					amount=cm["amount"],
				)
			)

	med_supr_billing = None
	if want_med_supr and med_supr_template:
		record.reload()
		med_supr_billing = _create_medical_supervision_service_request(
			record,
			med_supr_template,
			amount=med_supr_amount,
		)

	frappe.db.commit()

	result = {
		"success": True,
		"message": _("Patient admitted successfully"),
		"name": record.name,
		"combine_admission_fee_and_case_management": _combine_admission_and_case_management(),
	}
	if case_mgmt_billings:
		result["case_management_services"] = case_mgmt_billings
		result["case_management_service_request"] = case_mgmt_billings[0].get("service_request")
		result["case_management_sales_order"] = case_mgmt_billings[0].get("sales_order")
		result["case_management_amount"] = sum(flt(b.get("amount")) for b in case_mgmt_billings)
	if med_supr_billing:
		result["medical_supervision"] = med_supr_billing
		result["medical_supervision_service_request"] = med_supr_billing.get("service_request")
		result["medical_supervision_sales_order"] = med_supr_billing.get("sales_order")
		result["medical_supervision_amount"] = med_supr_billing.get("amount")
	return result



def _inpatient_package_daily_rate(package) -> float:
	"""Daily rate from Inpatient Package only (no room multiplier).

	Uses package_rate when set; otherwise base_total / no_of_days for fixed programs.
	"""
	rate = flt(getattr(package, "package_rate", 0) or 0)
	if rate > 0:
		return rate
	base_total = flt(getattr(package, "base_total", 0) or 0)
	program_days = cint(getattr(package, "no_of_days", 0) or 0)
	if base_total > 0 and program_days > 0:
		return base_total / program_days
	return 0.0


@frappe.whitelist()
def create_admission_quotation(
	admission_name,
	package_name,
	days,
	total_amount,
	service_unit=None,
	case_management_template=None,
	case_management_amount=None,
	case_management_services=None,
):
	"""Create a Draft Quotation for admission with package.

	Package line uses qty = days and rate = Inpatient Package daily rate
	(package_rate / base_total÷days). Service Unit Type only selects the Item —
	room multipliers are not applied to the quotation rate.

	When Healthcare Settings ``combine_admission_fee_and_case_management`` is enabled
	and case management service(s) are provided, each is added as a quotation line.
	When disabled, case management is ignored here (billed via Service Request on admit).
	"""
	
	if not admission_name:
		frappe.throw(_("Inpatient Admission name is required"))
	if not package_name:
		frappe.throw(_("Package name is required"))
	if not days or days <= 0:
		frappe.throw(_("Number of days must be greater than 0"))
	if not total_amount or total_amount <= 0:
		frappe.throw(_("Total amount must be greater than 0"))

	service_unit = _resolve_quotation_service_unit(admission_name, explicit_service_unit=service_unit)
	# Service unit is preferred to resolve the type, but type+Item on admission is enough.
	if not service_unit:
		adm_type = frappe.db.get_value(
			"Inpatient Admission", admission_name, "admission_service_unit_type"
		)
		if not adm_type or not _item_code_from_healthcare_service_unit_type(adm_type):
			frappe.throw(
				_(
					"Could not determine a service unit / room type for the quotation. "
					"Select a service unit or a hospital bed, or set Admission Service Unit Type "
					"with an Item on that Healthcare Service Unit Type."
				)
			)

	# Get admission record
	admission = frappe.get_doc('Inpatient Admission', admission_name)
	patient = admission.patient
	company = admission.company or frappe.defaults.get_user_default("Company")
	
	if not company:
		frappe.throw(_("Company is required. Please set company in admission or user defaults."))
	
	# Get patient customer (Customer doc name / ID — not patient_name)
	customer = frappe.db.get_value('Patient', patient, 'customer')
	if not customer:
		frappe.throw(_("Patient {0} does not have a linked customer").format(patient))
	if not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer {0} linked on Patient {1} was not found").format(customer, patient))
	
	# Get package details
	is_custom = package_name == '__custom__'
	package = None if is_custom else frappe.get_doc('Inpatient Package', package_name)

	# Bill the Service Unit Type Item (not the room / service unit itself)
	item_info = _resolve_package_quotation_item(admission, service_unit)
	item_code = item_info["item_code"]
	item_name = item_info["item_name"]
	room_label = item_info["room_label"]
	type_label = item_info["type_label"]

	# ✅ Create Quotation instead of Sales Order
	quotation = frappe.new_doc("Quotation")
	quotation.quotation_to = "Customer"
	quotation.party_name = customer
	quotation.patient = patient
	quotation.company = company
	quotation.transaction_date = getdate()
	quotation.valid_till = getdate()
	quotation.custom_package = package_name if not is_custom else None
	quotation.custom_inpatient_admission= admission_name
	quotation.custom_reference_type = "Inpatient Admission"
	quotation.custom_reference_name = admission_name
	
	# Package line: qty = days, rate = package daily rate (not room-multiplied)
	days_qty = cint(days)
	if is_custom:
		daily_rate = flt(total_amount) / days_qty if days_qty else flt(total_amount)
	else:
		daily_rate = _inpatient_package_daily_rate(package)
		if daily_rate <= 0:
			# Fallback only if package has no rate configured
			daily_rate = flt(total_amount) / days_qty if days_qty else flt(total_amount)
		# Optional UI discount: if a lower total was passed, scale the package rate
		package_total = flt(daily_rate) * days_qty
		passed_total = flt(total_amount or 0)
		if (
			package_total > 0
			and passed_total > 0
			and passed_total + 0.0005 < package_total
			and passed_total <= package_total
		):
			# Treat as discount on package amount (ignore room-inflated totals above package)
			daily_rate = passed_total / days_qty

	if daily_rate <= 0:
		frappe.throw(_("Package daily rate must be greater than zero."))

	item_row = quotation.append("items", {})
	item_row.item_code = item_code
	item_row.item_name = item_name
	package_label = "Custom Package" if is_custom else package.package_name
	item_row.description = (
		f"Inpatient Package: {package_label} - "
		f"Room type: {type_label}"
		+ (f" ({room_label})" if room_label and room_label != type_label else "")
		+ f" ({days_qty} days @ {daily_rate}/day)"
	)
	item_row.qty = days_qty
	item_row.rate = daily_rate
	item_row.amount = flt(daily_rate) * days_qty
	
	if not is_custom and package.cost_center:
		item_row.cost_center = package.cost_center

	# Optional Case Management line(s) on the same quotation
	cm_total = 0
	cm_services = []
	if _combine_admission_and_case_management():
		cm_services = _parse_case_management_services(
			case_management_services,
			template=case_management_template,
			amount=case_management_amount,
		)
		for cm in cm_services:
			cm_total += _append_case_management_quotation_line(
				quotation,
				cm["template"],
				cm["amount"],
				package=package if not is_custom else None,
				admission=admission,
			)
	
	# Link to admission if field exists
	if hasattr(quotation, 'inpatient_admission'):
		quotation.inpatient_admission = admission_name
	
	# Set missing values
	quotation.set_missing_values(for_validate=True)
	
	# ✅ Save only (Draft)
	quotation.flags.ignore_mandatory = True
	quotation.calculate_taxes_and_totals()
	# from healthcare.controllers.discount_validation import apply_insurance_discounts
	# apply_insurance_discounts(quotation)
	quotation.save(ignore_permissions=True)
	
	
	return {
		'success': True,
		'quotation_name': quotation.name,
		'combine_admission_fee_and_case_management': _combine_admission_and_case_management(),
		'case_management_included': bool(cm_total),
		'case_management_count': len(cm_services),
		'message': _('Quotation {0} created successfully (Draft)').format(quotation.name)
	}


@frappe.whitelist()
def check_admission_quotation(admission_name, package_name):
	"""Check if a quotation already exists for this admission and package"""
	
	if not admission_name or not package_name:
		return {'exists': False}
	
	# Check for existing quotation
	existing = frappe.db.get_value(
		'Quotation',
		{
			'custom_inpatient_admission': admission_name,
			'custom_package': package_name,
			'docstatus': ['<', 2]  # Not cancelled
		},
		['name'],
		as_dict=True
	)
	
	if existing:
		return {
			'exists': True,
			'quotation_name': existing.name
		}
	
	return {'exists': False}


@frappe.whitelist()
def create_invoice_from_inpatient_admission(inpatient_admission_name: str):
	"""
	Create an invoice for an Inpatient Admission by combining all associated Sales Orders.
	
	Args:
		inpatient_admission_name: Name of the Inpatient Admission
	
	Returns:
		dict: Dictionary containing invoice name and status
	"""
	return create_invoice("Inpatient Admission", inpatient_admission_name)


def _apply_patient_relatives(doc, relatives_data):
	relatives = frappe.parse_json(relatives_data) if isinstance(relatives_data, str) else relatives_data
	if not isinstance(relatives, list):
		return

	doc.set("patient_relatives", [])
	for row in relatives:
		if not isinstance(row, dict):
			continue
		relation = (row.get("relationship_with_patient") or row.get("relative_relation") or "").strip()
		if not relation:
			continue
		child = doc.append("patient_relatives", {})
		child.relationship_with_patient = relation
		name_val = (row.get("relative_name") or "").strip()
		if name_val:
			child.relative_name = name_val
		id_no = (row.get("cpr__id_no") or row.get("relative_id_num") or "").strip()
		if id_no:
			child.cpr__id_no = id_no
			child.relative_id_no = id_no
		phone = (row.get("relative_phone_no") or "").strip()
		if phone:
			child.relative_phone_no = phone
		alt_phone = (row.get("relative_alternative_phone_no") or "").strip()
		if alt_phone:
			child.relative_alternative_phone_no = alt_phone
		alt_phone_2 = (row.get("relative_alternative_phone_no_2") or "").strip()
		if alt_phone_2:
			child.relative_alternative_phone_no_2 = alt_phone_2
		email = (row.get("relation_email") or "").strip()
		if email:
			child.relation_email = email
		remarks = (row.get("any_remarks") or "").strip()
		if remarks:
			child.any_remarks = remarks
		child.entered_by = row.get("entered_by") or frappe.session.user
		child.entered_date = row.get("entered_date") or frappe.utils.today()


def _apply_patient_visitors(doc, visitors_data):
	visitors = frappe.parse_json(visitors_data) if isinstance(visitors_data, str) else visitors_data
	if not isinstance(visitors, list):
		return

	doc.set("patient_visitors", [])
	for row in visitors:
		if not isinstance(row, dict):
			continue
		visitor_name = (row.get("visitors_name") or "").strip()
		relationship = (row.get("relationship_with_patient") or "").strip()
		if not visitor_name or not relationship:
			continue
		child = doc.append("patient_visitors", {})
		child.visitors_name = visitor_name
		child.relationship_with_patient = relationship
		id_no = (row.get("cpr__id_no") or "").strip()
		if id_no:
			child.cpr__id_no = id_no
		remarks = (row.get("any_remarks") or "").strip()
		if remarks:
			child.any_remarks = remarks
		child.entered_by = row.get("entered_by") or frappe.session.user
		child.entered_date = row.get("entered_date") or frappe.utils.today()


def _apply_e_signatures(doc, documents_data):
	documents = frappe.parse_json(documents_data) if isinstance(documents_data, str) else documents_data
	if not isinstance(documents, list):
		return
	doc.set("e_signatures", [])
	for idx, row in enumerate(documents, start=1):
		if not isinstance(row, dict):
			continue
		file_name = (row.get("file_name") or row.get("document_type") or "").strip()
		document_type = (row.get("document_type") or "").strip()
		document_url = (row.get("document") or "").strip()
		if document_url:
			from healthcare.api.common import ensure_file_url_public
			document_url = ensure_file_url_public(document_url)
		signee_name = (row.get("signee_name") or "").strip()
		patient_relation = (row.get("patient_relation") or "").strip()
		if not file_name and not document_type and not document_url and not signee_name and not patient_relation:
			continue
		doc.append(
			"e_signatures",
			{
				"idx": idx,
				"file_name": file_name or document_type or signee_name or None,
				"document_type": document_type or None,
				"transaction_no": (row.get("transaction_no") or "").strip() or None,
				"upload_remarks": (row.get("upload_remarks") or "").strip() or None,
				"document": document_url or None,
				"patient_relation": patient_relation or None,
				"signee_name": signee_name or None,
			},
		)


@frappe.whitelist()
def update_inpatient_admission(name, data):
	"""Update editable fields on a scheduled or admitted Inpatient Admission."""
	assert_editing_allowed()
	if isinstance(data, str):
		data = frappe.parse_json(data) if data else {}
	if not name:
		frappe.throw(_("Admission name is required"))

	doc = frappe.get_doc("Inpatient Admission", name)
	if doc.status not in ("Admission Scheduled", "Admitted"):
		frappe.throw(_("Only scheduled or admitted admissions can be edited"))

	# Frontend aliases
	if data.get("consultant_doctor"):
		data["primary_practitioner"] = data.pop("consultant_doctor")
	if data.get("residents_doctor"):
		data["residents_doctor_no"] = data.pop("residents_doctor")

	allowed_fields = {
		"company",
		"cost_center",
		"medical_department",
		"primary_practitioner",
		"psychologist_doctor",
		"residents_doctor_no",
		"admission_ordered_for",
		"expected_length_of_stay",
		"admission_instruction",
		"admission_nursing_checklist_template",
		"scheduled_date",
	}

	for key, value in data.items():
		if key not in allowed_fields:
			continue
		if value is None or value == "":
			continue
		doc.set(key, value)

	if "patient_relatives" in data:
		_apply_patient_relatives(doc, data.get("patient_relatives"))

	if "patient_visitors" in data:
		_apply_patient_visitors(doc, data.get("patient_visitors"))

	if "patient_documents" in data or "e_signatures" in data:
		_apply_e_signatures(doc, data.get("patient_documents") or data.get("e_signatures"))

	if "signature" in data:
		doc.signature = data.get("signature") or ""

	practitioner = doc.get("primary_practitioner")
	if practitioner:
		doc.admission_by_doctor = practitioner
		practitioner_name = frappe.db.get_value(
			"Healthcare Practitioner", practitioner, "practitioner_name"
		)
		if practitioner_name:
			doc.admission_doctor_name = practitioner_name

	if doc.get("psychologist_doctor"):
		psych_name = frappe.db.get_value(
			"Healthcare Practitioner", doc.psychologist_doctor, "practitioner_name"
		)
		if psych_name:
			doc.psychologist_doctor_name = psych_name

	if doc.get("residents_doctor_no"):
		res_name = frappe.db.get_value(
			"Healthcare Practitioner", doc.residents_doctor_no, "practitioner_name"
		)
		if res_name:
			doc.resident_doctor_name = res_name

	doc.save(ignore_permissions=True)
	frappe.db.commit()

	return get_inpatient_record(doc.name)


@frappe.whitelist()
def get_patient_admission_barcode_label(name):
	"""Patient barcode (PB) label data for an Inpatient Admission — same size as lab sample label."""
	from healthcare.api.service_request import _lab_sample_patient_label_fields

	if not name:
		frappe.throw(_("Inpatient Admission name is required"))
	if not frappe.db.exists("Inpatient Admission", name):
		frappe.throw(_("Inpatient Admission not found"))

	doc = frappe.get_doc("Inpatient Admission", name)
	fields = _lab_sample_patient_label_fields(doc.patient, getattr(doc, "gender", None))

	def _fmt(dt):
		if not dt:
			return ""
		try:
			return getdate(dt).strftime("%d-%b-%y").upper()
		except Exception:
			return cstr(dt)

	admission_dt = (
		getattr(doc, "admitted_datetime", None)
		or getattr(doc, "admission_date", None)
		or getattr(doc, "scheduled_date", None)
	)
	discharge_dt = getattr(doc, "discharge_datetime", None) or getattr(doc, "expected_discharge", None)
	draft_info = _draft_discharge_fields(doc.name)
	if draft_info.get("draft_discharge_date") and not getattr(doc, "discharge_datetime", None):
		discharge_dt = draft_info.get("draft_discharge_date")

	return {
		"admission": doc.name,
		"case_no": getattr(doc, "case_no", None) or doc.name,
		"file_no": fields.get("file_no") or doc.patient or "",
		"patient_name": fields.get("patient_name") or doc.patient_name or "",
		"sex": fields.get("sex") or getattr(doc, "gender", None) or "",
		"id_number": fields.get("id_number") or "",
		"date_of_admission": _fmt(admission_dt),
		"date_of_discharge": _fmt(discharge_dt),
	}
