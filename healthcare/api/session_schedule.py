import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, nowdate

from healthcare.healthcare.editing_lock import assert_editing_allowed

SESSION_SCHEDULE_STATUSES = frozenset(
	{"Draft", "In Progress", "Completed", "Submitted", "Cancelled"}
)

# Link to Healthcare Practitioner → stored display-name field. Legacy/imported
# sessions often keep the practitioner id without the fetched name; the API
# resolves the name from the master so the UI does not show a bare id.
SESSION_SCHEDULE_PRACTITIONER_NAME_FIELDS = {
	"doctor": "doctor_name",
	"practitioner": "practitioner_name",
}


def _existing_session_schedule_sales_order(session_schedule_name):
	return frappe.db.get_value(
		"Sales Order",
		{
			"custom_base_reference": "Session Schedule",
			"custom_base_reference_name": session_schedule_name,
			"docstatus": ["!=", 2],
		},
		"name",
	)


def _attach_sales_orders(schedules):
	if not schedules:
		return schedules

	names = [row["name"] for row in schedules if row.get("name")]
	by_schedule = {}
	if names:
		for row in frappe.get_all(
			"Sales Order",
			filters={
				"custom_base_reference": "Session Schedule",
				"custom_base_reference_name": ["in", names],
				"docstatus": ["!=", 2],
			},
			fields=["name", "custom_base_reference_name"],
			order_by="creation desc",
		):
			by_schedule.setdefault(row.custom_base_reference_name, row.name)

	# invoice_no may still point at a cancelled SO — only reuse if still active.
	stale_invoice_nos = []
	for row in schedules:
		if by_schedule.get(row["name"]):
			continue
		invoice_no = (row.get("invoice_no") or "").strip()
		if invoice_no:
			stale_invoice_nos.append(invoice_no)

	active_invoice_nos = set()
	if stale_invoice_nos:
		active_invoice_nos = set(
			frappe.get_all(
				"Sales Order",
				filters={"name": ["in", list(set(stale_invoice_nos))], "docstatus": ["!=", 2]},
				pluck="name",
			)
		)

	for row in schedules:
		so_name = by_schedule.get(row["name"])
		if not so_name:
			invoice_no = (row.get("invoice_no") or "").strip()
			if invoice_no and invoice_no in active_invoice_nos:
				so_name = invoice_no
		row["sales_order"] = so_name
	return schedules


def _patient_care_type_from_schedule(doc):
	if doc.get("admission_number"):
		return "IP"
	if doc.get("patient_visit"):
		return "OP"
	return None


def _patient_from_schedule_refs(admission_number=None, patient_visit=None):
	"""Resolve Patient from IP admission or OP visit context."""
	admission_number = (admission_number or "").strip() or None
	patient_visit = (patient_visit or "").strip() or None
	if patient_visit and frappe.db.exists("Patient Visit", patient_visit):
		return frappe.db.get_value("Patient Visit", patient_visit, "patient")
	if admission_number and frappe.db.exists("Inpatient Admission", admission_number):
		return frappe.db.get_value("Inpatient Admission", admission_number, "patient")
	return None


def _default_amount_from_template(session_type, amount=None, patient_care_type=None, patient=None):
	"""Template/OP rate, then TRICARE inclusive price + OP/IP discount when patient is insured.

	If the UI stamped the raw template rate, replace it with the insured charge.
	A manually typed amount that differs from the template rate is kept as an override.
	"""
	if not session_type or not frappe.db.exists("Healthcare Service Template", session_type):
		return flt(amount, 2)

	from healthcare.controllers.insurance_pricing import get_patient_insurance, resolve_charge
	from healthcare.healthcare.doctype.healthcare_service_template.healthcare_service_template import (
		get_healthcare_service_template_rate,
	)

	base = flt(
		get_healthcare_service_template_rate(
			template_name=session_type,
			patient_care_type=patient_care_type,
		),
		2,
	)
	submitted = flt(amount, 2)
	service_type = patient_care_type if patient_care_type in ("OP", "IP", "IOP") else None

	_patient_doc, insurance_doc = get_patient_insurance(patient)
	if insurance_doc:
		charged = resolve_charge(
			patient=patient,
			base_rate=base or submitted,
			patient_care_type=patient_care_type,
			template_dt="Healthcare Service Template",
			template_dn=session_type,
			service_type=service_type,
		)
		# Store Inclusive / catalog list price on Session Schedule.amount;
		# insurance % is applied when creating the Sales Order.
		list_rate = flt(charged["rate_before_discount"], 2)
		if submitted <= 0 or (base > 0 and submitted == base):
			return list_rate
		# Also replace if UI previously stamped the net insured charge.
		net_rate = flt(charged["rate"], 2)
		if net_rate > 0 and submitted == net_rate and list_rate != net_rate:
			return list_rate
		return submitted

	if submitted > 0:
		return submitted
	return base


