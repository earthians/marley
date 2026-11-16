# -*- coding: utf-8 -*-
# Copyright (c) 2025, Healthcare and contributors
# For license information, please see license.txt
import frappe
from frappe import _
from frappe.utils import cint, strip_html

# Patient History page: invoice / billing figures only for these roles
PATIENT_HISTORY_BILLING_ROLES = frozenset(
	{
		"Healthcare Administrator",
		"Administrator",
		"System Manager",
		"Receptionist",
	}
)


def user_can_view_patient_history_billing() -> bool:
	return bool(PATIENT_HISTORY_BILLING_ROLES & set(frappe.get_roles(frappe.session.user)))


# Portal/API: paging through every Patient without a search term is restricted to this role (GDPR-style minimisation).
DATA_OFFICER_ROLE = "Data Officer"


def user_can_browse_full_patient_directory() -> bool:
	return DATA_OFFICER_ROLE in frappe.get_roles(frappe.session.user)


def _user_can_manage_patient_blacklist(user: str | None = None) -> bool:
	"""Doctors, receptionists, and admins may set or clear patient blacklist."""
	roles = [r.strip().lower() for r in frappe.get_roles(user or frappe.session.user)]
	if not roles:
		return False
	admin = {"administrator", "system manager", "healthcare administrator", "website manager"}
	if admin.intersection(roles):
		return True
	if any(r == "reception" or "reception" in r for r in roles):
		return True
	return any("doctor" in r or "physician" in r or "practitioner" in r for r in roles)


def _blacklist_list_fields(row) -> dict:
	if isinstance(row, dict):
		reason = (row.get("blacklist_reason") or "").strip()
		return {
			"is_black_list": cint(row.get("is_black_list")),
			"blacklist_reason": reason or None,
		}
	reason = (getattr(row, "blacklist_reason", None) or "").strip()
	return {
		"is_black_list": cint(getattr(row, "is_black_list", 0)),
		"blacklist_reason": reason or None,
	}


@frappe.whitelist()
def get_patient_display_names(patients=None):
	"""Return {patient_id: patient_name} for Patient History / list enrichment.

	Uses POST (not GET) so large page sizes (e.g. 2500) do not hit URL-length
	limits. Only returns display names for ids the caller already has from a
	list they can read; Guest is rejected.
	"""
	import json

	if frappe.session.user == "Guest":
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	if isinstance(patients, str):
		patients = json.loads(patients) if patients.strip() else []
	if not patients:
		return {}
	if not isinstance(patients, (list, tuple, set)):
		patients = [patients]

	ids = []
	seen = set()
	for raw in patients:
		pid = (raw or "").strip() if isinstance(raw, str) else str(raw or "").strip()
		if not pid or pid in seen:
			continue
		seen.add(pid)
		ids.append(pid)
		if len(ids) >= 5000:
			break

	out = {}
	chunk_size = 500
	for start in range(0, len(ids), chunk_size):
		chunk = ids[start : start + chunk_size]
		for row in frappe.get_all(
			"Patient",
			filters={"name": ["in", chunk]},
			fields=["name", "patient_name"],
			limit_page_length=len(chunk),
			ignore_permissions=True,
		):
			label = (row.get("patient_name") or "").strip()
			if label:
				out[row["name"]] = label
	return out


@frappe.whitelist()
def search_patients(search=None, limit=20):
	"""Search patients by name, patient ID, file number, CPR/ID number, or mobile."""
	search = (search or "").strip()
	if not search:
		return []
	
	# Convert limit to integer (it comes as string from URL params)
	limit = int(limit) if limit else 20

	mobile_clauses = ["p.mobile LIKE %(search)s"]
	if frappe.db.has_column("Patient", "phone"):
		mobile_clauses.append("p.phone LIKE %(search)s")
	if frappe.db.has_column("Patient", "alter_mobile_no"):
		mobile_clauses.append("p.alter_mobile_no LIKE %(search)s")
	if frappe.db.has_column("Patient", "alter_2_mobile_no"):
		mobile_clauses.append("p.alter_2_mobile_no LIKE %(search)s")
	
	patients = frappe.db.sql(f"""
		SELECT 
			p.name,
			p.patient_name,
			p.file_no as file_number,
			p.mobile,
			p.email,
			p.sex,
			p.id_number,
			p.category,
			p.is_black_list,
			p.blacklist_reason
		FROM `tabPatient` p
		WHERE 
			p.patient_name LIKE %(search)s
			OR p.name LIKE %(search)s
			OR p.file_no LIKE %(search)s
			OR p.id_number LIKE %(search)s
			OR {" OR ".join(mobile_clauses)}
		ORDER BY p.patient_name
		LIMIT %(limit)s
	""", {
		'search': f'%{search}%',
		'limit': limit
	}, as_dict=True)
	
	return [
		{
			"name": p.name,
			"patient_name": p.patient_name or p.name,
			"file_number": p.file_number,
			"mobile": p.mobile,
			"email": p.email,
			"sex": p.sex,
			"id_number": p.id_number,
			"category": p.category,
			**_blacklist_list_fields(p),
		}
		for p in patients
	]


@frappe.whitelist()
def get_patient_display_name(patient: str | None = None) -> dict:
	"""Display name for portal patient search bar (clinical roles often lack REST read on Patient)."""
	patient = (patient or "").strip()
	if not patient:
		return {"name": "", "patient_name": "", "file_number": ""}
	if not frappe.db.exists("Patient", patient):
		return {"name": patient, "patient_name": patient, "file_number": ""}
	row = frappe.db.get_value("Patient", patient, ["patient_name", "file_no"], as_dict=True) or {}
	patient_name = row.get("patient_name") or patient
	file_number = row.get("file_no") or patient
	return {"name": patient, "patient_name": patient_name, "file_number": file_number}