@frappe.whitelist()
def get_session_schedule_amount(
	session_type: str | None = None,
	patient: str | None = None,
	patient_visit: str | None = None,
	admission_number: str | None = None,
	patient_care_type: str | None = None,
):
	"""Return the amount to show when picking a Healthcare Service Template on Session Schedule."""
	session_type = (session_type or "").strip()
	if not session_type:
		return {"amount": 0, "base_rate": 0, "discount_pct": 0, "insurance": None}

	patient = (patient or "").strip() or _patient_from_schedule_refs(admission_number, patient_visit)
	care_type = (patient_care_type or "").strip().upper() or None
	if not care_type:
		care_type = "IP" if (admission_number or "").strip() else "OP"

	from healthcare.controllers.insurance_pricing import resolve_charge
	from healthcare.healthcare.doctype.healthcare_service_template.healthcare_service_template import (
		get_healthcare_service_template_rate,
	)

	base = flt(
		get_healthcare_service_template_rate(
			template_name=session_type,
			patient_care_type=care_type,
		),
		2,
	)
	charged = resolve_charge(
		patient=patient,
		base_rate=base,
		patient_care_type=care_type,
		template_dt="Healthcare Service Template",
		template_dn=session_type,
		service_type=care_type if care_type in ("OP", "IP", "IOP") else None,
	)
	return {
		# Amount shown/stored = list (Inclusive price × multiplier); discount tracked on SO.
		"amount": flt(charged["rate_before_discount"], 2),
		"base_rate": flt(charged["base_rate"], 2),
		"discount_pct": flt(charged["discount_pct"], 2),
		"discount_amount": flt(charged.get("discount_amount") or 0, 2),
		"net_rate": flt(charged["rate"], 2),
		"insurance": charged.get("insurance"),
		"used_insurance_price": charged.get("used_insurance_price"),
		"patient": patient,
		"patient_care_type": care_type,
	}


def _resolve_session_schedule_billing(doc):
	template_name = doc.session_type
	if not template_name or not frappe.db.exists("Healthcare Service Template", template_name):
		frappe.throw(_("Healthcare Service Template is required"))

	template = frappe.get_doc("Healthcare Service Template", template_name)
	item_code = (template.item_code or "").strip()
	if not item_code or not frappe.db.exists("Item", item_code):
		frappe.throw(
			_("Healthcare Service Template {0} has no valid Item for billing.").format(template_name)
		)

	care_type = _patient_care_type_from_schedule(doc)
	patient = (
		doc.get("patient_num")
		or doc.get("patient")
		or _patient_from_schedule_refs(doc.get("admission_number"), doc.get("patient_visit"))
	)
	amount = _default_amount_from_template(
		template_name,
		doc.amount,
		patient_care_type=care_type,
		patient=patient,
	)

	if amount <= 0:
		frappe.throw(_("Amount is required to create a Sales Order."))

	description = doc.session_name or template.service_name or template_name
	return item_code, amount, description, patient


def _session_schedule_billing_refs(doc):
	"""Prefer admission, then visit, else the Session Schedule itself (standalone bill)."""
	admission = (doc.get("admission_number") or "").strip() or None
	visit = (doc.get("patient_visit") or "").strip() or None
	if admission:
		return "Inpatient Admission", admission
	if visit:
		return "Patient Visit", visit
	return "Session Schedule", doc.name


def _default_company(doc=None):
	"""Resolve company for session schedule / billing (single-company sites use default)."""
	if doc and doc.get("company"):
		return doc.company
	if doc and doc.get("admission_number"):
		company = frappe.db.get_value("Inpatient Admission", doc.admission_number, "company")
		if company:
			return company
	if doc and doc.get("patient_visit"):
		company = frappe.db.get_value("Patient Visit", doc.patient_visit, "company")
		if company:
			return company
	return frappe.defaults.get_user_default("company") or frappe.db.get_single_value(
		"Global Defaults", "default_company"
	)


def _create_session_schedule_sales_order(doc):
	existing = _existing_session_schedule_sales_order(doc.name)
	if existing:
		so = frappe.get_doc("Sales Order", existing)
		if cint(so.docstatus) == 0:
			so.flags.ignore_permissions = True
			so.submit()
		status = frappe.db.get_value("Session Schedule", doc.name, "transaction_status")
		return {"sales_order": so.name, "existing": True, "transaction_status": status}

	from healthcare.api.patient_file_no_charge import _ensure_patient_customer
	from healthcare.api.sales_order_cost_center import (
		apply_cost_center_to_sales_order,
		cost_center_from_visit_or_admission,
	)

	item_code, amount, description, patient = _resolve_session_schedule_billing(doc)
	patient = patient or (doc.get("patient_num") or "").strip() or None
	if not patient:
		frappe.throw(
			_("Patient is required to create a Sales Order. Link a patient, visit, or admission on the session.")
		)

	ref_type, ref_name = _session_schedule_billing_refs(doc)
	customer = _ensure_patient_customer(patient)

	company = _default_company(doc)
	if not company:
		frappe.throw(_("Company is required to create a Sales Order."))

	billing_date = getdate(doc.date or nowdate())

	from healthcare.controllers.insurance_pricing import (
		charge_list_and_discount,
		resolve_charge,
		sales_item_from_list_and_discount,
	)

	care_type = _patient_care_type_from_schedule(doc)
	charged = resolve_charge(
		patient=patient,
		base_rate=amount,
		patient_care_type=care_type,
		template_dt="Healthcare Service Template",
		template_dn=doc.session_type,
		service_type=care_type if care_type in ("OP", "IP", "IOP") else None,
	)
	parts = charge_list_and_discount(charged)
	# Prefer session amount as list when it matches insurance/template list; keep overrides.
	list_rate = flt(amount)
	insured_list = flt(parts["list_rate"])
	use_insurance_discount = insured_list > 0 and (
		list_rate <= 0 or abs(list_rate - insured_list) < 0.005
	)
	if use_insurance_discount:
		list_rate = insured_list

	so = frappe.new_doc("Sales Order")
	so.company = company
	so.customer = customer
	so.patient = patient
	if hasattr(so, "custom_patient"):
		so.custom_patient = patient

	patient_name = frappe.db.get_value("Patient", patient, "patient_name")
	if patient_name and hasattr(so, "custom_patient_name"):
		so.custom_patient_name = patient_name

	so.custom_reference_type = ref_type
	so.custom_reference_name = ref_name
	so.custom_base_reference = "Session Schedule"
	so.custom_base_reference_name = doc.name
	so.transaction_date = billing_date
	so.delivery_date = billing_date
	so.ignore_pricing_rule = 1

	so.append(
		"items",
		sales_item_from_list_and_discount(
			item_code=item_code,
			list_rate=list_rate,
			discount_pct=parts["discount_pct"] if use_insurance_discount else 0,
			net_rate=parts["net_rate"] if use_insurance_discount else list_rate,
			description=_("Session Schedule {0}: {1}").format(doc.name, description),
		),
	)

	cc = doc.cost_center or cost_center_from_visit_or_admission(ref_type, ref_name)
	apply_cost_center_to_sales_order(so, cc)
	so.insert(ignore_permissions=True)
	so.flags.ignore_permissions = True
	so.submit()

	doc.db_set("invoice_no", so.name, update_modified=False)
	if doc.transaction_status not in ("Cancelled", "Submitted"):
		doc.db_set("transaction_status", "Submitted", update_modified=False)

	return {"sales_order": so.name, "existing": False, "transaction_status": "Submitted"}


def _backfill_blank_patient_num():
	"""Fill patient_num from visit/admission when it was left blank (older create bug)."""
	frappe.db.sql(
		"""
		UPDATE `tabSession Schedule` ss
		INNER JOIN `tabPatient Visit` pv ON ss.patient_visit = pv.name
		SET ss.patient_num = pv.patient
		WHERE IFNULL(ss.patient_num, '') = ''
			AND IFNULL(ss.patient_visit, '') != ''
			AND IFNULL(pv.patient, '') != ''
		"""
	)
	frappe.db.sql(
		"""
		UPDATE `tabSession Schedule` ss
		INNER JOIN `tabInpatient Admission` ia ON ss.admission_number = ia.name
		SET ss.patient_num = ia.patient
		WHERE IFNULL(ss.patient_num, '') = ''
			AND IFNULL(ss.admission_number, '') != ''
			AND IFNULL(ia.patient, '') != ''
		"""
	)