@frappe.whitelist()
def get_patients(limit=20, offset=0, search=None, patient=None):
	"""Get list of patients with server-side pagination.

	`patient` fetches exactly one record by ID — used when a patient is selected
	in the global search, so fuzzy matching can't pull in look-alike records.
	"""
	limit = int(limit) if limit else 20
	offset = int(offset) if offset else 0

	search = (search or "").strip()
	search = search if search else None

	patient = (patient or "").strip()
	if patient:
		rows = frappe.db.sql(
			"""SELECT p.name, p.patient_name, p.file_no as file_number,
				p.mobile, p.email, p.sex, p.id_number, p.category,
				p.blood_group, p.nationality, p.is_insurance, p.insurance,
				p.is_black_list, p.blacklist_reason
			FROM `tabPatient` p WHERE p.name = %(patient)s""",
			{'patient': patient},
			as_dict=True,
		)
		patient_names = [p.name for p in rows]
		appointment_map = get_latest_appointment_status(patient_names)
		inpatient_map = get_latest_inpatient_status(patient_names)
		data = [
			{'name': p.name, 'patient_name': p.patient_name or p.name,
			 'file_number': p.file_number, 'mobile': p.mobile, 'email': p.email,
			 'sex': p.sex, 'id_number': p.id_number, 'category': p.category,
			 'blood_group': p.blood_group, 'nationality': p.nationality,
			 'has_insurance': 1 if (p.is_insurance or p.insurance) else 0,
			 'appointment_status': appointment_map.get(p.name),
			 'inpatient_status': inpatient_map.get(p.name),
			 **_blacklist_list_fields(p)}
			for p in rows
		]
		return {"data": data, "total_count": len(data)}

	if search:
		search_param = f'%{search}%'
		where_clause = """
			WHERE p.patient_name LIKE %(search)s
				OR p.name LIKE %(search)s
				OR p.file_no LIKE %(search)s
				OR p.id_number LIKE %(search)s
				OR p.mobile LIKE %(search)s
		"""

		total_count = frappe.db.sql(
			f"SELECT COUNT(*) as cnt FROM `tabPatient` p {where_clause}",
			{'search': search_param},
			as_dict=True,
		)[0].cnt

		patients = frappe.db.sql(
			f"""SELECT p.name, p.patient_name, p.file_no as file_number,
				p.mobile, p.email, p.sex, p.id_number, p.category,
				p.blood_group, p.nationality, p.is_insurance, p.insurance,
				p.is_black_list, p.blacklist_reason
			FROM `tabPatient` p {where_clause}
			ORDER BY (p.name = %(exact_search)s OR p.file_no = %(exact_search)s) DESC,
				p.patient_name
			LIMIT %(limit)s OFFSET %(offset)s""",
			{'search': search_param, 'exact_search': search, 'limit': limit, 'offset': offset},
			as_dict=True,
		)

		data = [
			{'name': p.name, 'patient_name': p.patient_name or p.name,
			 'file_number': p.file_number, 'mobile': p.mobile, 'email': p.email,
			 'sex': p.sex, 'id_number': p.id_number, 'category': p.category,
			 'blood_group': p.blood_group, 'nationality': p.nationality,
			 'has_insurance': 1 if (p.is_insurance or p.insurance) else 0,
			 **_blacklist_list_fields(p)}
			for p in patients
		]
		return {"data": data, "total_count": total_count}
	else:
		if not user_can_browse_full_patient_directory():
			return {"data": [], "total_count": 0, "full_directory_restricted": True}

		total_count = frappe.db.count('Patient')

		patients = frappe.get_all(
			'Patient',
			fields=['name', 'patient_name', 'file_no', 'mobile', 'email', 'sex', 'id_number', 'category',
				'blood_group', 'nationality', 'is_insurance', 'insurance', 'is_black_list', 'blacklist_reason'],
			limit=limit,
			limit_start=offset,
			order_by='patient_name',
		)
		patient_names = [p.name for p in patients]

		appointment_map = get_latest_appointment_status(patient_names)
		inpatient_map = get_latest_inpatient_status(patient_names)

		data = [
			{'name': p.name, 'patient_name': p.patient_name or p.name,
			 'file_number': p.file_no, 'mobile': p.mobile, 'email': p.email,
			 'sex': p.sex, 'id_number': p.id_number, 'category': p.category,
			 'blood_group': p.blood_group, 'nationality': p.nationality,
			 'has_insurance': 1 if (p.is_insurance or p.insurance) else 0,
			 'appointment_status': appointment_map.get(p.name),
			 'inpatient_status': inpatient_map.get(p.name),
			 **_blacklist_list_fields(p)}
			for p in patients
		]
		return {"data": data, "total_count": total_count}

def get_latest_appointment_status(patient_names: list[str]) -> dict:
	"""Return latest appointment status per patient"""
	if not patient_names:
		return {}

	data = frappe.db.sql("""
		SELECT pa.patient, pa.status
		FROM `tabPatient Appointment` pa
		INNER JOIN (
			SELECT patient, MAX(creation) AS max_creation
			FROM `tabPatient Appointment`
			WHERE patient IN %(patients)s
			GROUP BY patient
		) latest
		ON latest.patient = pa.patient AND latest.max_creation = pa.creation
	""", {"patients": patient_names}, as_dict=True)

	return {d.patient: d.status for d in data}

def get_latest_inpatient_status(patient_names: list[str]) -> dict:
	"""Return latest inpatient admission status per patient"""
	if not patient_names:
		return {}

	data = frappe.db.sql("""
		SELECT ip.patient, ip.status
		FROM `tabInpatient Admission` ip
		INNER JOIN (
			SELECT patient, MAX(creation) AS max_creation
			FROM `tabInpatient Admission`
			WHERE patient IN %(patients)s
			GROUP BY patient
		) latest
		ON latest.patient = ip.patient AND latest.max_creation = ip.creation
	""", {"patients": patient_names}, as_dict=True)

	return {d.patient: d.status for d in data}

@frappe.whitelist()
def check_patient_duplicate(patient_name=None, mobile=None, phone=None, category=None, dob=None):
	"""Portal: check before create (full name + mobile or DOB; category is ignored)."""
	from healthcare.healthcare.doctype.patient.patient_duplicate import find_duplicate_patient

	dup = find_duplicate_patient(patient_name, mobile=mobile, phone=phone, dob=dob)
	if not dup:
		return {"duplicate": False}
	return {
		"duplicate": True,
		"patient": {
			"name": dup.get("name"),
			"patient_name": dup.get("patient_name"),
			"file_no": dup.get("file_no") or dup.get("name"),
		},
	}


ALL_CUSTOMER_GROUP_NAMES = frozenset({"All Customer Groups", "All Customer Group"})


def _is_group_customer_group(name):
	if not name:
		return True
	if name in ALL_CUSTOMER_GROUP_NAMES:
		return True
	return cint(frappe.db.get_value("Customer Group", name, "is_group"))


def _ensure_patient_customer_group_exists():
	from healthcare.healthcare.doctype.patient.patient import ensure_patient_customer_group_exists

	ensure_patient_customer_group_exists()