def _session_schedule_list_fields():
	return [
		"name",
		"date",
		"admission_number",
		"patient_num",
		"patient_visit",
		"session_type",
		"session_name",
		"transaction_status",
		"company",
		"doctor",
		"doctor_name",
		"practitioner",
		"practitioner_name",
		"cost_center",
		"invoice_no",
		"doc_code",
		"doc_remarks",
		"visit_00_05",
		"sr_num",
		"from_time",
		"to_time",
		"amount",
	]


@frappe.whitelist()
def get_session_schedules(
	limit: int = 50,
	offset: int = 0,
	patient: str = None,
	admission_number: str = None,
	role_group: str = None,
	practitioner: str = None,
):
	"""Fetch session schedules with optional filtering by patient or admission number.

	role_group ('Doctor' / 'Nurse' / 'Consultant' / ...) limits rows to sessions whose
	assigned practitioner's Medical Role falls under that group — plus unassigned
	sessions, so nothing scheduled but not yet assigned disappears.

	practitioner filters by Session Schedule.practitioner (who entered the session).
	"""
	_backfill_blank_patient_num()

	filters = {}
	patient = (patient or "").strip() or None
	admission_number = (admission_number or "").strip() or None
	practitioner = (practitioner or "").strip() or None
	role_group = (role_group or "").strip() or None

	if admission_number:
		filters["admission_number"] = admission_number
	if practitioner:
		filters["practitioner"] = practitioner

	patient_or_filters = None
	if patient:
		visit_names = frappe.get_all(
			"Patient Visit",
			filters={"patient": patient},
			pluck="name",
		) or []
		admission_names = frappe.get_all(
			"Inpatient Admission",
			filters={"patient": patient},
			pluck="name",
		) or []
		patient_or_filters = [["patient_num", "=", patient]]
		if visit_names:
			patient_or_filters.append(["patient_visit", "in", visit_names])
		if admission_names:
			patient_or_filters.append(["admission_number", "in", admission_names])

	role_or_filters = None
	if role_group:
		from healthcare.api.common import get_medical_roles_under

		roles = list(get_medical_roles_under(role_group))
		practitioners = frappe.get_all(
			"Healthcare Practitioner",
			filters={"medical_role": ["in", roles]},
			pluck="name",
		) or ["__none__"]
		role_or_filters = [
			["doctor", "in", practitioners],
			["doctor", "is", "not set"],
		]

	fetch_limit = limit
	fetch_offset = offset
	or_filters = None

	if patient_or_filters and role_or_filters:
		# get_list can't AND two or_filter groups — over-fetch by patient, then role-filter.
		or_filters = patient_or_filters
		fetch_limit = max(limit * 10, 200)
		fetch_offset = 0
	elif patient_or_filters:
		or_filters = patient_or_filters
	elif role_or_filters:
		or_filters = role_or_filters

	schedules = frappe.get_list(
		"Session Schedule",
		filters=filters,
		or_filters=or_filters,
		fields=_session_schedule_list_fields(),
		limit_page_length=fetch_limit,
		limit_start=fetch_offset,
		order_by="date desc",
	)

	if patient_or_filters and role_or_filters:
		allowed_doctors = set()
		for row in role_or_filters:
			if row[0] == "doctor" and row[1] == "in":
				allowed_doctors.update(row[2] or [])
		schedules = [
			row
			for row in schedules
			if not row.get("doctor") or row.get("doctor") in allowed_doctors
		]
		total_count = len(schedules)
		schedules = schedules[offset : offset + limit]
	else:
		total_count = len(
			frappe.get_list(
				"Session Schedule",
				filters=filters,
				or_filters=or_filters,
				pluck="name",
			)
		)

	from healthcare.api.common import fill_missing_practitioner_names

	fill_missing_practitioner_names(schedules, SESSION_SCHEDULE_PRACTITIONER_NAME_FIELDS)

	patient_ids = {row["patient_num"] for row in schedules if row.get("patient_num")}
	if patient_ids and frappe.has_permission("Patient", "read"):
		patients = frappe.get_list(
			"Patient",
			filters={"name": ["in", sorted(patient_ids)]},
			fields=["name", "patient_name"],
			limit_page_length=len(patient_ids),
		)
		patient_names = {row["name"]: row["patient_name"] for row in patients}
		for row in schedules:
			row["patient_name"] = patient_names.get(row.get("patient_num"))

	return {
		"data": _attach_sales_orders(schedules),
		"total_count": int(total_count or 0),
	}


def _apply_session_schedule_fields(session_schedule, data, *, billed=False):
	"""Map portal payload onto a Session Schedule. Billing fields stay frozen once billed."""
	admission_number = (data.get("admission_number") or "").strip() or None
	patient_visit = (data.get("patient_visit") or "").strip() or None
	explicit_patient = (data.get("patient") or data.get("patient_num") or "").strip() or None
	care_type = "IP" if admission_number else ("OP" if patient_visit else None)

	if data.get("date"):
		session_schedule.date = data.get("date")

	if not billed:
		if data.get("session_type"):
			session_schedule.session_type = data.get("session_type")
		if "session_name" in data:
			session_schedule.session_name = data.get("session_name")

	if "doctor" in data:
		session_schedule.doctor = data.get("doctor") or None

	if "practitioner" in data:
		practitioner = (data.get("practitioner") or "").strip()
		session_schedule.practitioner = practitioner or None
		if practitioner:
			session_schedule.practitioner_name = (
				data.get("practitioner_name")
				or frappe.db.get_value("Healthcare Practitioner", practitioner, "practitioner_name")
				or practitioner
			)
		else:
			session_schedule.practitioner_name = None

	if "cost_center" in data:
		session_schedule.cost_center = data.get("cost_center") or None
	if "from_time" in data:
		session_schedule.from_time = data.get("from_time") or None
	if "to_time" in data:
		session_schedule.to_time = data.get("to_time") or None
	if "doc_remarks" in data:
		session_schedule.doc_remarks = data.get("doc_remarks") or None

	session_schedule.admission_number = admission_number
	session_schedule.patient_visit = patient_visit
	if not session_schedule.company:
		session_schedule.company = _default_company(session_schedule)

	patient = (
		_patient_from_schedule_refs(admission_number, patient_visit)
		or explicit_patient
		or session_schedule.get("patient_num")
	)
	if patient:
		# patient_num is read_only on the form; set it in code so list filters work.
		session_schedule.patient_num = patient
	else:
		frappe.throw(
			_("Select a patient (or link a Patient Visit / Admission) before saving a session schedule.")
		)

	if not billed:
		session_schedule.amount = _default_amount_from_template(
			session_schedule.session_type,
			data.get("amount"),
			patient_care_type=care_type,
			patient=patient,
		) or None


@frappe.whitelist()
def create_session_schedule(data: dict):
	"""Create a new Session Schedule record."""
	if not data:
		frappe.throw(_("No data provided"))

	try:
		session_schedule = frappe.new_doc("Session Schedule")
		_apply_session_schedule_fields(session_schedule, data, billed=False)
		session_schedule.transaction_status = "Draft"
		session_schedule.insert(ignore_permissions=True)
		frappe.db.commit()

		row = session_schedule.as_dict()
		return _attach_sales_orders([row])[0]
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "create_session_schedule")
		frappe.throw(str(e))


@frappe.whitelist()
def update_session_schedule(session_schedule_name: str, data: dict):
	"""Update an existing Session Schedule record."""
	assert_editing_allowed()
	if not session_schedule_name:
		frappe.throw(_("Session Schedule name is required"))
	if not data:
		frappe.throw(_("No data provided"))
	if not frappe.db.exists("Session Schedule", session_schedule_name):
		frappe.throw(_("Session Schedule {0} not found").format(session_schedule_name))

	session_schedule = frappe.get_doc("Session Schedule", session_schedule_name)
	status = (session_schedule.transaction_status or "").strip()
	if status in {"Cancelled", "Submitted"}:
		frappe.throw(_("Cancelled or submitted session schedules cannot be edited."))

	try:
		billed = bool(_existing_session_schedule_sales_order(session_schedule.name))
		_apply_session_schedule_fields(session_schedule, data, billed=billed)
		session_schedule.save(ignore_permissions=True)
		frappe.db.commit()
		row = session_schedule.as_dict()
		return _attach_sales_orders([row])[0]
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "update_session_schedule")
		frappe.throw(str(e))


@frappe.whitelist()
def create_sales_order_from_session_schedule(session_schedule_name: str):
	"""Bill a Session Schedule (create or return linked Sales Order)."""
	if not session_schedule_name:
		frappe.throw(_("Session Schedule name is required"))

	if not frappe.db.exists("Session Schedule", session_schedule_name):
		frappe.throw(_("Session Schedule {0} not found").format(session_schedule_name))

	doc = frappe.get_doc("Session Schedule", session_schedule_name)
	result = _create_session_schedule_sales_order(doc)
	frappe.db.commit()
	row = doc.as_dict()
	result.update(_attach_sales_orders([row])[0])
	return result