def _serialize_patient_for_portal(patient_doc):
	relations = []
	for row in patient_doc.get("patient_relation") or []:
		relations.append(
			{
				"full_name": row.get("full_name"),
				"relation": row.get("relation"),
				"mobile_no": row.get("mobile_no"),
				"email": row.get("email"),
				"description": row.get("description"),
				"is_next_of_kin": cint(row.get("is_next_of_kin")),
			}
		)

	documents = []
	for row in patient_doc.get("patient_document") or []:
		documents.append(
			{
				"name": row.get("name"),
				"file_name": row.get("document_name") or row.get("file_name"),
				"document_type": row.get("document_type"),
				"transaction_no": row.get("transaction_no"),
				"upload_remarks": row.get("upload_remarks"),
				"document": row.get("document"),
			}
		)

	insurance_coverages = []
	for row in patient_doc.get("patient_insurance_coverage") or []:
		insurance_coverages.append(
			{
				"name": row.get("name"),
				"health_insurance": row.get("health_insurance"),
				"insurance_register": row.get("insurance_register"),
				"insurance_type": row.get("insurance_type"),
				"insurance_company_no": row.get("insurance_company_no"),
				"insurance_policy_no": row.get("insurance_policy_no"),
				"ref_no": row.get("ref_no"),
				"insurance_valid_till": row.get("insurance_valid_till"),
				"insurance_expiry_date": row.get("insurance_expiry_date"),
				"insurance_work_place": row.get("insurance_work_place"),
				"insurance_isdn_no": row.get("insurance_isdn_no"),
				"insurance_deduction_amount": row.get("insurance_deduction_amount"),
				"insurance_special_note": row.get("insurance_special_note"),
				"employee_code": row.get("employee_code"),
				"is_active": cint(row.get("is_active")),
			}
		)

	return {
		"name": patient_doc.name,
		"patient_name": patient_doc.patient_name,
		"file_no": getattr(patient_doc, "file_no", None) or patient_doc.name,
		"first_name": getattr(patient_doc, "first_name", None),
		"middle_name": getattr(patient_doc, "middle_name", None),
		"last_name": getattr(patient_doc, "last_name", None),
		"title": getattr(patient_doc, "title", None),
		"sex": getattr(patient_doc, "sex", None),
		"dob": getattr(patient_doc, "dob", None),
		"blood_group": getattr(patient_doc, "blood_group", None),
		"mobile": getattr(patient_doc, "mobile", None),
		"mobile_no_owner": getattr(patient_doc, "mobile_no_owner", None),
		"phone": getattr(patient_doc, "phone", None),
		"email": getattr(patient_doc, "email", None),
		"id_number": getattr(patient_doc, "id_number", None),
		"nationality": getattr(patient_doc, "nationality", None),
		"category": getattr(patient_doc, "category", None),
		"source": getattr(patient_doc, "source", None),
		"marital_status": getattr(patient_doc, "marital_status", None),
		"is_black_list": cint(getattr(patient_doc, "is_black_list", 0)),
		"blacklist_reason": (getattr(patient_doc, "blacklist_reason", None) or "").strip() or None,
		"remarks": getattr(patient_doc, "patient_details", None),
		"address": getattr(patient_doc, "address", None),
		"city": getattr(patient_doc, "city", None),
		"country": getattr(patient_doc, "country", None),
		"alternative_mobile_no_1": getattr(patient_doc, "alter_mobile_no", None),
		"alternative_mobile_no_2": getattr(patient_doc, "alter_2_mobile_no", None),
		"job_title": getattr(patient_doc, "job_title", None),
		"job_company": getattr(patient_doc, "job_company", None),
		"has_insurance": cint(getattr(patient_doc, "is_insurance", 0)),
		"insurance": getattr(patient_doc, "insurance", None),
		"insurance_type": getattr(patient_doc, "insurance_type", None),
		"insurance_company_no": getattr(patient_doc, "insurance_company_no", None),
		"insurance_policy": getattr(patient_doc, "insurance_policy_no", None),
		"ref_no": getattr(patient_doc, "ref_no", None),
		"insurance_register": getattr(patient_doc, "insurance_register", None),
		"patient_insurance_coverages": insurance_coverages,
		"cpr_photo": getattr(patient_doc, "cprigama_front_photo", None),
		"cpr_photo_back": getattr(patient_doc, "cprigama_back_photo", None),
		"patient_relation": relations,
		"patient_document": documents,
	}


@frappe.whitelist()
def get_patient_doc(patient=None):
	"""Full Patient record for portal edit form (bypasses REST read permission)."""
	patient = (patient or "").strip()
	if not patient or not frappe.db.exists("Patient", patient):
		frappe.throw(_("Patient not found"))
	patient_doc = frappe.get_doc("Patient", patient)
	return _serialize_patient_for_portal(patient_doc)


@frappe.whitelist()
def get_next_patient_file_no():
	"""Next Patient File No from the largest existing *6-digit* file number + 1.

	Longer (e.g. 9-digit) file numbers from bad sequences are ignored so new
	patients continue the 6-digit series. Result is unique against Patient.file_no
	and Patient.name.
	"""
	import re

	rows = frappe.db.sql(
		"""
		SELECT DISTINCT file_no
		FROM `tabPatient`
		WHERE IFNULL(file_no, '') != ''
		""",
		as_dict=True,
	)

	max_six = 0
	for row in rows:
		raw = (row.get("file_no") or "").strip()
		if not raw:
			continue
		# Pure 6-digit file numbers only (ignore 7+ digit / mixed values).
		if re.fullmatch(r"\d{6}", raw):
			max_six = max(max_six, int(raw))

	# No 6-digit series yet — start at 100000 (first 6-digit value).
	next_num = (max_six + 1) if max_six else 100000

	# Skip collisions with existing file_no or Patient name.
	while True:
		candidate = str(next_num)
		exists = frappe.db.exists("Patient", {"file_no": candidate}) or frappe.db.exists(
			"Patient", candidate
		)
		if not exists:
			return candidate
		next_num += 1

@frappe.whitelist()
def create_patient(data):
	"""Create a new Patient"""

	if isinstance(data, str):
		import json
		data = json.loads(data)
	from healthcare.api.patient_visit import ensure_doctor_may_create_patient_or_visit

	ensure_doctor_may_create_patient_or_visit()
	_validate_patient_payload(data)

	from healthcare.healthcare.doctype.patient.patient_duplicate import throw_if_duplicate_patient

	throw_if_duplicate_patient(
		data.get("patient_name") or data.get("first_name"),
		mobile=data.get("mobile"),
		phone=data.get("phone"),
	)

	from healthcare.healthcare.doctype.patient.patient import resolve_patient_customer_group

	category = data.get("category") or None
	customer_group = resolve_patient_customer_group(category)

	patient = frappe.get_doc({
		"doctype": "Patient",
		"customer_group": customer_group,
		"title": data.get("title") or None,
		# "first_name": data.get("first_name"),
		# "middle_name": data.get("middle_name") or "",
		# "last_name": data.get("last_name") or "",
		"patient_name": data.get("patient_name"),
		"file_no": data.get("file_no") or None,
		"sex": data.get("sex"),
		"dob": data.get("dob") or None,
		"blood_group": data.get("blood_group") or None,
		"mobile": data.get("mobile") or None,
		"mobile_no_owner": data.get("mobile_no_owner") or None,
		"phone": data.get("phone") or None,
		"email": data.get("email") or None,
		"id_number": data.get("id_number") or None,
		"nationality": data.get("nationality") or None,
		"category": category,
		"source": data.get("source") or None,
		"marital_status": data.get("marital_status") or None,
		"emergency_contact_name": data.get("emergency_contact_name") or None,
		"emergency_contact_relation": data.get("emergency_contact_relation") or None,
		"emergency_contact_phone": data.get("emergency_contact_phone") or None,
		"is_black_list": 1 if data.get("is_black_list") else 0,
		"blacklist_reason": (data.get("blacklist_reason") or "").strip() or None if data.get("is_black_list") else None,
		"patient_details": data.get("remarks") or None,
		"alter_mobile_no": data.get("alternative_mobile_no_1") or None,
		"alter_2_mobile_no": data.get("alternative_mobile_no_2") or None,
		
		"is_insurance": 1 if data.get("has_insurance") else 0,
		"insurance": data.get("insurance") or None,
		"insurance_policy_no": data.get("insurance_policy") or None,
		"insurance_company_no": data.get("insurance_company_no") or None,
		"insurance_valid_till": data.get("insurance_valid_till") or None,
		"ref_no": data.get("ref_no") or None,
		"insurance_type": data.get("insurance_type") or None,
		"address": (data.get("address_line1") or "").strip() or None,
		"city": (data.get("city") or "").strip() or None,
		"country": (data.get("country") or "").strip() or None,
		"cprigama_front_photo": data.get("cpr_photo") or None,
		"cprigama_back_photo": data.get("cpr_photo_back") or None,
	})

	_apply_patient_insurance_coverages(patient, data, replace=True)
	patient.insert(ignore_permissions=True)

	_add_patient_relations(patient, data)
	_setup_patient_links(patient, data)
	_add_patient_documents(patient, data)

	result = {
		"name": patient.name,
		"patient_name": patient.patient_name,
		"file_no": patient.file_no or patient.name,
	}
	insurance_register = _ensure_insurance_register_for_patient(patient, data)
	if insurance_register:
		result["insurance_register"] = insurance_register
	charge_file_no = data.get("charge_file_no")
	if charge_file_no is None:
		charge_file_no = 1
	if frappe.utils.cint(charge_file_no):
		try:
			from healthcare.api.patient_file_no_charge import create_patient_file_no_sales_order

			so_info = create_patient_file_no_sales_order(patient.name)
			result["sales_order"] = so_info.get("sales_order")
			result["file_no_charge_rate"] = so_info.get("rate")
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"File no charge SO failed for {patient.name}")
			result["file_no_charge_error"] = _("File number charge order could not be created. Patient was saved.")

	return result