@frappe.whitelist()
def update_session_schedule_status(session_schedule_name: str, status: str):
	"""Update the status of a Session Schedule."""
	assert_editing_allowed()
	if not session_schedule_name or not status:
		frappe.throw(_("Session Schedule name and status are required"))

	status = (status or "").strip()
	if status not in SESSION_SCHEDULE_STATUSES:
		frappe.throw(_("Invalid status: {0}").format(status))

	session_schedule = frappe.get_doc("Session Schedule", session_schedule_name)
	if session_schedule.transaction_status == "Cancelled" and status != "Cancelled":
		frappe.throw(_("Cancelled session schedules cannot be reactivated."))

	session_schedule.transaction_status = status
	session_schedule.save(ignore_permissions=True)
	frappe.db.commit()

	row = session_schedule.as_dict()
	return _attach_sales_orders([row])[0]


def _draft_zero_amount_schedules():
	"""Draft Session Schedules with amount ≤ 0 and a Healthcare Service Template."""
	return frappe.get_all(
		"Session Schedule",
		filters={
			"transaction_status": "Draft",
			"session_type": ["is", "set"],
			"amount": ["<=", 0],
		},
		fields=[
			"name",
			"session_type",
			"session_name",
			"amount",
			"admission_number",
			"patient_visit",
			"patient_num",
		],
		limit_page_length=0,
		order_by="modified desc",
	)


def _plan_session_schedule_price_updates(sample_limit: int = 25) -> dict:
	"""Draft + amount 0 → template IP rate (admission) or OP rate (patient visit)."""
	from healthcare.healthcare.doctype.healthcare_service_template.healthcare_service_template import (
		get_healthcare_service_template_rate,
	)

	rows = _draft_zero_amount_schedules()
	# get_all or_filters with amount can still return non-zero on some DBs — enforce in Python.
	rows = [row for row in rows if flt(row.get("amount")) <= 0]

	to_update: list[dict] = []
	skipped_no_rate = 0
	skipped_other = 0
	sample: list[dict] = []

	for row in rows:
		care_type = _patient_care_type_from_schedule(row)
		template = (row.get("session_type") or "").strip()
		if not care_type or not template:
			skipped_other += 1
			continue
		if not frappe.db.exists("Healthcare Service Template", template):
			skipped_other += 1
			continue

		rate = flt(
			get_healthcare_service_template_rate(
				template_name=template,
				patient_care_type=care_type,
			),
			2,
		)
		if rate <= 0:
			skipped_no_rate += 1
			continue

		payload = {
			"name": row.name,
			"session_type": template,
			"session_name": row.get("session_name"),
			"care_type": care_type,
			"amount": rate,
		}
		to_update.append(payload)
		if len(sample) < sample_limit:
			sample.append(payload)

	return {
		"candidates": len(rows),
		"to_update": len(to_update),
		"skipped_no_rate": skipped_no_rate,
		"skipped_other": skipped_other,
		"sample": sample,
		"updates": to_update,
	}


@frappe.whitelist()
def preview_update_session_schedule_prices():
	"""Preview Draft Session Schedules whose amount is 0 and can be filled from the template."""
	plan = _plan_session_schedule_price_updates()
	plan.pop("updates", None)
	return plan


@frappe.whitelist()
def update_session_schedule_prices():
	"""Set amount on Draft Session Schedules that are still 0 from Healthcare Service Template IP/OP rate."""
	assert_editing_allowed()
	plan = _plan_session_schedule_price_updates()
	updated = 0
	for row in plan.get("updates") or []:
		frappe.db.set_value(
			"Session Schedule",
			row["name"],
			"amount",
			row["amount"],
			update_modified=True,
		)
		updated += 1
	frappe.db.commit()

	message = _(
		"Updated {0} Draft Session Schedule(s).\n"
		"Candidates with amount 0: {1}\n"
		"Skipped (no IP/OP rate on template): {2}\n"
		"Skipped (no care type / template): {3}."
	).format(
		updated,
		plan.get("candidates") or 0,
		plan.get("skipped_no_rate") or 0,
		plan.get("skipped_other") or 0,
	)
	return {
		"ok": True,
		"updated": updated,
		"candidates": plan.get("candidates") or 0,
		"skipped_no_rate": plan.get("skipped_no_rate") or 0,
		"skipped_other": plan.get("skipped_other") or 0,
		"message": message,
	}