def _validate_patient_payload(data):

	if not data.get("first_name"):
		frappe.throw(_("First Name is required"))

	if not data.get("sex"):
		frappe.throw(_("Gender is required"))

	if not data.get("mobile") and not data.get("phone"):
		frappe.throw(_("At least one Contact No. is required"))

	if not data.get("source"):
		frappe.throw(_("Patient Referral or Source is required"))

	if not data.get("category"):
		frappe.throw(_("Patient type is required"))


from frappe.utils import cint
from healthcare.healthcare.editing_lock import assert_editing_allowed

def _parse_child_rows(data, key):
	rows = data.get(key) or []
	if isinstance(rows, str):
		import json
		rows = json.loads(rows) if rows.strip() else []
	return rows if isinstance(rows, list) else []


def _default_patient_insurance_row(data):
	health_insurance = (data.get("insurance") or "").strip()
	insurance_register = (data.get("insurance_register") or "").strip()
	insurance_type = (data.get("insurance_type") or "").strip()
	insurance_company_no = (data.get("insurance_company_no") or "").strip()
	insurance_policy_no = (data.get("insurance_policy") or "").strip()
	ref_no = (data.get("ref_no") or "").strip()
	insurance_valid_till = data.get("insurance_valid_till") or None
	if not any(
		[
			health_insurance,
			insurance_register,
			insurance_type,
			insurance_company_no,
			insurance_policy_no,
			ref_no,
			insurance_valid_till,
		]
	):
		return None
	return {
		"health_insurance": health_insurance or None,
		"insurance_register": insurance_register or None,
		"insurance_type": insurance_type or None,
		"insurance_company_no": insurance_company_no or None,
		"insurance_policy_no": insurance_policy_no or None,
		"ref_no": ref_no or None,
		"insurance_valid_till": insurance_valid_till,
		"is_active": 1,
	}


def _resolve_primary_patient_insurance(patient):
	rows = [row for row in (patient.get("patient_insurance_coverage") or []) if row.get("health_insurance")]
	if not rows:
		return None
	active_rows = [row for row in rows if cint(row.get("is_active"))]
	return (active_rows or rows)[0]


def _sync_patient_primary_insurance_fields(patient):
	"""Mirror child → parent when rows exist; otherwise keep parent values."""
	primary = _resolve_primary_patient_insurance(patient)
	if not primary:
		# Do not wipe parent insurance fields when the child table is empty.
		# Portal create/update already builds a child row from parent fields when needed.
		if cint(patient.is_insurance) or patient.get("insurance") or patient.get("insurance_register"):
			patient.is_insurance = 1
		return

	patient.is_insurance = 1
	patient.insurance = primary.get("health_insurance") or None
	patient.insurance_type = primary.get("insurance_type") or None
	patient.insurance_company_no = primary.get("insurance_company_no") or None
	patient.insurance_policy_no = primary.get("insurance_policy_no") or None
	patient.ref_no = primary.get("ref_no") or None
	patient.insurance_register = primary.get("insurance_register") or None
	patient.insurance_valid_till = primary.get("insurance_valid_till") or None
	patient.insurance_expiry_date = primary.get("insurance_expiry_date") or None
	patient.insurance_work_place = primary.get("insurance_work_place") or None
	patient.insurance_isdn_no = primary.get("insurance_isdn_no") or None
	patient.insurance_deduction_amount = primary.get("insurance_deduction_amount") or None
	patient.insurance_special_note = primary.get("insurance_special_note") or None
	patient.employee_code = primary.get("employee_code") or None


def _apply_patient_insurance_coverages(patient, data, *, replace=False):
	if replace:
		patient.set("patient_insurance_coverage", [])

	rows = _parse_child_rows(data, "patient_insurance_coverages")
	if not rows and data.get("has_insurance"):
		default_row = _default_patient_insurance_row(data)
		rows = [default_row] if default_row else []

	for row in rows:
		if not isinstance(row, dict):
			continue

		health_insurance = (row.get("health_insurance") or row.get("insurance") or "").strip() or None
		insurance_register = (row.get("insurance_register") or "").strip() or None
		insurance_type = (row.get("insurance_type") or "").strip() or None
		insurance_company_no = (row.get("insurance_company_no") or "").strip() or None
		insurance_policy_no = (
			row.get("insurance_policy_no") or row.get("insurance_policy") or ""
		).strip() or None
		ref_no = (row.get("ref_no") or "").strip() or None
		insurance_valid_till = row.get("insurance_valid_till") or None
		insurance_expiry_date = row.get("insurance_expiry_date") or None
		insurance_work_place = (row.get("insurance_work_place") or "").strip() or None
		insurance_isdn_no = (row.get("insurance_isdn_no") or "").strip() or None
		insurance_deduction_amount = row.get("insurance_deduction_amount") or None
		insurance_special_note = (row.get("insurance_special_note") or "").strip() or None
		employee_code = (row.get("employee_code") or "").strip() or None
		is_active = cint(row.get("is_active"))

		if not any(
			[
				health_insurance,
				insurance_register,
				insurance_type,
				insurance_company_no,
				insurance_policy_no,
				ref_no,
				insurance_valid_till,
				insurance_expiry_date,
				insurance_work_place,
				insurance_isdn_no,
				insurance_deduction_amount,
				insurance_special_note,
				employee_code,
			]
		):
			continue

		if health_insurance and not insurance_type:
			insurance_type = frappe.db.get_value("Health Insurance", health_insurance, "insurance_type")
		if health_insurance and not insurance_company_no:
			insurance_company_no = frappe.db.get_value(
				"Health Insurance", health_insurance, "insurance_company"
			)
		if health_insurance and not insurance_policy_no:
			insurance_policy_no = frappe.db.get_value("Health Insurance", health_insurance, "policy_no")

		patient.append(
			"patient_insurance_coverage",
			{
				"health_insurance": health_insurance,
				"insurance_register": insurance_register,
				"insurance_type": insurance_type,
				"insurance_company_no": insurance_company_no,
				"insurance_policy_no": insurance_policy_no,
				"ref_no": ref_no,
				"insurance_valid_till": insurance_valid_till,
				"insurance_expiry_date": insurance_expiry_date,
				"insurance_work_place": insurance_work_place,
				"insurance_isdn_no": insurance_isdn_no,
				"insurance_deduction_amount": insurance_deduction_amount,
				"insurance_special_note": insurance_special_note,
				"employee_code": employee_code,
				"is_active": is_active if is_active in (0, 1) else 1,
			},
		)

	_sync_patient_primary_insurance_fields(patient)


def _ensure_insurance_register_for_patient(patient, data):
	"""Create + link an Insurance Patient Register for a newly registered insured patient.

	Registration only records the payer; approvals, the validity window, and the
	visit allowance live on the register, so an insured patient without one cannot
	be claimed. Creating the register up front keeps the patient claimable — the
	portal then shows an "Add validity days" reminder on it until Valid From /
	Valid To are filled in.

	Returns the register name, or ``None`` when the patient is not insured (or the
	payer is missing). Failures never block patient creation.
	"""
	if not cint(patient.get("is_insurance")):
		return None

	try:
		chosen_register = (data.get("insurance_register") or "").strip()
		if chosen_register and frappe.db.exists("Insurance Patient Register", chosen_register):
			# A register was picked in the form — make sure the link is two-way.
			if frappe.db.get_value(
				"Insurance Patient Register", chosen_register, "patient"
			) != patient.name:
				from healthcare.api.common import _sync_patient_with_insurance_register

				_sync_patient_with_insurance_register(chosen_register, patient.name)
			return chosen_register

		existing_register = frappe.db.get_value(
			"Insurance Patient Register", {"patient": patient.name}, "name"
		)
		if existing_register:
			return existing_register

		provider = (patient.get("insurance") or "").strip()
		if not provider or not frappe.db.exists("Health Insurance", provider):
			return None

		register = frappe.get_doc({
			"doctype": "Insurance Patient Register",
			"full_name": patient.patient_name or patient.name,
			"national_id_cpr_no": patient.get("id_number") or None,
			"insurance_provider": provider,
			"status": "Active",
			"posting_date": frappe.utils.nowdate(),
			"patient": patient.name,
		})
		register.flags.ignore_permissions = True
		register.insert(ignore_permissions=True)

		frappe.db.set_value(
			"Patient", patient.name, "insurance_register", register.name, update_modified=False
		)
		primary_cover = _resolve_primary_patient_insurance(patient)
		if primary_cover and primary_cover.get("name"):
			frappe.db.set_value(
				"Patient Insurance Cover",
				primary_cover.name,
				"insurance_register",
				register.name,
				update_modified=False,
			)
		return register.name
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Auto insurance register failed for {patient.name}")
		return None


def _apply_patient_relations(patient, data, *, replace=False):
	if replace:
		patient.set("patient_relation", [])

	for row in _parse_child_rows(data, "patient_relation"):
		if not isinstance(row, dict):
			continue

		relation = (row.get("relation") or "").strip()
		mobile_no = (row.get("mobile_no") or "").strip() or None
		email = (row.get("email") or "").strip() or None
		description = (row.get("description") or "").strip() or None
		full_name = (row.get("full_name") or "").strip() or None
		is_next_of_kin = cint(row.get("is_next_of_kin"))

		if relation or mobile_no or email or full_name or is_next_of_kin:
			patient.append(
				"patient_relation",
				{
					"patient": patient.name,
					"relation": relation,
					"mobile_no": mobile_no,
					"email": email,
					"description": description,
					"full_name": full_name,
					"is_next_of_kin": is_next_of_kin,
				},
			)


def _add_patient_relations(patient, data):
	_apply_patient_relations(patient, data)
	if patient.get("patient_relation"):
		patient.save(ignore_permissions=True)

def _address_city_for_save(city):
	city = (city or "").strip()
	return city or "-"


def _address_city_for_display(city):
	city = (city or "").strip()
	return "" if city in ("-", "—", "N/A") else city


def _get_patient_linked_address_name(patient_name):
	primary = frappe.db.get_value("Patient", patient_name, "patient_primary_address")
	if primary:
		return primary

	rows = frappe.db.sql(
		"""
		SELECT a.name
		FROM `tabAddress` a
		INNER JOIN `tabDynamic Link` dl ON dl.parent = a.name AND dl.parenttype = 'Address'
		WHERE dl.link_doctype = 'Patient' AND dl.link_name = %s
		ORDER BY a.is_primary_address DESC, a.modified DESC
		LIMIT 1
		""",
		patient_name,
	)
	return rows[0][0] if rows else None


def _patient_address_payload(address_name=None, patient_doc=None):
	if address_name and frappe.db.exists("Address", address_name):
		addr = frappe.db.get_value(
			"Address",
			address_name,
			["name", "address_line1", "address_line2", "city", "state", "country", "pincode"],
			as_dict=True,
		)
		if addr:
			addr["city"] = _address_city_for_display(addr.get("city"))
			return addr

	if patient_doc:
		return {
			"name": None,
			"address_line1": patient_doc.get("address") or "",
			"address_line2": "",
			"city": patient_doc.get("city") or "",
			"state": "",
			"country": patient_doc.get("country") or "",
			"pincode": "",
		}

	return {
		"name": None,
		"address_line1": "",
		"address_line2": "",
		"city": "",
		"state": "",
		"country": "",
		"pincode": "",
	}


@frappe.whitelist()
def get_patient_address(patient):
	"""Return address fields for the portal patient edit form."""
	patient = (patient or "").strip()
	if not patient or not frappe.db.exists("Patient", patient):
		frappe.throw(_("Patient not found"))

	patient_doc = frappe.get_doc("Patient", patient)
	address_name = _get_patient_linked_address_name(patient)
	return _patient_address_payload(address_name, patient_doc)


@frappe.whitelist()
def save_patient_address(patient, data):
	"""Create or update a patient's primary address from the portal."""
	if isinstance(data, str):
		import json
		data = json.loads(data)

	patient = (patient or "").strip()
	if not patient or not frappe.db.exists("Patient", patient):
		frappe.throw(_("Patient not found"))

	address_line1 = (data.get("address_line1") or "").strip()
	if not address_line1:
		return {"name": None}

	patient_doc = frappe.get_doc("Patient", patient)
	city = _address_city_for_save(data.get("city"))
	country = (data.get("country") or "").strip()
	if not country:
		country = frappe.db.get_single_value("System Settings", "country")

	address_name = _get_patient_linked_address_name(patient)
	address_fields = {
		"address_line1": address_line1,
		"address_line2": data.get("address_line2"),
		"city": city,
		"state": data.get("state"),
		"country": country,
		"pincode": data.get("pincode"),
	}

	try:
		if address_name and frappe.db.exists("Address", address_name):
			addr = frappe.get_doc("Address", address_name)
			addr.update(address_fields)
			addr.is_primary_address = 1
			addr.save(ignore_permissions=True)
		else:
			addr = frappe.get_doc({
				"doctype": "Address",
				"address_title": patient_doc.patient_name or patient_doc.name,
				"address_type": "Billing",
				"is_primary_address": 1,
				"links": [{"link_doctype": "Patient", "link_name": patient_doc.name}],
				**address_fields,
			})
			addr.insert(ignore_permissions=True)
			address_name = addr.name

		frappe.db.set_value(
			"Patient",
			patient_doc.name,
			{
				"patient_primary_address": address_name,
				"address": address_line1,
				"city": (data.get("city") or "").strip() or None,
				"country": country,
			},
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Save Patient Address")
		frappe.throw(_("Could not save patient address"))

	return {"name": address_name}


def _setup_patient_links(patient, data):

	address_line1 = (data.get("address_line1") or "").strip()

	if address_line1:
		try:
			save_patient_address(patient.name, data)
		except Exception:
			frappe.log_error(frappe.get_traceback(), "Create Patient Address")

	# Customer Auto Link
	if frappe.db.get_single_value(
		"Healthcare Settings", "link_customer_to_patient"
	) and not patient.customer:
		try:
			from healthcare.healthcare.doctype.patient.patient import create_customer
			create_customer(patient)
		except Exception:
			pass

	# Contact
	try:
		patient.set_contact()
	except Exception:
		pass

def _apply_patient_documents(patient, data, *, replace=False):
	if replace:
		patient.set("patient_document", [])

	for row in _parse_child_rows(data, "patient_document") or _parse_child_rows(data, "documents"):
		if not isinstance(row, dict):
			continue

		display_name = (row.get("file_name") or "").strip()
		document_url = (row.get("document") or "").strip() or None
		if document_url:
			from healthcare.api.common import ensure_file_url_public
			document_url = ensure_file_url_public(document_url)
		document_type = (row.get("document_type") or "").strip() or None

		if not display_name and not document_url:
			continue

		if not display_name and document_url:
			display_name = document_url.split("/")[-1]

		patient.append(
			"patient_document",
			{
				"document_name": display_name,
				"file_name": document_type,
				"document_type": document_type,
				"transaction_no": row.get("transaction_no"),
				"upload_remarks": row.get("upload_remarks"),
				"document": document_url,
			},
		)


def _add_patient_documents(patient, data):
	_apply_patient_documents(patient, data)
	if patient.get("patient_document"):
		patient.save(ignore_permissions=True)


def _apply_patient_scalar_fields(patient, data):
	first_name = (data.get("first_name") or "").strip()
	middle_name = (data.get("middle_name") or "").strip()
	last_name = (data.get("last_name") or "").strip()
	patient_name = (data.get("patient_name") or "").strip()
	if not patient_name:
		patient_name = " ".join(part for part in [first_name, middle_name, last_name] if part)

	scalar_map = {
		"title": "title",
		"first_name": "first_name",
		"middle_name": "middle_name",
		"last_name": "last_name",
		"sex": "sex",
		"dob": "dob",
		"blood_group": "blood_group",
		"mobile": "mobile",
		"mobile_no_owner": "mobile_no_owner",
		"phone": "phone",
		"email": "email",
		"id_number": "id_number",
		"nationality": "nationality",
		"category": "category",
		"source": "source",
		"marital_status": "marital_status",
		"job_title": "job_title",
		"job_company": "job_company",
		"insurance": "insurance",
		"insurance_type": "insurance_type",
		"insurance_company_no": "insurance_company_no",
		"ref_no": "ref_no",
		"insurance_register": "insurance_register",
		"emergency_contact_name": "emergency_contact_name",
		"emergency_contact_relation": "emergency_contact_relation",
		"emergency_contact_phone": "emergency_contact_phone",
	}

	for src, field in scalar_map.items():
		if src in data:
			patient.set(field, data.get(src) or None)

	if first_name or "first_name" in data:
		patient.first_name = first_name or None
	if middle_name or "middle_name" in data:
		patient.middle_name = middle_name or None
	if last_name or "last_name" in data:
		patient.last_name = last_name or None
	if patient_name:
		patient.patient_name = patient_name

	if "file_no" in data and data.get("file_no"):
		patient.file_no = data.get("file_no")

	if "remarks" in data:
		patient.patient_details = data.get("remarks") or None
	if "alternative_mobile_no_1" in data:
		patient.alter_mobile_no = data.get("alternative_mobile_no_1") or None
	if "alternative_mobile_no_2" in data:
		patient.alter_2_mobile_no = data.get("alternative_mobile_no_2") or None
	if "has_insurance" in data:
		patient.is_insurance = 1 if data.get("has_insurance") else 0
	if "insurance_policy" in data:
		patient.insurance_policy_no = data.get("insurance_policy") or None
	if "is_black_list" in data:
		patient.is_black_list = 1 if data.get("is_black_list") else 0
		if not patient.is_black_list:
			patient.blacklist_reason = None
	if "blacklist_reason" in data:
		reason = (data.get("blacklist_reason") or "").strip() or None
		patient.blacklist_reason = reason if cint(getattr(patient, "is_black_list", 0)) else None
	if "cpr_photo" in data:
		patient.cprigama_front_photo = data.get("cpr_photo") or None
	if "cpr_photo_back" in data:
		patient.cprigama_back_photo = data.get("cpr_photo_back") or None
	if "patient_insurance_coverages" in data or "has_insurance" in data:
		_apply_patient_insurance_coverages(
			patient,
			data,
			replace=("patient_insurance_coverages" in data),
		)
		if "has_insurance" in data and not data.get("has_insurance"):
			patient.set("patient_insurance_coverage", [])
			_sync_patient_primary_insurance_fields(patient)

	from healthcare.healthcare.doctype.patient.patient import resolve_patient_customer_group

	if "category" in data or _is_group_customer_group(patient.customer_group):
		patient.customer_group = resolve_patient_customer_group(
			patient.category, patient.customer_group
		)


@frappe.whitelist()
def update_patient(patient, data):
	"""Update Patient from portal (bypasses REST write permission)."""
	assert_editing_allowed()
	if isinstance(data, str):
		import json
		data = json.loads(data)

	patient = (patient or "").strip()
	if not patient or not frappe.db.exists("Patient", patient):
		frappe.throw(_("Patient not found"))

	doc = frappe.get_doc("Patient", patient)
	_apply_patient_scalar_fields(doc, data)

	if "patient_relation" in data:
		_apply_patient_relations(doc, data, replace=True)
	if "patient_document" in data:
		_apply_patient_documents(doc, data, replace=True)

	doc.save(ignore_permissions=True)

	insurance_register = _ensure_insurance_register_for_patient(doc, data)

	result = {
		"name": doc.name,
		"patient_name": doc.patient_name,
		"file_no": getattr(doc, "file_no", None) or doc.name,
	}
	if insurance_register:
		result["insurance_register"] = insurance_register
	return result


@frappe.whitelist()
def set_patient_blacklist(patient, is_black_list=0, blacklist_reason=None):
	"""Doctors and receptionists can blacklist or unblacklist a patient with a reason."""
	assert_editing_allowed()
	if not _user_can_manage_patient_blacklist():
		frappe.throw(_("Only doctors and receptionists can blacklist a patient."), frappe.PermissionError)

	patient = (patient or "").strip()
	if not patient or not frappe.db.exists("Patient", patient):
		frappe.throw(_("Patient not found"))

	flag = cint(is_black_list)
	reason = (blacklist_reason or "").strip() or None
	if flag and not reason:
		frappe.throw(_("Enter a reason when blacklisting a patient."))

	doc = frappe.get_doc("Patient", patient)
	doc.is_black_list = 1 if flag else 0
	doc.blacklist_reason = reason if flag else None
	doc.save(ignore_permissions=True)

	return {
		"name": doc.name,
		"is_black_list": cint(doc.is_black_list),
		"is_blacklist": cint(doc.is_black_list),
		"blacklist_reason": (doc.blacklist_reason or "").strip() or None,
	}


@frappe.whitelist()
def get_patient_health_history_templates(search=None):
	"""Return list of Patient Health History Templates for dropdown (name + label)."""
	filters = {}
	if search:
		filters["template_name"] = ["like", f"%{search}%"]
	templates = frappe.get_all(
		"Patient Health History Template",
		filters=filters,
		fields=["name", "template_name"],
		limit=50,
		order_by="template_name",
	)
	return [{"name": t.name, "label": t.template_name or t.name} for t in templates]


@frappe.whitelist()
def get_patient_health_history_template_2_options(search=None):
	"""Return Patient Health History Template 2 options for dropdown (name + label + default)."""
	filters = {}
	if search and str(search).strip():
		filters["name"] = ["like", f"%{search.strip()}%"]
	templates = frappe.get_all(
		"Patient Health History Template 2",
		filters=filters,
		fields=["name", "default"],
		limit=50,
		order_by="name asc",
	)
	return [{"name": t.name, "label": t.name, "default": cint(t.default)} for t in templates]


@frappe.whitelist()
def get_patient_health_history_template_2_details(template_name: str):
	"""Return Patient Health History Template 2 doc with its templates table rows.

	Each row maps to the Patient Health History Detail child table shape:
	history, yes, remarks, no_format, is_diabetic, type.
	"""
	if not template_name:
		frappe.throw(_("Template is required"))
	if not frappe.db.exists("Patient Health History Template 2", template_name):
		frappe.throw(_("Patient Health History Template 2 {0} not found").format(template_name))

	doc = frappe.get_doc("Patient Health History Template 2", template_name)
	rows = []
	for row in doc.get("templates") or []:
		rows.append({
			"history": getattr(row, "history", None) or "",
			"yes": cint(getattr(row, "yes", 0)),
			"remarks": getattr(row, "remarks", None) or "",
			"no_format": cint(getattr(row, "no_format", 0) or 0),
			"is_diabetic": cint(getattr(row, "is_diabetic", 0)),
			"type": getattr(row, "type", None) or "",
			"specify": cint(getattr(row, "specify", 0)),
			"speficication": getattr(row, "speficication", None) or "",
		})

	return {
		"name": doc.name,
		"templates": rows,
	}


@frappe.whitelist()
def get_patient_health_history_template_details(template_name: str):
	"""Return template doc with patient_history_details for creating PMH from template."""
	if not template_name:
		frappe.throw(_("Template is required"))
	doc = frappe.get_doc("Patient Health History Template", template_name)
	details = []
	for row in doc.patient_history_details or []:
		details.append({
			"attributes": row.attributes,
			"description": row.description or "",
			"yesno": row.yesno or "",
		})
	return {
		"name": doc.name,
		"template_name": doc.template_name,
		"patient_history_details": details,
	}


def _serialize_patient_medical_history(doc):
	"""Serialize Patient Medical History for portal APIs."""
	return {
		"name": doc.name,
		"patient": doc.patient,
		"patient_name": getattr(doc, "patient_name", None),
		"template": doc.get("template"),
		"inpatient_admission": doc.get("inpatient_admission"),
		"status": doc.get("status") or "Active",
		"creation": str(doc.creation) if doc.creation else None,
		"heart_disease": doc.get("heart_disease") or "",
		"diabetes": doc.get("diabetes") or "",
		"asthma": doc.get("asthma") or "",
		"strokes": doc.get("strokes") or "",
		"other_ongoing_illness": doc.get("other_ongoing_illness") or "",
		"previous_surgical_history": doc.get("previous_surgical_history") or "",
		"current_and_past_medications": doc.get("current_and_past_medications") or "",
		"no_known_allergies": cint(doc.get("no_known_allergies")),
		"allergies": doc.get("allergies") or "",
		"family_history": doc.get("family_history") or "",
		"patient_visit": doc.get("patient_visit"),
		"social_history": doc.get("social_history") or "",
		"addiction": cint(doc.get("addiction")),
		"smoking": cint(doc.get("smoking")),
		"patient_history_details": [
			{
				"attributes": row.attributes,
				"description": row.description,
				"yesno": row.yesno,
			}
			for row in (doc.patient_history_details or [])
		],
	}


def _patient_medical_history_summary(doc) -> str:
	"""Short label for list views (no template name)."""
	parts = []
	for label, field in (
		("Heart", "heart_disease"),
		("Diabetes", "diabetes"),
		("Asthma", "asthma"),
		("Strokes", "strokes"),
	):
		val = doc.get(field) if isinstance(doc, dict) else getattr(doc, field, None)
		if val == "Yes":
			parts.append(label)
	if cint(
		doc.get("no_known_allergies") if isinstance(doc, dict) else getattr(doc, "no_known_allergies", 0)
	):
		parts.append("NKDA")
	elif doc.get("allergies") if isinstance(doc, dict) else getattr(doc, "allergies", None):
		parts.append("Allergies")
	if cint(doc.get("addiction") if isinstance(doc, dict) else getattr(doc, "addiction", 0)):
		parts.append("Addiction")
	if cint(doc.get("smoking") if isinstance(doc, dict) else getattr(doc, "smoking", 0)):
		parts.append("Smoking")
	return ", ".join(parts) if parts else "Past medical history"


# Legacy Oracle/import fields stored on Patient — read in place, do not copy into PMH.
_LEGACY_PATIENT_HISTORY_FIELDS = (
	("family_history", "Family History"),
	("allergies", "Allergies History"),
	("previous_disease_history", "Previous Disease History"),
	("medical_history", "Medical History"),
	("medication", "Medication"),
)


def _clean_legacy_history_text(value) -> str:
	return " ".join(strip_html(value or "").split()).strip()


def _patient_legacy_medical_history(patient: str | None) -> dict | None:
	"""Read family / allergy / previous-disease text from the Patient row.

	These fields pre-date standalone Patient Medical History. Display them
	read-only wherever PMH is shown; do not insert a PMH document from them.
	"""
	if not patient or not frappe.db.exists("Patient", patient):
		return None

	fields = ["name", "patient_name"]
	for fieldname, _label in _LEGACY_PATIENT_HISTORY_FIELDS:
		if frappe.db.has_column("Patient", fieldname):
			fields.append(fieldname)

	row = frappe.db.get_value("Patient", patient, fields, as_dict=True)
	if not row:
		return None

	entries = []
	payload = {
		"patient": row.name,
		"patient_name": row.patient_name,
		"family_history": "",
		"allergies": "",
		"previous_disease_history": "",
		"medical_history": "",
		"medication": "",
		"has_data": False,
		"entries": entries,
	}
	for fieldname, label in _LEGACY_PATIENT_HISTORY_FIELDS:
		text = _clean_legacy_history_text(row.get(fieldname))
		payload[fieldname] = text
		if text:
			entries.append({"key": fieldname, "label": label, "text": text})
	payload["has_data"] = bool(entries)
	return payload if payload["has_data"] else None


@frappe.whitelist()
def get_patient_legacy_medical_history(patient: str):
	"""Legacy family / allergy / previous-disease history stored on Patient."""
	if not patient:
		frappe.throw(_("Patient is required"))
	return _patient_legacy_medical_history(patient)


@frappe.whitelist()
def get_patient_medical_histories(patient):
	"""Return Patient Medical History records plus any Patient-table legacy text."""
	if not patient:
		return {"records": [], "legacy_from_patient": None}
	fields = [
		"name",
		"patient",
		"patient_name",
		"template",
		"inpatient_admission",
		"status",
		"creation",
		"heart_disease",
		"diabetes",
		"asthma",
		"strokes",
		"allergies",
		"addiction",
		"smoking",
	]
	if frappe.db.has_column("Patient Medical History", "family_history"):
		fields.append("family_history")
	records = frappe.get_all(
		"Patient Medical History",
		filters={"patient": patient},
		fields=fields,
		order_by="creation desc",
	)
	for row in records:
		row["summary"] = _patient_medical_history_summary(row)
	return {
		"records": records,
		"legacy_from_patient": _patient_legacy_medical_history(patient),
	}


@frappe.whitelist()
def get_patient_medical_history_detail(name):
	"""Return full Patient Medical History document with details rows."""
	if not name:
		frappe.throw(_("Name is required"))
	doc = frappe.get_doc("Patient Medical History", name)
	payload = _serialize_patient_medical_history(doc)
	payload["summary"] = _patient_medical_history_summary(doc)
	return payload


@frappe.whitelist()
def get_patient_medical_history(patient: str):
	"""Return latest Patient Medical History for a patient."""
	if not patient:
		frappe.throw(_("Patient is required"))

	records = frappe.get_all(
		"Patient Medical History",
		filters={"patient": patient},
		fields=["name"],
		order_by="creation desc",
		limit_page_length=1,
	)

	if not records:
		patient_doc = frappe.get_doc("Patient", patient)
		return {
			"name": None,
			"patient": patient_doc.name,
			"patient_name": patient_doc.patient_name,
			"template": None,
			"inpatient_admission": None,
			"creation": None,
			"heart_disease": "",
			"diabetes": "",
			"asthma": "",
			"strokes": "",
			"other_ongoing_illness": "",
			"previous_surgical_history": "",
			"current_and_past_medications": "",
			"no_known_allergies": 0,
			"allergies": "",
			"family_history": "",
			"patient_visit": None,
			"social_history": "",
			"addiction": 0,
			"smoking": 0,
			"patient_history_details": [],
			"summary": "",
			"legacy_from_patient": _patient_legacy_medical_history(patient),
		}

	doc = frappe.get_doc("Patient Medical History", records[0].name)
	payload = _serialize_patient_medical_history(doc)
	payload["summary"] = _patient_medical_history_summary(doc)
	payload["legacy_from_patient"] = _patient_legacy_medical_history(patient)
	return payload


@frappe.whitelist()
def get_patient_summary(patient):
	"""Get basic patient demographic information for header cards"""
	if not patient:
		frappe.throw(_("Patient is required"))

	patient_doc = frappe.get_doc('Patient', patient)

	is_blacklist = cint(getattr(patient_doc, "is_black_list", 0))
	blacklist_reason = (getattr(patient_doc, "blacklist_reason", None) or "").strip() or None

	id_number = getattr(patient_doc, "id_number", None) or getattr(patient_doc, "national_id", None)

	data = {
		'name': patient_doc.name,
		'patient_name': patient_doc.patient_name,
		'file_no': getattr(patient_doc, 'file_no', None) or patient_doc.name,
		'id_number': id_number,
		'dob': getattr(patient_doc, 'dob', None),
		'sex': getattr(patient_doc, 'sex', None),
		'marital_status': getattr(patient_doc, 'marital_status', None),
		'mobile': getattr(patient_doc, 'mobile', None),
		'category': getattr(patient_doc, 'category', None),
		'is_blacklist': is_blacklist,
		'is_black_list': is_blacklist,
		'blacklist_reason': blacklist_reason,
		"remarks": getattr(patient_doc, 'patient_details', None),
	}

	# Include patient_document child table (Patient Upload Document) for demographics / history
	try:
		documents = []
		for row in (patient_doc.get("patient_document") or []):
			documents.append({
				"name": getattr(row, "name", None),
				"document_name": getattr(row, "document_name", None),
				"file_name": getattr(row, "file_name", None),
				"document_type": getattr(row, "document_type", None),
				"transaction_no": getattr(row, "transaction_no", None),
				"upload_remarks": getattr(row, "upload_remarks", None),
				"document": getattr(row, "document", None),
			})
		data["documents"] = documents
	except Exception:
		data["documents"] = []

	return data


@frappe.whitelist()
def get_patient_history_summary(patient):
	"""Get counts and invoice summary for Patient History page: visits, admissions, paid totals, unbilled, amount to pay."""
	if not patient:
		frappe.throw(_("Patient is required"))

	# Visit count (excluding cancelled)
	visit_count = frappe.db.count(
		"Patient Visit",
		filters={"patient": patient, "docstatus": ["!=", 2]}
	)

	# Admission count (all statuses)
	admission_count = frappe.db.count(
		"Inpatient Admission",
		filters={"patient": patient}
	)

	billing_allowed = user_can_view_patient_history_billing()

	# Invoice / unbilled stats (only for authorised roles — not computed otherwise)
	paid_invoice_count = 0
	paid_invoice_total = 0.0
	amount_to_pay = 0.0
	unbilled_count = 0

	if billing_allowed:
		try:
			if "patient" in (frappe.db.get_table_columns("Sales Invoice") or []):
				invoices = frappe.get_all(
					"Sales Invoice",
					filters={"patient": patient, "docstatus": 1},
					fields=["name", "grand_total", "outstanding_amount"]
				)
				paid_invoice_count = len(invoices)
				paid_invoice_total = sum((float(inv.grand_total or 0) for inv in invoices))
				amount_to_pay = sum((float(inv.outstanding_amount or 0) for inv in invoices))
		except Exception:
			pass

		try:
			pv_columns = frappe.db.get_table_columns("Patient Visit") or []
			if "invoice_created" in pv_columns:
				unbilled_count = frappe.db.count(
					"Patient Visit",
					filters={"patient": patient, "docstatus": 1, "invoice_created": 0}
				)
			elif "invoiced" in pv_columns:
				unbilled_count = frappe.db.count(
					"Patient Visit",
					filters={"patient": patient, "docstatus": 1, "invoiced": 0}
				)
		except Exception:
			pass

	out = {
		"visit_count": cint(visit_count),
		"admission_count": cint(admission_count),
		"billing_summary_allowed": billing_allowed,
	}
	if billing_allowed:
		out.update(
			{
				"paid_invoice_count": cint(paid_invoice_count),
				"paid_invoice_total": float(paid_invoice_total),
				"unbilled_count": cint(unbilled_count),
				"amount_to_pay": float(amount_to_pay),
			}
		)
	return out
