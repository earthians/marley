# -*- coding: utf-8 -*-
# Copyright (c) 2025, Healthcare and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, nowdate, strip_html

from healthcare.api.portal_errors import portal_mandatory_message, portal_validation_message
from healthcare.api.sales_order_cost_center import (
	apply_cost_center_to_sales_order,
	cost_center_from_service_request,
)
from healthcare.healthcare.editing_lock import assert_editing_allowed

LAB_SERVICE_REQUEST_ALLOWED_ROLES = {
	"Doctor",
	"System Manager",
	"Healthcare Administrator",
	"Administrator",
}


def _practitioner_display_name(practitioner):
	"""Full name for Healthcare Practitioner. Never fall back to the document id."""
	practitioner = (practitioner or "").strip()
	if not practitioner:
		return None
	row = frappe.db.get_value(
		"Healthcare Practitioner",
		practitioner,
		["practitioner_name", "first_name", "last_name"],
		as_dict=True,
	)
	if not row:
		return None
	full = (row.get("practitioner_name") or "").strip()
	if full and full != practitioner:
		return full
	composed = " ".join(
		p for p in [(row.get("first_name") or "").strip(), (row.get("last_name") or "").strip()] if p
	).strip()
	if composed:
		return composed
	if full:
		return full
	return None


def _collect_lab_template_names_for_permission(
	template_dn=None, lab_request_items=None, selected_group_templates=None
):
	"""Gather all Lab Test Template names involved in a create/update payload."""
	names = set()
	if template_dn:
		names.add(str(template_dn).strip())
	for item in lab_request_items or []:
		if not isinstance(item, dict):
			continue
		kind = (item.get("kind") or "").strip().lower()
		if kind == "single":
			t = (item.get("template") or "").strip()
			if t:
				names.add(t)
		elif kind == "group":
			parent = (item.get("parent") or "").strip()
			if parent:
				names.add(parent)
			for child in item.get("children") or []:
				c = str(child).strip()
				if c:
					names.add(c)
		else:
			for key in ("template", "parent", "group_template"):
				v = (item.get(key) or "").strip()
				if v:
					names.add(v)
			for child in item.get("children") or item.get("templates") or []:
				c = str(child).strip()
				if c:
					names.add(c)
	for t in selected_group_templates or []:
		if t:
			names.add(str(t).strip())
	return {n for n in names if n}


def _get_template_base_rate(template_dt: str, template_dn: str, patient_care_type: str | None = None) -> float:
    """Resolve base rate from template document safely.

    Healthcare Service Template (OP): ``op_rate`` when > 0, else ``rate``.
    Healthcare Service Template (IP): ``rate``.
    Lab Test Template (OP): ``op_rate`` when > 0, else ``lab_test_rate`` / ``rate`` / ``amount``.
    Lab Test Template (IP): ``lab_test_rate`` / ``rate`` / ``amount``.
    """

    if template_dt == "Healthcare Service Template":
        from healthcare.healthcare.doctype.healthcare_service_template.healthcare_service_template import (
            get_healthcare_service_template_rate,
        )

        return get_healthcare_service_template_rate(
            template_name=template_dn,
            patient_care_type=patient_care_type,
        )

    meta = frappe.get_meta(template_dt)
    is_op_lab = template_dt == "Lab Test Template" and (patient_care_type or "").strip().upper() == "OP"

    possible_fields = (["op_rate"] if is_op_lab else []) + ["lab_test_rate", "rate", "amount"]
    existing_fields = [f for f in possible_fields if meta.has_field(f)]

    base = {}

    if existing_fields:
        base = frappe.db.get_value(
            template_dt,
            template_dn,
            existing_fields,
            as_dict=True,
        ) or {}

    for field in possible_fields:
        if field in base and base.get(field):
            return float(base[field])

    # fallback to Service Pricing
    first_pricing = frappe.get_all(
        "Service Pricing",
        filters={"parent": template_dn, "parenttype": template_dt},
        fields=["price"],
        order_by="idx asc",
        limit=1,
        ignore_permissions=True,
    )

    if first_pricing and first_pricing[0].get("price"):
        return float(first_pricing[0]["price"])

    return 0.0


def _resolve_patient_care_type(
	patient_care_type: str | None = None,
	patient_visit: str | None = None,
	inpatient_record: str | None = None,
) -> str | None:
	"""Normalize OP/IP from explicit care type or visit/admission context (pricing only)."""
	explicit = (patient_care_type or "").strip().upper()
	if explicit in ("OP", "IP"):
		return explicit
	if patient_visit:
		return "OP"
	if inpatient_record:
		return "IP"
	return None


def _service_request_care_type_link(value) -> str | None:
	"""Service Request.patient_care_type is a Link to Patient Care Type (not OP/IP)."""
	text = (value or "").strip()
	if not text or text.upper() in ("OP", "IP"):
		return None
	if frappe.db.exists("Patient Care Type", text):
		return text
	return None


def _lab_template_list_rate(row: dict, patient_care_type: str | None = None) -> float:
	"""Pick OP (op_rate) or IP (lab_test_rate) list price for a Lab Test Template row."""
	care = (patient_care_type or "").strip().upper()
	op = flt(row.get("op_rate") or 0)
	ip = flt(row.get("lab_test_rate") or 0)
	if care == "OP":
		return op if op > 0 else ip
	return ip if ip > 0 else op
# def _get_template_base_rate(template_dt: str, template_dn: str) -> float:
# 	"""Resolve base rate from template document."""
# 	base = frappe.db.get_value(
# 		template_dt,
# 		template_dn,
# 		["lab_test_rate", "rate", "amount"],
# 		as_dict=True,
# 	) or {}
# 	base = base.get("lab_test_rate") or base.get("rate") or base.get("amount")
# 	if base:
# 		return float(base)

# 	# Backward compatibility: if no single base-rate field exists, use first pricing row.
# 	first_pricing = frappe.get_all(
# 		"Service Pricing",
# 		filters={"parent": template_dn, "parenttype": template_dt},
# 		fields=["price"],
# 		order_by="idx asc",
# 		limit=1,
# 		ignore_permissions=True,
# 	)
# 	if first_pricing and first_pricing[0].get("price"):
# 		return float(first_pricing[0]["price"])

# 	return 0.0


def _get_patient_category_multipliers():
	"""Return patient-category multipliers from Healthcare Settings."""
	settings = frappe.get_cached_doc("Healthcare Settings")
	rows = []
	for row in (settings.get("patient_category_pricing") or []):
		category = getattr(row, "patient_category", None)
		if not category:
			continue
		multiplier = float(getattr(row, "multiplier", None) or 0)
		if multiplier <= 0:
			continue
		rows.append(
			{
				"patient_category": category,
				"multiplier": multiplier,
			}
		)
	return rows


def _build_pricing_rows_for_template(
	template_dt: str,
	template_dn: str,
	patient_care_type: str | None = None,
	patient: str | None = None,
):
	from healthcare.controllers.insurance_pricing import resolve_charge, should_apply_category_multiplier

	base_rate = _get_template_base_rate(template_dt, template_dn, patient_care_type)
	apply_mult = should_apply_category_multiplier(patient) if patient else True
	rows = []
	for row in _get_patient_category_multipliers():
		mult = row["multiplier"] if apply_mult else 1.0
		charged = resolve_charge(
			patient=patient,
			base_rate=base_rate,
			patient_care_type=patient_care_type,
			template_dt=template_dt,
			template_dn=template_dn,
			multiplier=mult,
		)
		list_price = (
			charged["rate_before_discount"]
			if base_rate or charged["used_insurance_price"]
			else 0.0
		)
		rows.append(
			{
				"patient_category": row["patient_category"],
				"multiplier": mult,
				# Catalog / Inclusive list price (before insurance %). Net is rate.
				"price": list_price,
				"rate": charged["rate"],
				"discount_pct": charged["discount_pct"],
				"discount_amount": charged.get("discount_amount") or 0.0,
				"base_rate": charged["base_rate"],
				"insurance": charged["insurance"],
			}
		)
	# When there are no category rows, still return a single effective price for the patient.
	if not rows and (base_rate or patient):
		charged = resolve_charge(
			patient=patient,
			base_rate=base_rate,
			patient_care_type=patient_care_type,
			template_dt=template_dt,
			template_dn=template_dn,
			multiplier=1.0,
		)
		rows.append(
			{
				"patient_category": None,
				"multiplier": 1.0,
				"price": charged["rate_before_discount"],
				"rate": charged["rate"],
				"discount_pct": charged["discount_pct"],
				"discount_amount": charged.get("discount_amount") or 0.0,
				"base_rate": charged["base_rate"],
				"insurance": charged["insurance"],
			}
		)
	return rows


def _ensure_lab_service_request_create_permission(template_dt, template_names=None):
	if template_dt != "Lab Test Template":
		return

	user_roles = set(frappe.get_roles(frappe.session.user))
	if user_roles.intersection(LAB_SERVICE_REQUEST_ALLOWED_ROLES):
		return

	if "Nurse" in user_roles:
		names = list(template_names or [])
		if not names:
			frappe.throw(_("Lab test template is required."), frappe.ValidationError)
		non_nurse = []
		for name in names:
			if not frappe.db.exists("Lab Test Template", name):
				frappe.throw(
					_("Lab Test Template {0} not found").format(name),
					frappe.ValidationError,
				)
			if not cint(frappe.db.get_value("Lab Test Template", name, "by_nurse")):
				non_nurse.append(name)
		if non_nurse:
			frappe.throw(
				_(
					"Nurses can only create Lab Service Requests for By Nurse templates. Not allowed: {0}"
				).format(", ".join(non_nurse)),
				frappe.PermissionError,
			)
		return

	frappe.throw(
		_(
			"Only users with Doctor, System Manager, or Healthcare Administrator roles can create Lab Service Requests."
		),
		frappe.PermissionError,
	)


@frappe.whitelist(allow_guest=False)
def get_lab_test_template_pricing(template):
	"""Return computed pricing rows for a Lab Test Template."""
	if not template:
		return []
	if not frappe.db.exists('Lab Test Template', template):
		return []
	return _build_pricing_rows_for_template("Lab Test Template", template)


@frappe.whitelist(allow_guest=False)
def get_lab_test_template_info(template):
	"""
	Return full pricing info for a Lab Test Template.
	For group templates, returns child template details and their pricing.
	For regular templates, returns the pricing table.
	"""
	if not template:
		return {'is_group': False, 'pricing': []}
	if not frappe.db.exists('Lab Test Template', template):
		return {'is_group': False, 'pricing': []}

	is_group = frappe.db.get_value('Lab Test Template', template, 'is_group')

	if not is_group:
		pricing = _build_pricing_rows_for_template("Lab Test Template", template)
		return {'is_group': False, 'pricing': pricing}

	# Group template — fetch each child template with its own pricing
	group_rows = frappe.get_all(
		'Lab Test Group Template',
		filters={
			'parent': template,
			'parenttype': 'Lab Test Template',
			'template_or_new_line': 'Add Test'
		},
		fields=['lab_test_template'],
		order_by='idx asc',
		ignore_permissions=True
	)

	group_templates = []
	for row in group_rows:
		if not row.lab_test_template:
			continue
		lab_test_name = frappe.db.get_value('Lab Test Template', row.lab_test_template, 'lab_test_name') or row.lab_test_template
		pricing = _build_pricing_rows_for_template("Lab Test Template", row.lab_test_template)
		group_templates.append({
			'lab_test_template': row.lab_test_template,
			'lab_test_name': lab_test_name,
			'pricing': pricing,
		})

	return {'is_group': True, 'group_templates': group_templates}


@frappe.whitelist(allow_guest=False)
def get_multi_lab_request_pricing(items, patient=None, patient_care_type=None):
	"""Return pricing breakdown for a multi-line lab basket."""
	from healthcare.healthcare.lab_request_items import (
		apply_discounts_to_specs,
		expand_lab_test_specs,
		lab_request_items_summary,
	)

	if isinstance(items, str):
		try:
			items = json.loads(items)
		except Exception:
			items = []
	if not isinstance(items, list):
		items = []

	if not patient:
		return {"lines": [], "subtotal": 0, "summary": ""}

	specs = expand_lab_test_specs(items, patient, patient_care_type=patient_care_type)
	specs = apply_discounts_to_specs(specs, items)
	lines = []
	subtotal = 0.0
	grand_total = 0.0
	discount_amount = 0.0
	for spec in specs:
		amount = float(spec.get("amount") or 0)
		net = float(spec.get("net_amount") if spec.get("net_amount") is not None else amount)
		applied = float(
			spec.get("discount_applied")
			if spec.get("discount_applied") is not None
			else (amount - net)
		)
		subtotal += amount
		grand_total += net
		discount_amount += applied
		tpl = spec.get("template")
		parent_group = spec.get("parent_group")
		parent_group_name = None
		if parent_group:
			parent_group_name = (
				frappe.db.get_value("Lab Test Template", parent_group, "lab_test_name") or parent_group
			)
		lab_test_name = frappe.db.get_value("Lab Test Template", tpl, "lab_test_name") or tpl
		# When children are free and the parent group carries the rate, label that line clearly.
		if spec.get("billed_from_parent_group") and parent_group_name:
			lab_test_name = f"{parent_group_name} (group charge)"
		lines.append(
			{
				"template": tpl,
				"lab_test_name": lab_test_name,
				"parent_group": parent_group,
				"parent_group_name": parent_group_name,
				"amount": amount,
				"discount_type": spec.get("discount_type") or "Percentage",
				"discount_rate": float(spec.get("discount_rate") or 0),
				"discount": float(spec.get("discount") or 0),
				"discount_applied": applied,
				"net_amount": net,
				"billed_from_parent_group": 1 if spec.get("billed_from_parent_group") else 0,
				"billing_only": 1 if spec.get("billing_only") else 0,
				"price_included_in_group": 1 if spec.get("price_included_in_group") else 0,
			}
		)
	return {
		"lines": lines,
		"subtotal": subtotal,
		"grand_total": grand_total,
		"discount_amount": discount_amount,
		"summary": lab_request_items_summary(items),
	}


@frappe.whitelist(allow_guest=False)
# def get_service_request_template_pricing(template_dt, template_dn):
# 	"""
# 	Return Service Pricing rows for any service request template type.
# 	For Lab Test Templates that are groups, also returns child template pricing breakdowns.
# 	All templates now share the 'service_pricing' child table (linked to Service Pricing doctype).
# 	"""
# 	if not template_dt or not template_dn:
# 		return {'is_group': False, 'pricing': [], 'group_templates': []}

# 	if not frappe.db.exists(template_dt, template_dn):
# 		return {'is_group': False, 'pricing': [], 'group_templates': []}

# 	def get_pricing(parent, parenttype=''):
# 		return frappe.get_all(
# 			'Service Pricing',
# 			filters={'parent': parent, 'parenttype': parenttype or template_dt},
# 			fields=['patient_category', 'price'],
# 			order_by='idx asc',
# 			ignore_permissions=True,
# 		)

# 	# Lab Test Template — handle group templates specially
# 	if template_dt == 'Lab Test Template':
# 		is_group = frappe.db.get_value('Lab Test Template', template_dn, 'is_group')
# 		if is_group:
# 			group_rows = frappe.get_all(
# 				'Lab Test Group Template',
# 				filters={
# 					'parent': template_dn,
# 					'parenttype': 'Lab Test Template',
# 					'template_or_new_line': 'Add Test',
# 				},
# 				fields=['lab_test_template'],
# 				order_by='idx asc',
# 				ignore_permissions=True,
# 			)
# 			group_templates = []
# 			for row in group_rows:
# 				if not row.lab_test_template:
# 					continue
# 				label = (
# 					frappe.db.get_value('Lab Test Template', row.lab_test_template, 'lab_test_name')
# 					or row.lab_test_template
# 				)
# 				group_templates.append({
# 					'template_dn': row.lab_test_template,
# 					'template_label': label,
# 					'pricing': get_pricing(row.lab_test_template, 'Lab Test Template'),
# 				})
# 			return {'is_group': True, 'pricing': [], 'group_templates': group_templates}

# 	# Regular / all other template types
# 	pricing = get_pricing(template_dn)
# 	return {'is_group': False, 'pricing': pricing, 'group_templates': []}

@frappe.whitelist(allow_guest=False)
def get_service_request_template_pricing(template_dt, template_dn, patient_care_type=None, patient=None):
	"""
	Return computed pricing rows for any service request template type.

	When ``patient`` is insured (e.g. TRICARE):
	- uses Inclusive Item price when set
	- applies outpatient/inpatient % (0% = no discount)
	- category multiplier only if Healthcare Settings Apply Multiplier on Insurance is on
	"""
	if not template_dt or not template_dn:
		return {'is_group': False, 'pricing': [], 'group_templates': []}

	if not frappe.db.exists(template_dt, template_dn):
		return {'is_group': False, 'pricing': [], 'group_templates': []}

	# Lab Test Template — handle group templates specially
	if template_dt == 'Lab Test Template':
		is_group = frappe.db.get_value('Lab Test Template', template_dn, 'is_group')
		if is_group:
			# Find all child lab test templates where lab_group equals the current template_dn
			child_templates = frappe.get_all(
				'Lab Test Template',
				filters={
					'lab_group': template_dn,
					'disabled': 0  # Only get enabled templates
				},
				fields=['name', 'lab_test_name', 'price_included_in_group'],
				order_by='lab_test_name asc',
				ignore_permissions=True,
			)

			group_templates = []
			for child in child_templates:
				if not child.name:
					continue
				label = child.lab_test_name or child.name
				included = cint(child.get('price_included_in_group'))
				child_pricing = _build_pricing_rows_for_template(
					'Lab Test Template', child.name, patient_care_type, patient=patient
				)
				# Included-in-group children show 0 for basket UI (covered by parent).
				if included:
					child_pricing = [
						{**row, 'price': 0} if isinstance(row, dict) else row
						for row in (child_pricing or [])
					]
				group_templates.append({
					'template_dn': child.name,
					'template_label': label,
					'price_included_in_group': included,
					'pricing': child_pricing,
				})
			# Parent group rate — always included in the group total.
			parent_pricing = _build_pricing_rows_for_template(
				'Lab Test Template', template_dn, patient_care_type, patient=patient
			)
			return {
				'is_group': True,
				'pricing': parent_pricing,
				'group_templates': group_templates,
				'parent_template_dn': template_dn,
			}
		else:
			# Regular lab test template (not a group)
			pricing = _build_pricing_rows_for_template(
				template_dt, template_dn, patient_care_type, patient=patient
			)
			return {'is_group': False, 'pricing': pricing, 'group_templates': []}

	# Regular / all other template types
	pricing = _build_pricing_rows_for_template(
		template_dt, template_dn, patient_care_type, patient=patient
	)
	return {'is_group': False, 'pricing': pricing, 'group_templates': []}


def _lab_request_template_names(sr, items) -> list[str]:
	"""Parent, child, and single template codes on a Lab Request."""
	names: list[str] = []
	for item in items or []:
		kind = (item.get("kind") or "").strip().lower()
		if kind == "group":
			parent = (item.get("parent") or "").strip()
			if parent:
				names.append(parent)
			names.extend([c for c in (item.get("children") or []) if c])
		else:
			tpl = (item.get("template") or "").strip()
			if tpl:
				names.append(tpl)
	fallback = (sr.get("template_dn") or "").strip()
	if fallback and fallback not in names:
		names.append(fallback)
	return names


def _display_unconfirmed_request_on_lab_page() -> bool:
	"""True when Healthcare Settings allows not-yet-booked Lab Requests in the Lab page.

	Healthcare Settings is a Single, so the value comes from ``tabSingles`` (a Single
	has no table of its own — ``has_column`` would raise ``TableMissingError``). The
	field is added by a migration; on a site where it has not been synced yet the
	lookup simply returns ``None`` and the Lab page keeps the old (booked only)
	behaviour.
	"""
	try:
		return bool(
			cint(
				frappe.db.get_single_value(
					"Healthcare Settings", "display_unconfirmed_request_on_lab_page"
				)
			)
		)
	except Exception:
		return False


def _compute_lab_request_virtual_status(sr) -> str:
	"""Compute UI-only virtual status for a Lab Test Service Request.

	Statuses (computed from linked Lab Test records):
	  - ``booked``                   — no Lab Tests linked yet (shown as New Request)
	  - ``sample-collected``         — all linked Lab Tests have samples collected
	  - ``partial-sample-collected`` — some samples collected, none have results
	  - ``partial-results``          — at least one test has results, not all
	  - ``pending-review``          — all tests at review stage, not all reviewed/rejected
	  - ``reviewed``                — all tests Reviewed / Approved
	  - ``rejected``                — all tests Rejected
	"""
	lab_tests = frappe.get_all(
		"Lab Test",
		filters={"service_request": sr.get("name")},
		fields=["name", "status", "docstatus", "custom_result", "sample"],
		ignore_permissions=True,
	)
	if not lab_tests:
		return "booked"

	reviewed_like = {"Reviewed", "Approved", "Completed"}
	rejected_like = {"Rejected"}
	pending_review_like = {"Pending Review"}
	review_stage = reviewed_like | rejected_like | pending_review_like

	statuses = [(lt.get("status") or "").strip() for lt in lab_tests]
	total = len(lab_tests)
	sample_done = 0
	result_done = 0
	for lt, status_str in zip(lab_tests, statuses):
		# Sample considered done when linked to a Sample Collection OR status progressed past pre-sample
		if lt.get("sample") or status_str in (
			"Sample Collected",
			"Sample collection in progress",
			"Testing in Progress",
			"Testing in progress",
			"Pending Review",
			"Reviewed",
			"Rejected",
			"Completed",
			"Approved",
			"Partial Result Enter",
		):
			sample_done += 1
		has_result = status_str in (
			"Pending Review",
			"Reviewed",
			"Rejected",
			"Completed",
			"Approved",
			"Partial Result Enter",
		) or bool((lt.get("custom_result") or "").strip())
		if has_result:
			result_done += 1

	all_at_review = total > 0 and all(s in review_stage for s in statuses)
	all_have_results = result_done == total
	if all_at_review or all_have_results:
		if all(s in rejected_like for s in statuses):
			return "rejected"
		if all(s in reviewed_like for s in statuses):
			return "reviewed"
		return "pending-review"

	if result_done > 0:
		return "partial-results"
	if sample_done == total:
		return "sample-collected"
	if sample_done > 0:
		return "partial-sample-collected"
	return "booked"


@frappe.whitelist()
def get_service_requests(
	limit=50,
	offset=0,
	patient=None,
	template_dt=None,
	status=None,
	search=None,
	practitioner=None,
	patient_search=None,
	patient_visit=None,
	inpatient_record=None,
	booked=None,
	patient_care_type=None,
	virtual_status=None,
	cost_center=None,
	include_hidden_from_ui=None,
	include_unconfirmed=None,
):
	"""Get list of Service Requests.

	Optional ``patient_search``: when ``patient`` is not set, narrows to Service Requests
	whose patient id or patient_name matches (contains) the search string.
	Optional ``booked``: when set (0/1/true/false), filter by Service Request.booked.
	Optional ``patient_care_type`` (OP/IP): when no specific visit/admission is passed,
	hide the other care type (OP → no inpatient_record; IP → inpatient_record set).
	Optional ``cost_center``: portal branch filter from the top navbar (UI-only).
	Optional ``include_hidden_from_ui``: audit / export escape hatch. Lab Test Template
	listings (Lab page → Lab Request tab, nurse lab request card) never return Service
	Requests flagged *Hide from UI* unless this is passed as 1.
	Optional ``include_unconfirmed``: Lab page only. When Healthcare Settings →
	*Display Unconfirmed Request on Lab Page* is on, the ``booked`` filter is dropped
	and requests that are not forwarded to the lab yet (no Lab Tests) are returned
	too, flagged ``unconfirmed`` (tests only in the portal). Ignored when
	the setting is off.
	"""
	from healthcare.api.common import resolve_cost_center_filter

	# Lab page → "Display Unconfirmed Request on Lab Page": also return Lab Requests
	# whose payment has not been confirmed yet. The setting is the single source of
	# truth, so a stale portal flag can never leak unpaid requests into the listing.
	show_unconfirmed = bool(
		cint(include_unconfirmed)
		and template_dt == 'Lab Test Template'
		and _display_unconfirmed_request_on_lab_page()
	)

	filters = {'docstatus': ['!=', 2]}

	# Service Requests flagged "Hide from UI" must not appear in any Lab Request
	# listing — neither as rows nor in ``total_count`` (both use these filters).
	if template_dt == 'Lab Test Template' and not cint(include_hidden_from_ui):
		if frappe.db.has_column('Service Request', 'hide_from_ui'):
			filters['hide_from_ui'] = ['!=', 1]

	if patient:
		filters['patient'] = patient
	elif patient_search and str(patient_search).strip():
		ps = str(patient_search).strip()
		matching = frappe.db.sql(
			"""
			SELECT name FROM `tabPatient`
			WHERE name LIKE %(q)s OR patient_name LIKE %(q)s
			LIMIT 500
			""",
			{'q': f'%{ps}%'},
			pluck='name',
		)
		if not matching:
			return {'data': [], 'total_count': 0}
		filters['patient'] = ['in', list(matching)]

	if template_dt:
		filters['template_dt'] = template_dt
	if status:
		filters['status'] = status
	if practitioner:
		filters['practitioner'] = practitioner
	if search:
		filters['name'] = ['like', f'%{search}%']
	if patient_visit:
		filters['patient_visit'] = patient_visit
	if inpatient_record:
		filters['inpatient_record'] = inpatient_record
	else:
		# Care-mode filter only when not already scoped to a specific admission.
		# Specific OP visit already excludes other visits; still hide IP rows in OP mode.
		care = (patient_care_type or "").strip().upper()
		if care == "OP":
			filters['inpatient_record'] = ['is', 'not set']
		elif care == "IP" and not patient_visit:
			filters['inpatient_record'] = ['is', 'set']
	if booked is not None and str(booked).strip() != '' and not show_unconfirmed:
		filters['booked'] = 1 if cint(booked) else 0

	# Portal navbar branch (UI) + Cost Center User Permission when present.
	# Always also include requests with no branch (unscoped) so they remain visible
	# no matter which branch is selected in the top navbar.
	resolved_cc = resolve_cost_center_filter(cost_center)
	if resolved_cc is False:
		return {"data": [], "total_count": 0}
	or_filters = None
	if isinstance(resolved_cc, list):
		or_filters = [
			['Service Request', 'cost_center', 'in', resolved_cc],
			['Service Request', 'cost_center', 'is', 'not set'],
		]
	elif resolved_cc:
		or_filters = [
			['Service Request', 'cost_center', '=', resolved_cc],
			['Service Request', 'cost_center', 'is', 'not set'],
		]

	# Resolve human-readable template names for all supported template types
	_template_name_field = {
		'Lab Test Template': 'lab_test_name',
		'Clinical Procedure Template': 'procedure_name',
		'Observation Template': 'observation',
		'Therapy Type': 'therapy_type',
		'Healthcare Activity': 'activity_type',
		'Healthcare Service Template': 'service_name',
		'Consultation Service Template': 'template_name',
		'Appointment Type': 'name',
	}

	fetch_kwargs = dict(
		filters=filters,
		fields=[
			'name', 'patient', 'patient_name', 'practitioner',
			'assigned_healthcare_practioner',
			'template_dt', 'template_dn', 'lab_request_items', 'status', 'order_date', 'order_time',
			'occurrence_date', 'occurrence_time', 'medical_department',
			'billing_status', 'priority', 'intent', 'patient_accepted_cost',
			'booked', 'order_group', 'cost', 'grand_total', 'amount', 'cost_center',
		],
		limit=limit,
		limit_start=offset,
		order_by='order_date desc, order_time desc',
	)
	if or_filters:
		fetch_kwargs['or_filters'] = or_filters

	# Count total matching records (without limit/offset)
	count_kwargs = dict(filters=filters)
	if or_filters:
		count_kwargs['or_filters'] = or_filters
	total_count = frappe.get_all('Service Request', **count_kwargs, limit=0, fields=['name'])
	total_count = len(total_count)

	from healthcare.healthcare.lab_request_items import (
		lab_request_items_summary,
		parse_lab_request_items,
		resolve_group_child_templates,
		sort_lab_request_display_items,
	)
	from healthcare.api.common import _by_nurse_lab_test_template_names

	service_requests = frappe.get_all('Service Request', **fetch_kwargs)
	nurse_templates = set(_by_nurse_lab_test_template_names())
	for sr in service_requests:
		sr['practitioner_name'] = _practitioner_display_name(sr.practitioner)
		assigned = sr.get('assigned_healthcare_practioner')
		sr['assigned_practitioner_name'] = (
			_practitioner_display_name(assigned) if assigned else None
		)

		# Compute UI-only virtual status (sample progress / result progress) for Lab Requests
		if sr.template_dt == 'Lab Test Template':
			if show_unconfirmed and not cint(sr.get('booked')):
				# Not forwarded to the lab yet (no Lab Tests exist), so the portal
				# lists the tests on the row and opens the review modal tests-only
				# (no sample / result / print actions). Rows still waiting
				# for payment (``patient_accepted_cost`` unset) are labelled
				# "Unconfirmed"; paid-but-not-booked ones "Awaiting Booking".
				sr['unconfirmed'] = 1
				sr['virtual_status'] = 'booked'
			else:
				sr['virtual_status'] = _compute_lab_request_virtual_status(sr)

		items = sort_lab_request_display_items(parse_lab_request_items(sr))
		if sr.template_dt == 'Lab Test Template':
			tpl_names = _lab_request_template_names(sr, items)
			sr['by_nurse'] = 1 if any(n in nurse_templates for n in tpl_names) else 0
		if items and sr.template_dt == 'Lab Test Template':
			sr['template_name'] = lab_request_items_summary(items) or sr.template_dn
			groups = []
			for item in items:
				if (item.get("kind") or "").strip().lower() != "group":
					continue
				parent = (item.get("parent") or "").strip()
				if not parent:
					continue
				parent_label = (
					frappe.db.get_value("Lab Test Template", parent, "lab_test_name")
					or parent
				)
				child_templates = resolve_group_child_templates(parent, item.get("children"))
				children = []
				for child in child_templates:
					children.append(
						{
							"template": child,
							"label": (
								frappe.db.get_value(
									"Lab Test Template", child, "lab_test_name"
								)
								or child
							),
						}
					)
				groups.append(
					{
						"template": parent,
						"label": parent_label,
						"children": children,
					}
				)
			sr["lab_request_groups"] = groups
		elif sr.template_dn and sr.template_dt:
			name_field = _template_name_field.get(sr.template_dt)
			if name_field and name_field != 'name':
				resolved = frappe.db.get_value(sr.template_dt, sr.template_dn, name_field)
				sr['template_name'] = resolved or sr.template_dn
			else:
				sr['template_name'] = sr.template_dn

	# Client-side virtual status filter — applies after computing virtual_status per row.
	if virtual_status and str(virtual_status).strip().lower() != 'all':
		vs = str(virtual_status).strip().lower()
		service_requests = [
			sr
			for sr in service_requests
			if (sr.get('virtual_status') or 'booked') == vs
		]

	return {"data": service_requests, "total_count": total_count}


def _parse_normal_range_bounds(normal_range):
	"""Best-effort min/max from free-text normal range (e.g. ``4.0 - 11.0``)."""
	import re

	text = (normal_range or "").strip()
	if not text:
		return None, None
	match = re.search(
		r"(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)",
		text,
		flags=re.IGNORECASE,
	)
	if not match:
		return None, None
	return match.group(1), match.group(2)


def _range_value_or_none(value):
	"""Normalize template range fields; blank / unset → None.

	Min/Max Range accept free text (words) as well as numbers. A bare numeric
	``0`` / ``0.0`` is treated as unset (legacy Float default). Non-numeric text
	such as ``Negative`` is kept as-is.
	"""
	if value is None:
		return None
	text = cstr(value).strip()
	if not text:
		return None
	try:
		num = float(text)
	except (TypeError, ValueError):
		return text
	# Legacy Float default / empty range
	if num == 0:
		return None
	# Keep integer-looking values clean (2 not 2.0) when possible.
	if float(num).is_integer():
		return str(int(num))
	return text


def _pick_template_min_max(row, patient_sex=None):
	"""Prefer sex-specific template ranges, then generic min/max, then normal_range text."""
	sex = (patient_sex or "").strip().lower()
	if sex in ("male", "m"):
		mn = _range_value_or_none(row.get("male_min_range"))
		mx = _range_value_or_none(row.get("male_max_range"))
		if mn is not None or mx is not None:
			return mn, mx
	elif sex in ("female", "f"):
		mn = _range_value_or_none(row.get("female_min_range"))
		mx = _range_value_or_none(row.get("female_max_range"))
		if mn is not None or mx is not None:
			return mn, mx

	mn = _range_value_or_none(row.get("min_range"))
	mx = _range_value_or_none(row.get("max_range"))
	if mn is not None or mx is not None:
		return mn, mx

	return _parse_normal_range_bounds(row.get("lab_test_normal_range"))


def _lab_result_type_label(template_type=None, is_multiple=0, display_one_result=0):
	# Multiple template that should be entered as one result (lab request inline field).
	if cint(is_multiple) and cint(display_one_result):
		return "Single"
	if cint(is_multiple):
		return "Multiple"
	tt = (template_type or "").strip()
	if tt in ("Compound", "Descriptive", "Grouped"):
		return "Multiple"
	if tt == "Single" or not tt:
		return "Single"
	return tt or "Single"


def _resolve_multiple_use_status_flag(template, result_value, patient_sex=None):
	"""Compute Deficiency/Toxicity (or High/Low) from Multiple Results.use_status for a result."""
	if not template or not result_value or not frappe.db.exists("Lab Test Template", template):
		return ""
	from healthcare.api.lab_test import (
		_calculate_result_flag,
		_multiple_result_status_options,
		_suggest_multiple_result_status,
	)

	is_multiple = cint(frappe.db.get_value("Lab Test Template", template, "is_multiple"))
	display_one = 0
	if frappe.db.has_column("Lab Test Template", "display_one_result"):
		display_one = cint(frappe.db.get_value("Lab Test Template", template, "display_one_result"))
	if not is_multiple or display_one:
		return ""
	doc = frappe.get_doc("Lab Test Template", template)
	rows = list(doc.get("multiple_result_type") or [])
	if not rows:
		return ""
	use_status_rows = [r for r in rows if cint(getattr(r, "use_status", 0))]
	if use_status_rows:
		return _suggest_multiple_result_status(result_value, _multiple_result_status_options()) or ""
	mr0 = rows[0]
	return (
		_calculate_result_flag(
			result_value,
			patient_sex,
			getattr(mr0, "female_min_range", None),
			getattr(mr0, "female_max_range", None),
			getattr(mr0, "male_min_range", None),
			getattr(mr0, "male_max_range", None),
			None,
			None,
		)
		or ""
	)


def _template_review_fields(template_names, patient_sex=None, patient_care_type=None):
	"""Map template name → display fields for lab request review modal."""
	names = [n for n in {(n or "").strip() for n in (template_names or [])} if n]
	if not names:
		return {}

	has_included = frappe.db.has_column("Lab Test Template", "price_included_in_group")
	has_typo_included = frappe.db.has_column("Lab Test Template", "price_incuded_in_group")
	fields = [
		"name",
		"lab_test_code",
		"lab_test_name",
		"lab_test_uom",
		"lab_test_normal_range",
		"lab_test_template_type",
		"lab_test_rate",
		"op_rate",
		"is_multiple",
		"display_one_result",
		"min_range",
		"max_range",
		"male_min_range",
		"male_max_range",
		"female_min_range",
		"female_max_range",
		"enable_external_lab_print",
		"allow_specimen_type",
	]
	if has_included:
		fields.append("price_included_in_group")
	elif has_typo_included:
		fields.append("price_incuded_in_group")

	# Only request columns that exist on this site.
	fields = [f for f in fields if f == "name" or frappe.db.has_column("Lab Test Template", f)]

	rows = frappe.get_all(
		"Lab Test Template",
		filters={"name": ["in", names]},
		fields=fields,
		ignore_permissions=True,
	)
	out = {}
	for row in rows:
		included = cint(
			row.get("price_included_in_group")
			if row.get("price_included_in_group") is not None
			else row.get("price_incuded_in_group")
		)
		min_v, max_v = _pick_template_min_max(row, patient_sex)
		out[row.name] = {
			"template": row.name,
			# Document name is the stable lab code (LAB-001, LAB-001-014, …).
			# lab_test_code often mirrors the long display name on this site.
			"test_code": row.name,
			"test_name": row.get("lab_test_name") or row.get("lab_test_code") or row.name,
			"uom": row.get("lab_test_uom") or "",
			"normal_range": row.get("lab_test_normal_range") or "",
			"min_value": min_v,
			"max_value": max_v,
			"result_type": _lab_result_type_label(
				row.get("lab_test_template_type"),
				row.get("is_multiple"),
				row.get("display_one_result"),
			),
			"template_type": row.get("lab_test_template_type") or "",
			"price_included_in_group": included,
			"list_rate": _lab_template_list_rate(row, patient_care_type),
			"enable_external_lab_print": cint(row.get("enable_external_lab_print")),
			"allow_specimen_type": cint(row.get("allow_specimen_type")),
		}
	return out


@frappe.whitelist(allow_guest=False)
def get_lab_request_review(name):
	"""Read-only Lab Request review payload for the Lab page modal.

	Returns request header + test groups with child rows (code, name, price, result type, unit, min/max).
	Booked Lab Test Template Service Requests are always reviewable. Not-yet-booked ones
	(no Lab Tests yet) are also returned *tests only* — the portal hides every lab action
	for them — but only when Healthcare Settings → *Display Unconfirmed Request on Lab
	Page* is on, the same setting that lists them on the Lab page.
	"""
	from healthcare.healthcare.lab_request_items import (
		expand_lab_test_specs,
		lab_request_items_summary,
		parse_lab_request_items,
		resolve_group_child_templates,
		sort_lab_request_display_items,
	)

	if not name:
		frappe.throw(_("Service Request name is required"))
	if not frappe.db.exists("Service Request", name):
		frappe.throw(_("Service Request not found"))

	doc = frappe.get_doc("Service Request", name)
	if doc.template_dt != "Lab Test Template":
		frappe.throw(_("This Service Request is not a Lab Request"))
	# Not forwarded to the lab yet → no Lab Tests to act on; the modal only lists tests.
	unconfirmed = not cint(doc.booked)
	if unconfirmed and not _display_unconfirmed_request_on_lab_page():
		frappe.throw(_("Only booked Lab Requests can be reviewed here"))

	items = sort_lab_request_display_items(parse_lab_request_items(doc))
	patient_care_type = _resolve_patient_care_type(
		getattr(doc, "patient_care_type", None),
		getattr(doc, "patient_visit", None),
		getattr(doc, "inpatient_record", None),
	)
	specs = expand_lab_test_specs(items, doc.patient, patient_care_type=patient_care_type)
	price_by_template = {s.get("template"): flt(s.get("amount") or 0) for s in specs if s.get("template")}

	# Resolve child lists the same way as list enrichment (legacy groups may omit children).
	groups = []
	all_child_names = []
	for item in items:
		kind = (item.get("kind") or "").strip().lower()
		if kind == "group":
			parent = (item.get("parent") or "").strip()
			if not parent:
				continue
			child_templates = resolve_group_child_templates(parent, item.get("children"))
			all_child_names.extend(child_templates)
			all_child_names.append(parent)
			groups.append({"kind": "group", "template": parent, "children": child_templates})
		elif kind == "single":
			tpl = (item.get("template") or "").strip()
			if not tpl:
				continue
			all_child_names.append(tpl)
			groups.append({"kind": "single", "template": tpl, "children": [tpl]})

	patient_sex = None
	if doc.patient and frappe.db.exists("Patient", doc.patient):
		sex_field = "sex" if frappe.db.has_column("Patient", "sex") else None
		if not sex_field and frappe.db.has_column("Patient", "gender"):
			sex_field = "gender"
		if sex_field:
			patient_sex = frappe.db.get_value("Patient", doc.patient, sex_field)

	patient_label = _lab_sample_patient_label_fields(doc.patient, patient_sex)

	meta = _template_review_fields(
		all_child_names, patient_sex=patient_sex, patient_care_type=patient_care_type
	)
	group_rows = []
	for g in groups:
		parent = g["template"]
		parent_meta = meta.get(parent) or {
			"test_code": parent,
			"test_name": parent,
		}
		tests = []
		for child in g["children"]:
			cm = meta.get(child) or {
				"template": child,
				"test_code": child,
				"test_name": child,
				"uom": "",
				"normal_range": "",
				"min_value": None,
				"max_value": None,
				"result_type": "Single",
				"price_included_in_group": 0,
				"list_rate": 0,
				"allow_specimen_type": 0,
				"enable_external_lab_print": 0,
			}
			price = price_by_template.get(child)
			if price is None:
				price = 0.0 if cint(cm.get("price_included_in_group")) else flt(cm.get("list_rate") or 0)
			tests.append(
				{
					"template": child,
					"test_code": child,
					"test_name": cm.get("test_name") or child,
					"price": flt(price),
					"result_type": cm.get("result_type") or "Single",
					"uom": cm.get("uom") or "",
					"min_value": cm.get("min_value"),
					"max_value": cm.get("max_value"),
					"normal_range": cm.get("normal_range") or "",
					"price_included_in_group": cint(cm.get("price_included_in_group")),
					"allow_specimen_type": cint(cm.get("allow_specimen_type")),
					"enable_external_lab_print": cint(cm.get("enable_external_lab_print")),
				}
			)
		item_finished = 0
		for raw in items:
			kind = (raw.get("kind") or "").strip().lower()
			key = (raw.get("parent") or "").strip() if kind == "group" else (raw.get("template") or "").strip()
			if key == parent:
				item_finished = cint(raw.get("finished"))
				break

		group_rows.append(
			{
				"kind": g["kind"],
				"template": parent,
				"group_code": parent,
				"group_name": parent_meta.get("test_name")
				or frappe.db.get_value("Lab Test Template", parent, "lab_test_name")
				or parent,
				"is_group": 1 if g["kind"] == "group" else 0,
				"finished": item_finished,
				"enable_external_lab_print": 1
				if cint(parent_meta.get("enable_external_lab_print"))
				or any(cint(t.get("enable_external_lab_print")) for t in tests)
				else 0,
				"tests": tests,
				"test_count": len(tests),
				"total_price": flt(sum(flt(t.get("price") or 0) for t in tests)),
			}
		)

	# Group price often lives on the parent template (children are 0 / included).
	for g in group_rows:
		if cint(g.get("is_group")) and flt(g.get("total_price") or 0) <= 0:
			parent_meta = meta.get(g["template"]) or {}
			parent_price = price_by_template.get(g["template"])
			if parent_price is None:
				parent_price = flt(parent_meta.get("list_rate") or 0)
			g["total_price"] = flt(parent_price)

	# Prefer stored billed totals when present.
	stored_total = flt(doc.get("grand_total") or doc.get("amount") or doc.get("cost") or 0)
	computed_total = flt(sum(flt(g.get("total_price") or 0) for g in group_rows))

	# Whole request finished → every group is finished.
	if (doc.status or "").strip() == "completed-Request Status":
		for g in group_rows:
			g["finished"] = 1

	# Linked Lab Tests created when this request was booked (for sample / results actions).
	lab_test_fields = [
		"name",
		"template",
		"lab_test_name",
		"status",
		"docstatus",
		"is_group_lab_test",
		"lab_test_group",
		"result_date",
		"custom_result",
		"result_flag",
		"patient",
		"patient_name",
		"practitioner",
		"practitioner_name",
	]
	if frappe.db.has_column("Lab Test", "custom_speciment_type"):
		lab_test_fields.append("custom_speciment_type")
	lab_test_rows = frappe.get_all(
		"Lab Test",
		filters={"service_request": doc.name, "docstatus": ["!=", 2]},
		fields=lab_test_fields,
		order_by="creation asc",
		ignore_permissions=True,
	)
	lab_tests_by_template = {}
	for lt in lab_test_rows:
		tpl = (lt.get("template") or "").strip()
		if not tpl:
			continue
		lab_tests_by_template.setdefault(tpl, []).append(lt)

	# Uploaded reports / scans per linked lab test — shown as an attachment count
	# on the test row (available before and after sample collection).
	from healthcare.api.lab_test import _lab_test_document_fields

	document_counts: dict[str, int] = {}
	linked_lab_names = [lt.get("name") for lt in lab_test_rows if lt.get("name")]
	if linked_lab_names:
		for row in frappe.db.get_all(
			"Patient Upload Document",
			filters={
				"parenttype": "Lab Test",
				"parentfield": ["in", _lab_test_document_fields()],
				"parent": ["in", linked_lab_names],
			},
			fields=["parent", {"COUNT": "name", "as": "documents_count"}],
			group_by="parent",
		):
			document_counts[row.parent] = cint(row.documents_count)

	for g in group_rows:
		for test in g.get("tests") or []:
			linked = lab_tests_by_template.get(test.get("template") or "", [])
			# Prefer exact template match; first linked doc is enough for actions.
			lt = linked[0] if linked else None
			test["lab_test"] = lt.get("name") if lt else None
			test["lab_test_status"] = lt.get("status") if lt else None
			test["lab_test_docstatus"] = cint(lt.get("docstatus")) if lt else None
			test["sample_collection"] = None
			test["custom_result"] = (lt.get("custom_result") or "") if lt else ""
			test["custom_speciment_type"] = (lt.get("custom_speciment_type") or "") if lt else ""
			flag = ((lt.get("result_flag") or "") if lt else "").strip()
			# Backfill Use Status marks when result exists but flag was never set (older saves / unit mismatch).
			if not flag and lt and (test.get("custom_result") or "").strip():
				flag = _resolve_multiple_use_status_flag(
					lt.get("template"), test.get("custom_result"), patient_sex
				) or ""
			test["result_flag"] = flag
			test["documents_count"] = document_counts.get(test["lab_test"] or "", 0)

	return {
		"name": doc.name,
		"patient": doc.patient,
		"patient_name": doc.patient_name,
		"file_no": patient_label.get("file_no"),
		"sex": patient_label.get("sex"),
		"age": patient_label.get("age"),
		"id_number": patient_label.get("id_number"),
		"nationality": patient_label.get("nationality"),
		"practitioner": doc.practitioner,
		"practitioner_name": _practitioner_display_name(doc.practitioner),
		# Lab users only care that it is booked — not Service Request workflow status.
		"status": "Unconfirmed" if unconfirmed else "Booked",
		"service_request_status": doc.status,
		"booked": 0 if unconfirmed else 1,
		# Not forwarded to the lab yet: portal shows the tests only (no lab actions) and
		# uses ``patient_accepted_cost`` to tell unpaid from paid-but-not-booked.
		"unconfirmed": 1 if unconfirmed else 0,
		"patient_accepted_cost": cint(doc.get("patient_accepted_cost")),
		"order_date": doc.order_date,
		"order_time": doc.order_time,
		"template_name": lab_request_items_summary(items) or doc.template_dn,
		"cost_center": doc.cost_center,
		"groups": group_rows,
		"group_count": len(group_rows),
		"test_count": sum(int(g.get("test_count") or 0) for g in group_rows),
		"total_price": stored_total or computed_total,
		"lab_tests": lab_test_rows,
		"remove_collect_sample_button_from_child_test": bool(
			cint(
				frappe.db.get_single_value(
					"Healthcare Settings", "remove_collect_sample_button_from_child_test"
				)
			)
		),
		# Multiple-unit result entry toggle (button → external multi-results modal).
		"have_multiresults_on_lab_test": bool(
			cint(
				frappe.db.get_single_value(
					"Healthcare Settings", "have_multiresults_on_lab_test"
				)
			)
		),
	}


def _lab_sample_patient_label_fields(patient: str | None, sex: str | None = None) -> dict:
	"""Demographics for the lab sample barcode label."""
	from frappe.utils import getdate

	out = {
		"file_no": patient or "",
		"patient_name": "",
		"sex": sex or "",
		"age": "",
		"id_number": "",
		"nationality": "",
	}
	if not patient or not frappe.db.exists("Patient", patient):
		return out

	fields = ["name", "patient_name", "file_no", "dob"]
	for fname in ("sex", "gender", "id_number", "national_id", "nationality", "pat_nationality"):
		if frappe.db.has_column("Patient", fname):
			fields.append(fname)
	row = frappe.db.get_value("Patient", patient, fields, as_dict=True) or {}
	out["file_no"] = (row.get("file_no") or row.get("name") or patient or "").strip()
	out["patient_name"] = (row.get("patient_name") or "").strip()
	out["sex"] = (row.get("sex") or row.get("gender") or sex or "").strip()
	out["id_number"] = (row.get("id_number") or row.get("national_id") or "").strip()
	out["nationality"] = (row.get("nationality") or row.get("pat_nationality") or "").strip()
	dob = row.get("dob")
	if dob:
		try:
			from dateutil.relativedelta import relativedelta

			years = relativedelta(getdate(), getdate(dob)).years
			out["age"] = f"{years} Years" if years is not None else ""
		except Exception:
			out["age"] = ""
	return out


@frappe.whitelist()
def get_lab_sample_barcode_label(name):
	"""Patient barcode label data for a booked Lab Request (sample collector print)."""
	if not name:
		frappe.throw(_("Service Request name is required"))
	if not frappe.db.exists("Service Request", name):
		frappe.throw(_("Service Request not found"))

	doc = frappe.get_doc("Service Request", name)
	fields = _lab_sample_patient_label_fields(doc.patient)
	file_no = fields.get("file_no") or doc.patient or name
	from frappe.utils import now_datetime

	printed_on = now_datetime().strftime("%d-%b-%Y %H:%M %p").upper()
	return {
		**fields,
		"patient": doc.patient,
		"patient_name": fields.get("patient_name") or doc.patient_name,
		"service_request": doc.name,
		"printed_on": printed_on,
	}


def generate_lab_test_trans_num(format_type="integer", prefix="", suffix="", padding=6):
    """
    Generate a sequential Trans Num for Lab Test by finding the largest existing integer.
    
    Args:
        format_type (str): "integer", "padded", "prefixed", or "suffixed"
        prefix (str): Prefix to add to the number (e.g., "LT-")
        suffix (str): Suffix to add to the number (e.g., "-2024")
        padding (int): Number of digits for zero padding (e.g., 6 for "000001")
    
    Returns:
        str: The next sequential Trans Num
    """
    # Get all Lab Test documents that have a Trans Num value
    # Use a more robust query to get all possible trans_num values
    lab_tests = frappe.db.sql("""
        SELECT trans_num 
        FROM `tabLab Test` 
        WHERE trans_num IS NOT NULL 
        AND trans_num != ''
        AND docstatus != 2
        ORDER BY 
            CASE 
                WHEN trans_num REGEXP '^[0-9]+$' THEN CAST(trans_num AS UNSIGNED)
                ELSE 0
            END DESC
        LIMIT 1
    """, as_dict=True)
    
    max_num = 0
    
    if lab_tests and lab_tests[0].get("trans_num"):
        trans_num = lab_tests[0]["trans_num"]
        
        # Try to extract number if it has prefix/suffix
        import re
        
        # Remove non-numeric characters and try to get the number
        numeric_part = re.sub(r'[^0-9]', '', str(trans_num))
        
        if numeric_part:
            try:
                max_num = int(numeric_part)
            except (ValueError, TypeError):
                max_num = 0
    
    # Increment by 1
    next_num = max_num + 1
    
    # Format based on requirements
    if format_type == "padded":
        return str(next_num).zfill(padding)
    elif format_type == "prefixed":
        return f"{prefix}{next_num}"
    elif format_type == "suffixed":
        return f"{next_num}{suffix}"
    else:  # "integer" or default
        return str(next_num)
    
@frappe.whitelist()
def create_lab_test_from_service_request(service_request):
	"""Create Lab Test(s) from a Service Request (supports multi-line lab baskets)."""
	if not service_request:
		frappe.throw(_("Service Request name is required"))

	from healthcare.healthcare.doctype.service_request.service_request import book_lab_and_forward

	service_request_doc = frappe.get_doc("Service Request", service_request)
	if service_request_doc.template_dt != "Lab Test Template":
		frappe.throw(_("Only Lab Test Template service requests can create lab tests."))

	from healthcare.api.inpatient_admission import is_enhanced_workflow_enabled

	if is_enhanced_workflow_enabled():
		confirm_payment(service_request)
	elif not service_request_doc.patient_accepted_cost:
		service_request_doc.db_set("patient_accepted_cost", 1)

	result = book_lab_and_forward(service_request)
	names = result.get("lab_tests") or []
	if not names and result.get("lab_test"):
		names = [result["lab_test"]]

	lab_tests = []
	for name in names:
		lt = frappe.get_doc("Lab Test", name)
		lab_tests.append(
			{
				"name": lt.name,
				"patient": lt.patient,
				"patient_name": lt.patient_name,
				"template": lt.template,
				"lab_test_name": lt.lab_test_name,
				"status": lt.status,
			}
		)

	if len(lab_tests) == 1:
		row = lab_tests[0]
		return {
			"is_group": False,
			"name": row["name"],
			"patient": row["patient"],
			"patient_name": row["patient_name"],
			"template": row["template"],
			"lab_test_name": row["lab_test_name"],
			"status": row["status"],
			"lab_tests": lab_tests,
			"count": 1,
		}
	return {"is_group": True, "lab_tests": lab_tests, "count": len(lab_tests)}


def _ip_lab_auto_book_enabled() -> bool:
	return bool(
		cint(
			frappe.db.get_single_value(
				"Healthcare Settings", "automatically_create_lab_test_for_ip"
			)
		)
	)


def _auto_confirm_and_book_ip_lab(service_request_name: str) -> dict:
	"""Confirm payment (Sales Order) and book lab tests for an IP lab request."""
	from healthcare.healthcare.doctype.service_request.service_request import book_lab_and_forward

	payment = confirm_payment(service_request_name)
	booking = book_lab_and_forward(service_request_name)
	out = {
		"auto_booked": True,
		"patient_accepted_cost": 1,
		"booked": 1,
		"sales_order": frappe.db.get_value(
			"Service Request", service_request_name, "reference_document_name"
		),
	}
	if payment.get("covered_by_package"):
		out["covered_by_package"] = True
	if booking.get("count"):
		out["lab_tests_count"] = booking["count"]
		out["lab_tests"] = booking.get("lab_tests") or []
	elif booking.get("lab_test"):
		out["lab_tests_count"] = 1
		out["lab_tests"] = [booking["lab_test"]]
	else:
		out["lab_tests_count"] = 0
		out["lab_tests"] = []
	return out


@frappe.whitelist()
def create_service_request(data):
	"""Create a new Service Request"""
	if isinstance(data, str):
		import json
		data = json.loads(data)
	
	# Validate required fields
	if not data.get('patient'):
		frappe.throw(_("Patient is required"))
	
	if not data.get('template_dt'):
		frappe.throw(_("Template Type is required"))
	
	from healthcare.healthcare.lab_request_items import (
		apply_discounts_to_specs,
		expand_lab_test_specs,
		primary_template_dn_for_items,
		totals_from_specs,
	)

	lab_request_items = data.get("lab_request_items")
	if isinstance(lab_request_items, str):
		try:
			lab_request_items = json.loads(lab_request_items)
		except Exception:
			lab_request_items = []
	if not isinstance(lab_request_items, list):
		lab_request_items = []

	patient_care_type = _resolve_patient_care_type(
		data.get("patient_care_type"),
		data.get("patient_visit"),
		data.get("inpatient_record"),
	)
	# OP/IP is used for lab pricing only. Do not write it onto the Link field.

	if lab_request_items and data.get("template_dt") == "Lab Test Template":
		data["template_dn"] = primary_template_dn_for_items(lab_request_items) or data.get("template_dn")
		specs = expand_lab_test_specs(
			lab_request_items,
			data.get("patient"),
			patient_care_type=patient_care_type,
		)
		specs = apply_discounts_to_specs(specs, lab_request_items)
		totals = totals_from_specs(specs)
		general_discount_amount = flt(data.get("general_discount_amount") or 0)
		line_grand_total = flt(totals["grand_total"])
		if general_discount_amount > line_grand_total:
			frappe.throw(
				_("General discount cannot be greater than the total after per-test discounts.")
			)
		data["cost"] = totals["cost"]
		data["grand_total"] = line_grand_total - general_discount_amount
		data["discount_amount"] = (
			flt(totals["discount_amount"]) + general_discount_amount
		)
		data["discount"] = 0
		data["discount_margin"] = "Amount"
	elif data.get("template_dt") == "Healthcare Service Template" and data.get("template_dn"):
		# List price in cost; insurance % in discount; net in grand_total (trackable to invoice)
		from healthcare.controllers.insurance_pricing import apply_discount as _apply_pct
		from healthcare.controllers.insurance_pricing import charge_list_and_discount, resolve_charge

		qty = flt(data.get("quantity") or 1) or 1
		ui_cost = data.get("cost")
		ui_grand = data.get("grand_total")
		# Explicit override (e.g. edited Admission Assessment Fee on admit) — keep submitted rates.
		if cint(data.get("override_rate")) and ui_cost is not None:
			list_unit = flt(ui_cost) / qty if qty else flt(ui_cost)
			unit_net = (
				flt(ui_grand) / qty if ui_grand is not None and qty else list_unit
			)
			data["cost"] = list_unit * qty
			data["grand_total"] = unit_net * qty
			data["discount_amount"] = max(0.0, flt(data["cost"]) - flt(data["grand_total"]))
			if not data.get("discount_margin"):
				data["discount"] = data.get("discount") or 0
				data["discount_margin"] = "Amount"
		else:
			base = _get_template_base_rate(
				data["template_dt"], data["template_dn"], patient_care_type
			)
			charged = resolve_charge(
				patient=data.get("patient"),
				base_rate=base,
				patient_care_type=patient_care_type,
				template_dt=data["template_dt"],
				template_dn=data["template_dn"],
				service_type=patient_care_type,
			)
			parts = charge_list_and_discount(charged)
			list_unit = flt(parts["list_rate"])
			# Catalog may have no rate (free / no-payment nursing Other Services).
			# Prefer UI-submitted cost when catalog list price is zero.
			if list_unit <= 0 and ui_cost is not None:
				list_unit = flt(ui_cost) / qty if qty else flt(ui_cost)
			insurance_pct = flt(parts["discount_pct"])
			# Prefer UI-submitted discount when already set (reception override);
			# otherwise use insurance %.
			header_pct = flt(data.get("discount") or 0)
			header_amt = flt(data.get("discount_amount") or 0)
			if header_pct <= 0 and header_amt <= 0 and insurance_pct > 0 and list_unit > 0:
				header_pct = insurance_pct
				data["discount"] = insurance_pct
				data["discount_margin"] = "Percentage"
			if header_pct > 0 and list_unit > 0:
				unit_net = _apply_pct(list_unit, header_pct)
				data["discount"] = header_pct
				data["discount_margin"] = data.get("discount_margin") or "Percentage"
			elif header_amt > 0 and list_unit > 0:
				unit_net = max(0.0, list_unit - (header_amt / qty))
				data["discount_margin"] = data.get("discount_margin") or "Amount"
			else:
				# No catalog price → keep UI list (may be 0 for free services)
				unit_net = (
					flt(parts["net_rate"]) if flt(parts["list_rate"]) > 0 else list_unit
				)
			data["cost"] = list_unit * qty
			data["grand_total"] = unit_net * qty
			data["discount_amount"] = max(0.0, flt(data["cost"]) - flt(data["grand_total"]))

	if not data.get('template_dn'):
		frappe.throw(_("Template is required"))

	# Require either Patient Visit (OP) or Inpatient Admission for clinical context
	if not data.get('patient_visit') and not data.get('inpatient_record'):
		frappe.throw(_("Please select either a Patient Visit or an Inpatient Admission for the service request"))

	if not data.get("cost_center"):
		frappe.throw(_("Please select a cost center for this service request."))

	if not data.get("practitioner"):
		frappe.throw(_("Please select a practitioner for this service request."))

	from healthcare.api.common import require_op_lab_assigned_consultant

	require_op_lab_assigned_consultant(data)
	
	# Get naming series
	naming_series = frappe.db.get_value('Service Request', {'naming_series': 'HSR-'}, 'naming_series')
	if not naming_series:
		naming_series = 'HSR-'
	
	# Create the service request
	selected_group_templates = data.get("selected_group_templates") or []
	if isinstance(selected_group_templates, str):
		try:
			selected_group_templates = json.loads(selected_group_templates)
		except Exception:
			selected_group_templates = [selected_group_templates]
	if not isinstance(selected_group_templates, list):
		selected_group_templates = []
	selected_group_templates = [t for t in selected_group_templates if t]

	# Legacy single group: build lab_request_items when not sent from client
	if (
		not lab_request_items
		and data.get("template_dt") == "Lab Test Template"
		and data.get("template_dn")
	):
		is_group = frappe.db.get_value("Lab Test Template", data["template_dn"], "is_group")
		if is_group:
			lab_request_items = [
				{
					"kind": "group",
					"parent": data["template_dn"],
					"children": selected_group_templates,
				}
			]
		else:
			lab_request_items = [{"kind": "single", "template": data["template_dn"]}]

	_ensure_lab_service_request_create_permission(
		data.get("template_dt"),
		_collect_lab_template_names_for_permission(
			data.get("template_dn"),
			lab_request_items,
			selected_group_templates,
		),
	)

	service_request = frappe.get_doc({
		'doctype': 'Service Request',
		'patient': data.get('patient'),
		'patient_visit': data.get('patient_visit'),
		'inpatient_record': data.get('inpatient_record'),
		'patient_care_type': _service_request_care_type_link(data.get('patient_care_type')),
		'template_dt': data.get('template_dt'),
		'template_dn': data.get('template_dn'),
		'lab_request_items': frappe.as_json(lab_request_items) if lab_request_items else None,
		'practitioner': data.get('practitioner'),
		'assigned_healthcare_practioner': data.get('assigned_healthcare_practioner'),
		'order_date': data.get('order_date') or frappe.utils.today(),
		'order_time': data.get('order_time') or frappe.utils.nowtime(),
		'medical_department': data.get('department'),
		'cost': data.get('cost'),
		'cost_center': data.get('cost_center'),
		'status': data.get('status') or 'draft-Request Status',
		'priority': data.get('priority'),
		'intent': data.get('intent'),
		'quantity': data.get('quantity') or 1,
		'occurrence_date': data.get('occurrence_date'),
		'occurrence_time': data.get('occurrence_time'),
		'naming_series': naming_series,
		# Discount fields (header discount for non-basket requests; basket uses per-test discounts in JSON)
		'discount': frappe.utils.flt(data.get('discount') or 0),
		'discount_margin': data.get('discount_margin') or data.get('discount_value') or '',
		'discount_amount': frappe.utils.flt(data.get('discount_amount') or 0),
		'grand_total': frappe.utils.flt(data.get('grand_total') or data.get('cost') or 0),
		'selected_group_templates': frappe.as_json(selected_group_templates),
	})
	
	try:
		service_request.insert(ignore_permissions=True)
	except frappe.MandatoryError as e:
		frappe.throw(portal_mandatory_message(e), exc=e, title=_("Missing required fields"))
	except frappe.ValidationError as e:
		frappe.throw(portal_validation_message(e), exc=e, title=_("Could not save"))
	
	# Get template name for response based on template_dt
	template_name = None
	if lab_request_items and service_request.template_dt == 'Lab Test Template':
		from healthcare.healthcare.lab_request_items import lab_request_items_summary
		template_name = lab_request_items_summary(lab_request_items)
	elif service_request.template_dn:
		if service_request.template_dt == 'Lab Test Template':
			template_name = frappe.db.get_value('Lab Test Template', service_request.template_dn, 'lab_test_name')
		elif service_request.template_dt == 'Clinical Procedure Template':
			template_name = frappe.db.get_value('Clinical Procedure Template', service_request.template_dn, 'procedure_name')
		elif service_request.template_dt == 'Observation Template':
			template_name = frappe.db.get_value('Observation Template', service_request.template_dn, 'observation')
		elif service_request.template_dt == 'Therapy Type':
			template_name = frappe.db.get_value('Therapy Type', service_request.template_dn, 'therapy_type')
		elif service_request.template_dt == 'Healthcare Activity':
			template_name = frappe.db.get_value('Healthcare Activity', service_request.template_dn, 'activity_type')
		elif service_request.template_dt == 'Healthcare Service Template':
			template_name = frappe.db.get_value('Healthcare Service Template', service_request.template_dn, 'service_name')
		else:
			template_name = service_request.template_dn
	
	# Return the created service request
	result = {
		'name': service_request.name,
		'patient': service_request.patient,
		'patient_name': service_request.patient_name or frappe.db.get_value('Patient', service_request.patient, 'patient_name'),
		'template_dt': service_request.template_dt,
		'template_dn': service_request.template_dn,
		'template_name': template_name or service_request.template_dn,
		'practitioner': service_request.practitioner,
		'practitioner_name': _practitioner_display_name(service_request.practitioner),
		'status': service_request.status,
		'order_date': service_request.order_date,
		'inpatient_record': service_request.inpatient_record,
	}

	if (
		service_request.template_dt == "Lab Test Template"
		and service_request.inpatient_record
		and _ip_lab_auto_book_enabled()
	):
		try:
			result.update(_auto_confirm_and_book_ip_lab(service_request.name))
			sr = frappe.get_doc("Service Request", service_request.name)
			result["status"] = sr.status
			result["booked"] = sr.booked
			result["patient_accepted_cost"] = sr.patient_accepted_cost
		except Exception:
			frappe.log_error(
				title=f"Auto IP lab booking failed for {service_request.name}",
				message=frappe.get_traceback(),
			)
			result["auto_booked"] = False
			result["auto_book_error"] = _(
				"Lab request was saved but automatic payment confirmation and booking failed. "
				"Confirm payment and book manually."
			)

	return result


def _get_general_lab_discount(doc, request_items=None):
	"""Return the request-level discount excluding discounts stored on test lines."""
	if doc.template_dt != "Lab Test Template" or not doc.patient:
		return 0.0

	from healthcare.healthcare.lab_request_items import (
		apply_discounts_to_specs,
		expand_lab_test_specs,
		parse_lab_request_items,
		totals_from_specs,
	)

	items = request_items if request_items is not None else parse_lab_request_items(doc)
	if not items:
		return flt(doc.discount_amount)
	patient_care_type = _resolve_patient_care_type(
		getattr(doc, "patient_care_type", None),
		getattr(doc, "patient_visit", None),
		getattr(doc, "inpatient_record", None),
	)
	specs = expand_lab_test_specs(items, doc.patient, patient_care_type=patient_care_type)
	specs = apply_discounts_to_specs(specs, items)
	line_totals = totals_from_specs(specs)
	return flt(doc.discount_amount) - flt(line_totals["discount_amount"])


@frappe.whitelist()
def get_service_request(name):
	"""Get a single Service Request document for editing."""
	if not name:
		frappe.throw(_("Service Request name is required"))
	if not frappe.db.exists("Service Request", name):
		frappe.throw(_("Service Request not found"))
	doc = frappe.get_doc("Service Request", name)
	data = doc.as_dict()
	if doc.template_dt == "Lab Test Template":
		# Always expose normalized lines to the edit form. This also gives legacy
		# single/group requests per-test discount controls even when they predate
		# the lab_request_items JSON field.
		from healthcare.healthcare.lab_request_items import (
			enrich_lab_request_items_for_display,
			lab_request_items_summary,
			parse_lab_request_items,
			sort_lab_request_display_items,
		)

		request_items = sort_lab_request_display_items(parse_lab_request_items(doc))
		data["lab_request_items"] = enrich_lab_request_items_for_display(request_items)
		data["general_discount_amount"] = _get_general_lab_discount(doc, request_items)
		data["template_name"] = (
			lab_request_items_summary(request_items)
			or frappe.db.get_value("Lab Test Template", doc.template_dn, "lab_test_name")
			or doc.template_dn
		)
	elif doc.template_dn:
		_template_name_field = {
			"Clinical Procedure Template": "procedure_name",
			"Observation Template": "observation",
			"Therapy Type": "therapy_type",
			"Healthcare Activity": "activity_type",
			"Healthcare Service Template": "service_name",
			"Consultation Service Template": "template_name",
		}
		name_field = _template_name_field.get(doc.template_dt or "")
		if name_field and frappe.db.exists(doc.template_dt, doc.template_dn):
			data["template_name"] = (
				frappe.db.get_value(doc.template_dt, doc.template_dn, name_field)
				or doc.template_dn
			)
		else:
			data["template_name"] = doc.template_dn
	data["practitioner_name"] = _practitioner_display_name(doc.practitioner)
	assigned = doc.get("assigned_healthcare_practioner")
	data["assigned_healthcare_practioner"] = assigned
	data["assigned_practitioner_name"] = (
		_practitioner_display_name(assigned) if assigned else None
	)
	return data


@frappe.whitelist()
def update_service_request(name, data):
	"""Update an existing Service Request. Only allows updating specific fields."""
	assert_editing_allowed()
	if isinstance(data, str):
		import json
		data = json.loads(data)
	if not name:
		frappe.throw(_("Service Request name is required"))
	if not frappe.db.exists("Service Request", name):
		frappe.throw(_("Service Request not found"))
	doc = frappe.get_doc("Service Request", name)
	if doc.docstatus == 2:
		frappe.throw(_("Cannot update a cancelled Service Request"))

	# Lab requests: block edits once any linked lab test has sample collection.
	if (getattr(doc, "template_dt", None) or "") == "Lab Test Template":
		from healthcare.api.lab_request_actions import (
			_can_edit_lab_request,
			_lab_request_phase,
			_linked_lab_tests,
		)

		lab_tests = _linked_lab_tests(doc.name)
		phase = _lab_request_phase(doc, lab_tests)
		if not _can_edit_lab_request(phase, lab_tests):
			frappe.throw(
				_("This lab request cannot be edited because sample collection has already started.")
			)

	from healthcare.healthcare.lab_request_items import (
		normalize_lab_request_items_for_storage,
		parse_lab_request_items,
	)

	# Snapshot billing so we know whether IP Sales Order must be recreated.
	billing_before = {
		"cost": flt(doc.cost),
		"grand_total": flt(doc.grand_total),
		"discount_amount": flt(doc.discount_amount),
		"discount": flt(doc.discount),
		"items": frappe.as_json(
			normalize_lab_request_items_for_storage(parse_lab_request_items(doc))
		),
		"patient_accepted_cost": cint(getattr(doc, "patient_accepted_cost", 0)),
		"reference_document_name": (getattr(doc, "reference_document_name", None) or "").strip(),
	}

	general_discount_amount = data.pop("general_discount_amount", None)
	if general_discount_amount is None:
		general_discount_amount = _get_general_lab_discount(doc)
	general_discount_amount = flt(general_discount_amount)
	# Allowed fields for update (editable in edit modal).
	# Exclude set_only_once fields: practitioner, referring_practitioner, source (cannot be changed after set).
	allowed = {
		"patient", "patient_visit", "inpatient_record", "template_dt", "template_dn",
		"lab_request_items",
		"order_date", "order_time", "medical_department", "department",
		"status", "priority", "intent", "quantity", "occurrence_date", "occurrence_time",
		"order_group", "order_description", "patient_instructions", "expected_date",
		"amount", "cost", "referred_to_practitioner",
		"staff_role", "patient_care_type", "healthcare_service_unit_type", "as_needed",
		"dosage_form", "dosage", "period", "cost_center",
		# Discount fields
		"discount", "discount_margin", "discount_value", "discount_amount", "grand_total",
	}
	for key, value in data.items():
		if key == "department":
			doc.medical_department = value
		elif key == "discount_value" and hasattr(doc, "discount_margin"):
			doc.discount_margin = value
		elif key == "lab_request_items":
			if isinstance(value, str):
				value = frappe.parse_json(value) or []
			if isinstance(value, list):
				normalized = normalize_lab_request_items_for_storage(value)
				existing = normalize_lab_request_items_for_storage(parse_lab_request_items(doc))
				# Avoid no-op writes that still fail update-after-submit when enrichment keys differ.
				if frappe.as_json(normalized) != frappe.as_json(existing):
					doc.lab_request_items = frappe.as_json(normalized) if normalized else None
			else:
				doc.lab_request_items = value
		elif key == "patient_care_type":
			link = _service_request_care_type_link(value)
			if link:
				doc.set(key, link)
		elif key in allowed and hasattr(doc, key):
			doc.set(key, value)

	if doc.template_dt == "Lab Test Template" and doc.lab_request_items and doc.patient:
		from healthcare.healthcare.lab_request_items import (
			apply_discounts_to_specs,
			expand_lab_test_specs,
			parse_lab_request_items,
			templates_in_lab_request_items,
			totals_from_specs,
		)

		request_items = parse_lab_request_items(doc)
		patient_care_type = _resolve_patient_care_type(
			getattr(doc, "patient_care_type", None),
			getattr(doc, "patient_visit", None),
			getattr(doc, "inpatient_record", None),
		)
		specs = expand_lab_test_specs(request_items, doc.patient, patient_care_type=patient_care_type)
		specs = apply_discounts_to_specs(specs, request_items)
		totals = totals_from_specs(specs)
		line_grand_total = flt(totals["grand_total"])
		if general_discount_amount > line_grand_total:
			frappe.throw(
				_("General discount cannot be greater than the total after per-test discounts.")
			)
		doc.cost = totals["cost"]
		doc.grand_total = line_grand_total - general_discount_amount
		doc.discount_amount = flt(totals["discount_amount"]) + general_discount_amount
		if request_items:
			doc.discount = 0
			doc.discount_margin = "Amount"

		# Drop linked Lab Tests whose templates were removed from the basket
		# (only Requested drafts with no sample collection).
		desired = templates_in_lab_request_items(request_items)
		if desired:
			from healthcare.api.lab_request_actions import (
				_can_delete_requested_lab_test,
				_delete_or_cancel_lab_test,
				_remove_lab_tests_from_visit,
			)

			orphans = frappe.get_all(
				"Lab Test",
				filters={
					"service_request": doc.name,
					"docstatus": ["!=", 2],
					"template": ["not in", list(desired)],
				},
				fields=["name", "status", "docstatus", "template"],
			)
			removed_names = []
			for lt in orphans:
				if _can_delete_requested_lab_test(lt):
					_delete_or_cancel_lab_test(lt.name)
					removed_names.append(lt.name)
			if removed_names:
				visit_name = getattr(doc, "order_group", None) or getattr(doc, "patient_visit", None)
				_remove_lab_tests_from_visit(visit_name, removed_names)

	# Submitted SRs block non-allow_on_submit fields (lab_request_items, cost, discounts)
	# via Document.save(). This whitelist API is the intentional edit path — do not change
	# Service Request JSON; only bypass the check here.
	if cint(doc.docstatus) == 1:
		doc.flags.ignore_validate_update_after_submit = True
	doc.save()

	# Booked requests: create Lab Tests for templates newly added on edit
	# (after save so create_missing reads the updated lab_request_items).
	added_lab_tests = []
	if (getattr(doc, "template_dt", None) or "") == "Lab Test Template" and cint(
		getattr(doc, "booked", 0)
	):
		from healthcare.healthcare.doctype.service_request.service_request import (
			create_missing_lab_tests_for_booked_request,
		)

		added_lab_tests = create_missing_lab_tests_for_booked_request(doc.name) or []
		if added_lab_tests:
			doc.reload()

	out = {"name": doc.name, "status": doc.status}
	if added_lab_tests:
		out["lab_tests_added"] = added_lab_tests
		out["lab_tests_added_count"] = len(added_lab_tests)

	# Lab requests that already have a Sales Order must be re-billed when amounts,
	# discounts, or tests change (cancel old SI/SO, create a fresh Sales Order).
	if (getattr(doc, "template_dt", None) or "") == "Lab Test Template" and (
		billing_before["patient_accepted_cost"]
		or billing_before["reference_document_name"]
		or cint(getattr(doc, "patient_accepted_cost", 0))
		or (
			(getattr(doc, "reference_document_type", None) or "") == "Sales Order"
			and (getattr(doc, "reference_document_name", None) or "").strip()
		)
	):
		items_after = frappe.as_json(
			normalize_lab_request_items_for_storage(parse_lab_request_items(doc))
		)
		billing_changed = (
			flt(doc.cost) != billing_before["cost"]
			or flt(doc.grand_total) != billing_before["grand_total"]
			or flt(doc.discount_amount) != billing_before["discount_amount"]
			or flt(doc.discount) != billing_before["discount"]
			or items_after != billing_before["items"]
		)
		if billing_changed:
			out.update(_recreate_lab_request_sales_order(doc.name))

	return out


def _cancel_or_delete_sales_invoice(si_name: str) -> str | None:
	"""Cancel submitted or delete draft Sales Invoice. Returns the handled name."""
	if not si_name or not frappe.db.exists("Sales Invoice", si_name):
		return None
	si = frappe.get_doc("Sales Invoice", si_name)
	if cint(si.docstatus) == 2:
		return None
	if cint(si.docstatus) == 1:
		si.cancel()
	else:
		frappe.delete_doc("Sales Invoice", si_name, ignore_permissions=True, force=1)
	return si_name


def _sales_invoices_for_sales_order(so_name: str) -> list[str]:
	if not so_name:
		return []
	parents = frappe.get_all(
		"Sales Invoice Item",
		filters={"sales_order": so_name},
		pluck="parent",
	)
	names: list[str] = []
	seen: set[str] = set()
	for parent in parents:
		if not parent or parent in seen:
			continue
		seen.add(parent)
		if frappe.db.exists("Sales Invoice", parent) and cint(
			frappe.db.get_value("Sales Invoice", parent, "docstatus")
		) != 2:
			names.append(parent)
	return names


def _unlink_service_requests_from_sales_order(so_name: str, preferred_sr=None) -> None:
	"""Clear SR → Sales Order links so the order can be cancelled/deleted.

	ERPNext blocks cancel when a Dynamic Link (Service Request.reference_document_*)
	still points at the Sales Order.
	"""
	so_name = (so_name or "").strip()
	if not so_name:
		return

	# Prefer the SR we are editing (in-memory + DB).
	if preferred_sr is not None:
		sr_name = getattr(preferred_sr, "name", None)
		if sr_name and (
			(getattr(preferred_sr, "reference_document_type", None) or "") == "Sales Order"
			and (getattr(preferred_sr, "reference_document_name", None) or "").strip() == so_name
		):
			frappe.db.set_value(
				"Service Request",
				sr_name,
				{
					"patient_accepted_cost": 0,
					"reference_document_type": None,
					"reference_document_name": None,
				},
				update_modified=False,
			)
			preferred_sr.patient_accepted_cost = 0
			preferred_sr.reference_document_type = None
			preferred_sr.reference_document_name = None

	# Any other SRs that still point at this Sales Order.
	linked = frappe.get_all(
		"Service Request",
		filters={
			"reference_document_type": "Sales Order",
			"reference_document_name": so_name,
		},
		pluck="name",
	)
	for sr_name in linked:
		frappe.db.set_value(
			"Service Request",
			sr_name,
			{
				"patient_accepted_cost": 0,
				"reference_document_type": None,
				"reference_document_name": None,
			},
			update_modified=False,
		)


def _retire_lab_request_sales_order(sr) -> dict:
	"""Unlink SR, cancel linked Sales Invoices, then cancel/delete the Sales Order."""
	result = {
		"previous_sales_order": None,
		"cancelled_sales_invoices": [],
	}
	if (getattr(sr, "reference_document_type", None) or "") != "Sales Order":
		return result
	so_name = (getattr(sr, "reference_document_name", None) or "").strip()
	if not so_name:
		return result
	if not frappe.db.exists("Sales Order", so_name):
		# Still clear stale link on the SR.
		_unlink_service_requests_from_sales_order(so_name, preferred_sr=sr)
		return result

	for si_name in _sales_invoices_for_sales_order(so_name):
		handled = _cancel_or_delete_sales_invoice(si_name)
		if handled:
			result["cancelled_sales_invoices"].append(handled)

	# Must unlink before cancel — Dynamic Link from Service Request blocks SO cancel.
	_unlink_service_requests_from_sales_order(so_name, preferred_sr=sr)

	so = frappe.get_doc("Sales Order", so_name)
	if cint(so.docstatus) == 1:
		so.cancel()
	elif cint(so.docstatus) == 0:
		frappe.delete_doc("Sales Order", so_name, ignore_permissions=True, force=1)
	result["previous_sales_order"] = so_name
	return result


def _recreate_lab_request_sales_order(service_request_name: str) -> dict:
	"""After lab request amount/discount edits: retire old SO/SI and create a new SO."""
	sr = frappe.get_doc("Service Request", service_request_name)
	if (getattr(sr, "template_dt", None) or "") != "Lab Test Template":
		return {"sales_order_recreated": False}
	if _inpatient_lab_tests_included(sr):
		# Inclusion changes must never retire existing charges automatically.
		return {"sales_order_recreated": False, **confirm_payment(service_request_name)}

	try:
		retired = _retire_lab_request_sales_order(sr)

		# Ensure billing flags are clear so confirm_payment creates a fresh Sales Order.
		# (Usually already cleared in _retire via unlink.)
		frappe.db.set_value(
			"Service Request",
			sr.name,
			{
				"patient_accepted_cost": 0,
				"reference_document_type": None,
				"reference_document_name": None,
			},
			update_modified=False,
		)

		payment = confirm_payment(service_request_name)
	except Exception as e:
		detail = strip_html(cstr(getattr(e, "message", None) or e)).strip()
		if "is linked with" in detail.lower():
			frappe.throw(
				_(
					"Could not update billing for this lab request because the existing Sales Order "
					"is still linked to another document. Please unlink it and try saving again."
				),
				title=_("Could not update Sales Order"),
			)
		# Keep clear ValidationError text from confirm_payment / retire helpers.
		if isinstance(e, frappe.ValidationError) and detail and "Traceback" not in detail:
			raise
		frappe.log_error(
			title=f"Failed to recreate Sales Order for lab request {service_request_name}",
			message=frappe.get_traceback(),
		)
		frappe.throw(
			_(
				"Could not update the Sales Order for this lab request{0}. "
				"Please check billing documents and try again."
			).format(f": {detail}" if detail and "Traceback" not in detail else ""),
			title=_("Could not update Sales Order"),
		)

	return {
		"sales_order_recreated": True,
		"previous_sales_order": retired.get("previous_sales_order"),
		"cancelled_sales_invoices": retired.get("cancelled_sales_invoices") or [],
		"sales_order": payment.get("sales_order"),
	}


# Backwards-compatible alias
_recreate_ip_lab_sales_order = _recreate_lab_request_sales_order


def _service_request_visit_admission_refs(sr):
	"""IP/OP context for Sales Order.custom_reference_* (same convention as Sales Invoice)."""
	if getattr(sr, "inpatient_record", None):
		return "Inpatient Admission", sr.inpatient_record
	if getattr(sr, "patient_visit", None):
		return "Patient Visit", sr.patient_visit
	return None, None


def _service_request_base_doc_refs(sr):
	"""Underlying clinical/billing doc: Lab Test, IP service, PMO, etc.; else Service Request."""
	odt = (getattr(sr, "order_reference_doctype", None) or "").strip()
	odn = (getattr(sr, "order_reference_name", None) or "").strip()
	if odt and odn:
		try:
			if frappe.db.exists(odt, odn):
				return odt, odn
		except Exception:
			pass
	return "Service Request", sr.name


def apply_service_request_refs_to_sales_order(so, sr):
	"""Set custom_reference_* to Patient Visit / Inpatient Admission; base to lab/service/PMO or SR."""
	rt, rn = _service_request_visit_admission_refs(sr)
	if not rt or not rn:
		frappe.throw(
			_(
				"Service Request {0} must be linked to a Patient Visit or Inpatient Admission before billing."
			).format(sr.name)
		)
	so.custom_reference_type = rt
	so.custom_reference_name = rn
	bdt, bdn = _service_request_base_doc_refs(sr)
	so.custom_base_reference = bdt
	so.custom_base_reference_name = bdn


def _resolve_template_item_code(template_dt, template_dn):
	"""Resolve billing Item from a service/lab template."""
	template_doc = frappe.get_doc(template_dt, template_dn)
	item_code = (
		getattr(template_doc, "item", None)
		or getattr(template_doc, "item_code", None)
		or getattr(template_doc, "service_item", None)
		or getattr(template_doc, "service_item_code", None)
	)
	if not item_code:
		frappe.throw(
			_("{0} {1} must have an Item or Item Code configured for billing").format(
				template_dt, template_dn
			)
		)
	if not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} does not exist in the system").format(item_code))
	return item_code, template_doc


def _ensure_lab_item_group(item_code):
	"""Ensure billing Item has an Item Group (create Lab Test group if missing)."""
	item_doc = frappe.get_doc("Item", item_code)
	if item_doc.item_group:
		return
	item_group_name = "Lab Test"
	if not frappe.db.exists("Item Group", item_group_name):
		item_group = frappe.new_doc("Item Group")
		item_group.item_group_name = item_group_name
		item_group.parent_item_group = "All Item Groups"
		item_group.insert(ignore_permissions=True)
	item_doc.item_group = item_group_name
	item_doc.save(ignore_permissions=True)


def _lab_request_sales_order_specs(sr):
	"""Expand multi-test lab baskets into concrete billed lines."""
	from healthcare.healthcare.lab_request_items import (
		apply_discounts_to_specs,
		expand_lab_test_specs,
		parse_lab_request_items,
	)

	request_items = parse_lab_request_items(sr)
	if not request_items or sr.template_dt != "Lab Test Template":
		return [], 0.0

	patient_care_type = _resolve_patient_care_type(
		getattr(sr, "patient_care_type", None),
		getattr(sr, "patient_visit", None),
		getattr(sr, "inpatient_record", None),
	)
	specs = expand_lab_test_specs(
		request_items, sr.patient, patient_care_type=patient_care_type
	)
	specs = apply_discounts_to_specs(specs, request_items)
	general_discount = _get_general_lab_discount(sr, request_items)
	return specs, general_discount


def _inpatient_lab_tests_included(sr) -> bool:
	"""Patient-specific lab coverage comes exclusively from the admission quotation."""
	if sr.get("template_dt") != "Lab Test Template" or not sr.get("inpatient_record"):
		return False
	from healthcare.healthcare.care_episode_guard import resolve_inpatient_admission_name
	from healthcare.api.inpatient_admission import _resolve_admission_package, is_enhanced_workflow_enabled

	if not is_enhanced_workflow_enabled():
		return False

	admission_name = resolve_inpatient_admission_name(sr.inpatient_record, sr.get("patient"))
	if not admission_name:
		return False
	admission = frappe.get_doc("Inpatient Admission", admission_name)
	if admission.patient != sr.get("patient"):
		return False
	package, source = _resolve_admission_package(admission)
	if not package and source != "custom":
		return False
	quotation = frappe.db.get_value(
		"Quotation",
		{"custom_inpatient_admission": admission_name,
		 "custom_package": package if package else ["is", "not set"],
		 "docstatus": ["<", 2]},
		["custom_include_lab_tests"], order_by="modified desc", as_dict=True,
	)
	return bool(quotation and cint(quotation.custom_include_lab_tests))


def _active_lab_request_sales_order(sr):
	"""Find existing billing even when the acceptance flag is inconsistent."""
	if sr.get("reference_document_type") == "Sales Order" and sr.get("reference_document_name"):
		if frappe.db.get_value("Sales Order", {"name": sr.reference_document_name, "docstatus": ["<", 2]}, "name", for_update=True):
			return sr.reference_document_name
	base_type, base_name = _service_request_base_doc_refs(sr)
	# Booking can change the base reference after the original request was billed.
	candidates = [("Service Request", sr.name), (base_type, base_name)]
	candidates.extend(("Lab Test", name) for name in frappe.get_all(
		"Lab Test", filters={"service_request": sr.name}, pluck="name"
	))
	for reference_type, reference_name in candidates:
		name = frappe.db.get_value(
			"Sales Order",
			{"custom_base_reference": reference_type, "custom_base_reference_name": reference_name,
			 "docstatus": ["<", 2]},
			"name", order_by="modified desc", for_update=True,
		)
		if name:
			return name
	return None


@frappe.whitelist()
def confirm_payment(service_request_name):

	if not service_request_name:
		frappe.throw(_("Service Request name is required"))

	from healthcare.api.inpatient_admission import is_enhanced_workflow_enabled

	# Serialize enhanced lab confirmation to avoid duplicate orders.
	is_lab = (
		is_enhanced_workflow_enabled()
		and frappe.db.get_value("Service Request", service_request_name, "template_dt") == "Lab Test Template"
	)
	if is_lab:
		frappe.db.sql("select name from `tabService Request` where name=%s for update", (service_request_name,))
	sr = frappe.get_doc("Service Request", service_request_name, for_update=is_lab)

	# Preserve legacy confirmation for all requests outside enhanced lab billing.
	if not is_lab and sr.patient_accepted_cost:
		return {"ok": True, "patient_accepted_cost": 1}

	# Validate dynamic template
	if not sr.template_dt or not sr.template_dn:
		frappe.throw(_("Template is required"))

	if is_lab:
		existing_order = _active_lab_request_sales_order(sr)
		if existing_order:
			sr.db_set("patient_accepted_cost", 1)
			return {"ok": True, "patient_accepted_cost": 1, "sales_order": existing_order,
				"message": _("Existing Sales Order retained; no new charges created")}
		if _inpatient_lab_tests_included(sr):
			sr.db_set("patient_accepted_cost", 1)
			return {"ok": True, "patient_accepted_cost": 1, "covered_by_package": True,
				"sales_order": None, "message": _("Lab Tests are included in the admission package")}

	delivery_date = sr.expected_date or nowdate()

	# ------------------------
	# Create Sales Order
	# ------------------------
	so = frappe.new_doc("Sales Order")
	so.patient = sr.patient
	if getattr(sr, "company", None):
		so.company = sr.company

	customer = frappe.db.get_value("Patient", sr.patient, "customer") if sr.patient else None
	if not customer:
		frappe.throw(
			_("Patient {0} has no Customer linked. Link a customer on the patient record first.").format(
				sr.patient
			)
		)

	so.customer = customer
	so.transaction_date = nowdate()
	so.delivery_date = delivery_date
	so.ignore_pricing_rule = 1

	from healthcare.controllers.insurance_pricing import sales_item_from_list_and_discount

	lab_specs, general_discount = _lab_request_sales_order_specs(sr)
	visit_charge_rows = []

	if lab_specs:
		# One Sales Order line per concrete child lab test (not per group parent).
		for spec in lab_specs:
			tpl = spec.get("template")
			item_code, _template_doc = _resolve_template_item_code("Lab Test Template", tpl)
			_ensure_lab_item_group(item_code)
			lab_test_name = (
				frappe.db.get_value("Lab Test Template", tpl, "lab_test_name") or tpl
			)
			if spec.get("billed_from_parent_group"):
				lab_test_name = f"{lab_test_name} (group charge)"
			list_rate = flt(spec.get("amount") or 0)
			net_rate = flt(
				spec.get("net_amount") if spec.get("net_amount") is not None else list_rate
			)
			disc_type = (spec.get("discount_type") or "Amount").strip()
			so.append(
				"items",
				sales_item_from_list_and_discount(
					item_code=item_code,
					list_rate=list_rate,
					discount_pct=flt(spec.get("discount_rate") or 0) if disc_type == "Percentage" else 0,
					discount_amount=flt(spec.get("discount") or 0) if disc_type == "Amount" else 0,
					net_rate=net_rate,
					description=f"{lab_test_name} ({sr.name})",
				),
			)
			visit_charge_rows.append(
				{
					"sr_no": sr.name,
					"test_name": lab_test_name,
					"lab_test_template": tpl,
					"lab_test_group": spec.get("parent_group"),
					"amount": list_rate,
					"discount_type": disc_type,
					"discount_rate": flt(spec.get("discount_rate") or 0) if disc_type == "Percentage" else 0,
					"discount": flt(spec.get("discount") or 0) if disc_type == "Amount" else 0,
					"net_amount": net_rate,
				}
			)
		if general_discount:
			# ERPNext Sales Order additional/header discount field is discount_amount
			# (not additional_discount_amount).
			so.apply_discount_on = "Grand Total"
			so.discount_amount = flt(general_discount)
			so.additional_discount_percentage = 0
	else:
		# Legacy / non-basket: single template line.
		item_code, template_doc = _resolve_template_item_code(sr.template_dt, sr.template_dn)
		_ensure_lab_item_group(item_code)
		amount = (
			getattr(template_doc, "lab_test_rate", None)
			or getattr(template_doc, "rate", None)
			or getattr(template_doc, "amount", None)
			or 0
		)
		list_rate = flt(sr.cost) or flt(amount) or 0
		net_rate = flt(sr.grand_total) or list_rate
		so.append(
			"items",
			sales_item_from_list_and_discount(
				item_code=item_code,
				list_rate=list_rate,
				discount_pct=flt(sr.discount),
				discount_amount=flt(sr.discount_amount),
				net_rate=net_rate,
				description=f"Service Request {sr.name}",
			),
		)
		visit_charge_rows.append(
			{
				"sr_no": sr.name,
				"test_name": sr.template_dn or "",
				"lab_test_template": sr.template_dn if sr.template_dt == "Lab Test Template" else None,
				"amount": list_rate or 0,
				"discount_type": "Percentage" if flt(sr.discount) else "Amount",
				"discount_rate": flt(sr.discount) or 0,
				"discount": flt(sr.discount_amount) or 0,
				"net_amount": net_rate or 0,
			}
		)

	apply_service_request_refs_to_sales_order(so, sr)
	apply_cost_center_to_sales_order(so, cost_center_from_service_request(sr))

	so.insert(ignore_permissions=True)
	so.submit()

	# Update Service Request
	sr.db_set("patient_accepted_cost", 1)
	sr.db_set("reference_document_type", "Sales Order")
	sr.db_set("reference_document_name", so.name)

	patient_visit_name = getattr(sr, "patient_visit", None)

	if patient_visit_name:
		try:
			visit = frappe.get_doc("Patient Visit", patient_visit_name)

			existing_templates = {
				(row.get("lab_test_template") or "").strip()
				for row in visit.get("lab_tests_charges", [])
			}
			already_for_sr = any(
				(row.get("sr_no") or "").strip() == sr.name
				for row in visit.get("lab_tests_charges", [])
			)
			added = False
			if not already_for_sr:
				for row in visit_charge_rows:
					key = (row.get("lab_test_template") or "").strip()
					if key and key in existing_templates:
						continue
					visit.append("lab_tests_charges", row)
					if key:
						existing_templates.add(key)
					added = True
			if added:
				visit.save(ignore_permissions=True)
				frappe.db.commit()

		except Exception:
			frappe.log_error(
				title="Failed to update Patient Visit lab charges",
				message=frappe.get_traceback()
			)
			# We don't throw here — SO was already created, don't block the flow

		# Lab Visit types already charged a registration SO; remove it so the patient
		# is not billed twice when this lab Sales Order is created for the same visit.
		try:
			from healthcare.api.patient_visit_charge import remove_lab_visit_registration_charge

			remove_lab_visit_registration_charge(patient_visit_name)
		except Exception:
			frappe.log_error(
				title="Failed to remove lab-visit registration charge",
				message=frappe.get_traceback(),
			)

	frappe.db.commit()

	return {
		"ok": True,
		"patient_accepted_cost": 1,
		"sales_order": so.name,
		"item_count": len(so.items),
	}


@frappe.whitelist(allow_guest=False)
def confirm_session_payment(service_request_name):
	"""
	Confirm payment for non-Lab Test service requests.
	Looks up the item/item_code from the linked template, creates a Sales Order,
	and marks the service request as payment accepted.
	"""
	if not service_request_name:
		frappe.throw(_("Service Request name is required"))

	sr = frappe.get_doc("Service Request", service_request_name)

	if sr.patient_accepted_cost:
		return {"ok": True, "patient_accepted_cost": 1}

	if not sr.template_dt or not sr.template_dn:
		frappe.throw(_("Template is required on the Service Request"))

	template_doc = frappe.get_doc(sr.template_dt, sr.template_dn)

	# Resolve item code — templates use either `item` (Link) or `item_code` (Data)
	item_code = (
		getattr(template_doc, "item", None)
		or getattr(template_doc, "item_code", None)
	)
	if not item_code:
		frappe.throw(
			_("{0} '{1}' must have an Item or Item Code configured before confirming payment").format(
				sr.template_dt, sr.template_dn
			)
		)

	from healthcare.controllers.insurance_pricing import sales_item_from_list_and_discount

	list_rate = frappe.utils.flt(sr.cost) or 0
	net_rate = frappe.utils.flt(sr.grand_total) or list_rate
	delivery_date = sr.get("expected_date") or nowdate()

	customer = frappe.db.get_value("Patient", sr.patient, "customer") if sr.patient else None
	if not customer:
		frappe.throw(
			_("Patient {0} has no Customer linked. Link a customer on the patient record first.").format(
				sr.patient
			)
		)

	so = frappe.new_doc("Sales Order")
	so.patient = sr.patient
	if getattr(sr, "company", None):
		so.company = sr.company
	so.customer = customer
	so.transaction_date = nowdate()
	so.delivery_date = delivery_date
	so.ignore_pricing_rule = 1
	so.append(
		"items",
		sales_item_from_list_and_discount(
			item_code=item_code,
			list_rate=list_rate,
			discount_pct=frappe.utils.flt(sr.discount),
			discount_amount=frappe.utils.flt(sr.discount_amount),
			net_rate=net_rate,
			description=f"Service Request {sr.name}",
		),
	)
	apply_service_request_refs_to_sales_order(so, sr)
	apply_cost_center_to_sales_order(so, cost_center_from_service_request(sr))
	so.insert(ignore_permissions=True)
	so.submit()

	sr.db_set("patient_accepted_cost", 1)
	sr.db_set("status", "active-Request Status")
	sr.db_set("reference_document_type", "Sales Order")
	sr.db_set("reference_document_name", so.name)
	frappe.db.commit()

	return {"ok": True, "patient_accepted_cost": 1, "sales_order": so.name}


@frappe.whitelist(allow_guest=False)
def book_session(service_request_name, appointment=None):
	"""
	Book a session for a non-Lab Test service request.
	- For 'Consultation Service Template': creates a Consultation Service linked to the SR.
	  If an appointment name is provided it is linked to the SR and the Consultation Service.
	- For all other types: marks the SR as booked.
	"""
	if not service_request_name:
		frappe.throw(_("Service Request name is required"))

	sr = frappe.get_doc("Service Request", service_request_name)

	if not sr.patient_accepted_cost:
		frappe.throw(_("Payment must be confirmed before booking a session"))

	if sr.booked:
		return {"ok": True, "already_booked": True}

	created_doc = None

	# Link the Patient Appointment back to this Service Request
	if appointment and frappe.db.exists("Patient Appointment", appointment):
		frappe.db.set_value("Patient Appointment", appointment, "service_request", sr.name)

	if sr.template_dt == "Consultation Service Template":
		cs = frappe.new_doc("Consultation Service")
		cs.file_number = sr.patient
		cs.admission_no = sr.get("inpatient_record") or None
		cs.patient_full_name = (
			sr.patient_name
			or frappe.db.get_value("Patient", sr.patient, "patient_name")
			or ""
		)
		cs.cost_center = sr.cost_center or None
		cs.service_request = sr.name
		cs.type = "Internal Service"
		cs.flags.ignore_mandatory = True
		cs.flags.ignore_permissions = True
		cs.insert()
		created_doc = {"doctype": "Consultation Service", "name": cs.name}
	elif sr.template_dt == "Healthcare Service Template":
		if not sr.get("inpatient_record"):
			frappe.throw(_("An Inpatient Admission is required to book an IP Service request"))
		if not sr.get("cost_center"):
			frappe.throw(_("Cost Center is required on the Service Request before booking"))

		template_category = None
		if sr.get("template_dn") and frappe.db.exists("Healthcare Service Template", sr.template_dn):
			template_category = frappe.db.get_value("Healthcare Service Template", sr.template_dn, "category")

		from healthcare.api.ip_service import create_ip_service

		result = create_ip_service(
			admission_no=sr.inpatient_record,
			cost_center=sr.cost_center,
			service_request=sr.name,
			type="Internal Service",
			category=template_category or None,
		)
		ip_service_name = result.get("name") if isinstance(result, dict) else None
		if ip_service_name:
			created_doc = {"doctype": "IP Service", "name": ip_service_name}

	sr.db_set("booked", 1)
	frappe.db.commit()

	return {
		"ok": True,
		"booked": 1,
		"created": created_doc,
	}


# ---------------------------------------------------------------------------
# Cascade delete — unlink visit rows, delete labs, cancel/delete Sales Order
# ---------------------------------------------------------------------------

_CASCADE_DELETE_ROLES = (
	"System Manager",
	"Healthcare Administrator",
	"Administrator",
)


def _require_cascade_delete_permission(sr_name: str) -> None:
	user = frappe.session.user
	if user == "Administrator":
		return
	roles = set(frappe.get_roles(user))
	if roles.intersection(_CASCADE_DELETE_ROLES):
		return
	if frappe.has_permission("Service Request", "delete", doc=sr_name, user=user):
		return
	frappe.throw(
		_("You do not have permission to cascade-delete Service Request {0}.").format(sr_name),
		frappe.PermissionError,
	)


def _linked_docs_for_service_request(sr_name: str) -> dict:
	"""Collect documents that normally block deleting this Service Request."""
	sr_name = (sr_name or "").strip()
	lab_tests = frappe.get_all(
		"Lab Test",
		filters={"service_request": sr_name},
		pluck="name",
		order_by="creation asc",
	)
	clinical_procedures = []
	if frappe.db.exists("DocType", "Clinical Procedure"):
		clinical_procedures = frappe.get_all(
			"Clinical Procedure",
			filters={"service_request": sr_name},
			pluck="name",
		)
	therapy_sessions = []
	if frappe.db.exists("DocType", "Therapy Session"):
		therapy_sessions = frappe.get_all(
			"Therapy Session",
			filters={"service_request": sr_name},
			pluck="name",
		)
	observations = []
	if frappe.db.exists("DocType", "Observation"):
		observations = frappe.get_all(
			"Observation",
			filters={"service_request": sr_name},
			pluck="name",
		)

	sales_orders: list[str] = []
	ref_type = frappe.db.get_value("Service Request", sr_name, "reference_document_type")
	ref_name = frappe.db.get_value("Service Request", sr_name, "reference_document_name")
	if ref_type == "Sales Order" and ref_name:
		sales_orders.append(ref_name)
	so_meta = frappe.get_meta("Sales Order")
	if so_meta.has_field("custom_base_reference_name"):
		for so in frappe.get_all(
			"Sales Order",
			filters={
				"custom_base_reference": "Service Request",
				"custom_base_reference_name": sr_name,
			},
			pluck="name",
		):
			if so not in sales_orders:
				sales_orders.append(so)

	amended_by = frappe.get_all(
		"Service Request",
		filters={"amended_from": sr_name},
		pluck="name",
	)
	# Other SRs that Dynamic-Link back to this one (order / reason references).
	for filters in (
		{"order_reference_doctype": "Service Request", "order_reference_name": sr_name},
		{"reason_reference_doctype": "Service Request", "reason_reference": sr_name},
	):
		try:
			for other in frappe.get_all("Service Request", filters=filters, pluck="name"):
				if other and other not in amended_by and other != sr_name:
					amended_by.append(other)
		except Exception:
			pass

	visit_names: list[str] = []
	patient_visit = frappe.db.get_value("Service Request", sr_name, "patient_visit")
	order_group = frappe.db.get_value("Service Request", sr_name, "order_group")
	order_group_dt = frappe.db.get_value("Service Request", sr_name, "order_group_doctype")
	for candidate in (patient_visit, order_group if order_group_dt in (None, "", "Patient Visit") else None):
		if candidate and frappe.db.exists("Patient Visit", candidate) and candidate not in visit_names:
			visit_names.append(candidate)
	# Visits that still have prescription / charge rows for this SR
	for row in frappe.get_all(
		"Lab Prescription",
		filters={"service_request": sr_name},
		fields=["parent"],
		distinct=True,
	):
		parent = row.get("parent")
		if parent and parent not in visit_names and frappe.db.exists("Patient Visit", parent):
			visit_names.append(parent)
	if frappe.db.exists("DocType", "Lab Tests Charges"):
		for row in frappe.get_all(
			"Lab Tests Charges",
			filters={"sr_no": sr_name},
			fields=["parent"],
			distinct=True,
		):
			parent = row.get("parent")
			if parent and parent not in visit_names and frappe.db.exists("Patient Visit", parent):
				visit_names.append(parent)

	return {
		"lab_tests": lab_tests,
		"clinical_procedures": clinical_procedures,
		"therapy_sessions": therapy_sessions,
		"observations": observations,
		"sales_orders": sales_orders,
		"amended_service_requests": amended_by,
		"patient_visits": visit_names,
	}


def _format_cascade_delete_message(sr_name: str, linked: dict) -> str:
	parts = []
	if linked.get("lab_tests"):
		names = linked["lab_tests"]
		shown = ", ".join(names[:10])
		more = len(names) - 10
		label = shown + (f", and {more} more" if more > 0 else "")
		parts.append(_("Lab Test: {0}").format(label))
	if linked.get("clinical_procedures"):
		parts.append(_("Clinical Procedure: {0}").format(", ".join(linked["clinical_procedures"])))
	if linked.get("therapy_sessions"):
		parts.append(_("Therapy Session: {0}").format(", ".join(linked["therapy_sessions"])))
	if linked.get("observations"):
		parts.append(_("Observation: {0}").format(", ".join(linked["observations"])))
	if linked.get("amended_service_requests"):
		parts.append(
			_("Service Request (will unlink amended_from): {0}").format(
				", ".join(linked["amended_service_requests"])
			)
		)
	if linked.get("sales_orders"):
		parts.append(_("Sales Order: {0}").format(", ".join(linked["sales_orders"])))
	if linked.get("patient_visits"):
		parts.append(
			_("Patient Visit (keep visit — remove lab rows only): {0}").format(
				", ".join(linked["patient_visits"])
			)
		)

	if not parts:
		return _("Delete Service Request {0}? No linked Lab Tests / Sales Orders were found.").format(
			sr_name
		)

	return _(
		"{0} is linked with the following documents:\n\n{1}\n\n"
		"Do you want to delete {0} along with linked Lab Tests / billing? "
		"Patient Visit will be kept; only its lab child rows for this request will be removed."
	).format(sr_name, "\n".join(parts))


def _unlink_service_request_from_patient_visits(
	sr_name: str, lab_test_names: list[str], visit_names: list[str]
) -> list[str]:
	"""Remove Lab Prescription / Lab Tests Charges rows for this SR. Never delete the visit."""
	touched: list[str] = []
	lab_test_set = set(lab_test_names or [])

	for visit_name in visit_names or []:
		if not visit_name or not frappe.db.exists("Patient Visit", visit_name):
			continue
		visit = frappe.get_doc("Patient Visit", visit_name)
		changed = False

		if visit.meta.has_field("lab_test_prescription"):
			keep = [
				row
				for row in (visit.get("lab_test_prescription") or [])
				if (getattr(row, "service_request", None) or "").strip() != sr_name
			]
			if len(keep) != len(visit.get("lab_test_prescription") or []):
				visit.set("lab_test_prescription", keep)
				changed = True

		if visit.meta.has_field("procedure_prescription"):
			keep = [
				row
				for row in (visit.get("procedure_prescription") or [])
				if (getattr(row, "service_request", None) or "").strip() != sr_name
			]
			if len(keep) != len(visit.get("procedure_prescription") or []):
				visit.set("procedure_prescription", keep)
				changed = True

		if visit.meta.has_field("lab_tests_charges"):
			keep = []
			for row in visit.get("lab_tests_charges") or []:
				sr_no = (getattr(row, "sr_no", None) or "").strip()
				test_code = (getattr(row, "test_code", None) or "").strip()
				if sr_no == sr_name or (test_code and test_code in lab_test_set):
					continue
				keep.append(row)
			if len(keep) != len(visit.get("lab_tests_charges") or []):
				visit.set("lab_tests_charges", keep)
				changed = True

		if not changed:
			continue

		visit.flags.ignore_permissions = True
		visit.flags.ignore_validate_update_after_submit = True
		visit.flags.ignore_mandatory = True
		try:
			visit.save(ignore_permissions=True)
		except Exception:
			# Fallback: delete child rows directly if save is blocked.
			frappe.db.delete("Lab Prescription", {"parent": visit_name, "service_request": sr_name})
			if frappe.db.exists("DocType", "Lab Tests Charges"):
				frappe.db.delete("Lab Tests Charges", {"parent": visit_name, "sr_no": sr_name})
				if lab_test_set:
					frappe.db.sql(
						"""
						DELETE FROM `tabLab Tests Charges`
						WHERE parent = %s AND test_code IN ({})
						""".format(",".join(["%s"] * len(lab_test_set))),
						tuple([visit_name, *lab_test_set]),
					)
			frappe.db.set_value("Patient Visit", visit_name, "modified", frappe.utils.now(), update_modified=False)
		touched.append(visit_name)

	return touched


def _cancel_and_delete_doc(doctype: str, name: str) -> None:
	if not name or not frappe.db.exists(doctype, name):
		return
	doc = frappe.get_doc(doctype, name)
	if cint(doc.docstatus) == 1:
		try:
			doc.cancel()
		except Exception:
			frappe.db.set_value(doctype, name, "docstatus", 2, update_modified=False)
	if frappe.db.exists(doctype, name):
		frappe.delete_doc(doctype, name, ignore_permissions=True, force=1)


def _retire_sales_orders_for_cascade(sr, sales_order_names: list[str]) -> list[str]:
	"""Cancel invoices + cancel/delete Sales Orders linked to this Service Request."""
	retired: list[str] = []
	# Prefer the in-memory SR reference first.
	try:
		result = _retire_lab_request_sales_order(sr)
		prev = result.get("previous_sales_order")
		if prev:
			retired.append(prev)
	except Exception:
		frappe.log_error(
			title=f"Cascade delete: failed to retire Sales Order for {sr.name}",
			message=frappe.get_traceback(),
		)

	for so_name in sales_order_names or []:
		so_name = (so_name or "").strip()
		if not so_name or so_name in retired:
			continue
		if not frappe.db.exists("Sales Order", so_name):
			continue
		_unlink_service_requests_from_sales_order(so_name, preferred_sr=sr)
		for si_name in _sales_invoices_for_sales_order(so_name):
			_cancel_or_delete_sales_invoice(si_name)
		_cancel_and_delete_doc("Sales Order", so_name)
		# Cancelled SOs may remain — force delete after cancel.
		if frappe.db.exists("Sales Order", so_name):
			frappe.delete_doc("Sales Order", so_name, ignore_permissions=True, force=1)
		retired.append(so_name)
	return retired


@frappe.whitelist()
def preview_cascade_delete_service_request(name: str) -> dict:
	"""Return linked docs + confirmation message for cascade delete on Service Request."""
	name = (name or "").strip()
	if not name:
		frappe.throw(_("Service Request name is required"))
	if not frappe.db.exists("Service Request", name):
		frappe.throw(_("Service Request {0} not found").format(name))
	_require_cascade_delete_permission(name)
	linked = _linked_docs_for_service_request(name)
	return {
		"service_request": name,
		"linked": linked,
		"message": _format_cascade_delete_message(name, linked),
	}


@frappe.whitelist()
def cascade_delete_service_request(name: str) -> dict:
	"""Delete a Service Request and linked clinical/billing docs in one step.

	Patient Visit is never deleted — only Lab Prescription / Lab Tests Charges rows
	for this request are removed.
	"""
	name = (name or "").strip()
	if not name:
		frappe.throw(_("Service Request name is required"))
	if not frappe.db.exists("Service Request", name):
		frappe.throw(_("Service Request {0} not found").format(name))
	_require_cascade_delete_permission(name)

	assert_editing_allowed()

	sr = frappe.get_doc("Service Request", name)
	linked = _linked_docs_for_service_request(name)
	lab_tests = list(linked.get("lab_tests") or [])

	# 1) Unlink Patient Visit child rows first (so visit no longer blocks delete).
	visits_updated = _unlink_service_request_from_patient_visits(
		name, lab_tests, linked.get("patient_visits") or []
	)

	# 2) Unlink other Service Requests that point at this one (do not delete them).
	for other in linked.get("amended_service_requests") or []:
		if not frappe.db.exists("Service Request", other):
			continue
		updates = {}
		row = frappe.db.get_value(
			"Service Request",
			other,
			[
				"amended_from",
				"order_reference_doctype",
				"order_reference_name",
				"reason_reference_doctype",
				"reason_reference",
			],
			as_dict=True,
		) or {}
		if (row.get("amended_from") or "") == name:
			updates["amended_from"] = None
		if (row.get("order_reference_doctype") or "") == "Service Request" and (
			row.get("order_reference_name") or ""
		) == name:
			updates["order_reference_doctype"] = None
			updates["order_reference_name"] = None
		if (row.get("reason_reference_doctype") or "") == "Service Request" and (
			row.get("reason_reference") or ""
		) == name:
			updates["reason_reference_doctype"] = None
			updates["reason_reference"] = None
		if updates:
			frappe.db.set_value("Service Request", other, updates, update_modified=False)

	# 3) Delete linked Lab Tests (force path: cancel submitted + samples).
	from healthcare.api.lab_request_actions import _force_remove_lab_test

	deleted_lab_tests: list[str] = []
	for lt_name in lab_tests:
		if not frappe.db.exists("Lab Test", lt_name):
			continue
		_force_remove_lab_test(lt_name)
		deleted_lab_tests.append(lt_name)

	# 4) Other clinical fulfillments linked by service_request.
	deleted_other: list[str] = []
	for doctype, names in (
		("Clinical Procedure", linked.get("clinical_procedures") or []),
		("Therapy Session", linked.get("therapy_sessions") or []),
		("Observation", linked.get("observations") or []),
	):
		for docname in names:
			_cancel_and_delete_doc(doctype, docname)
			deleted_other.append(f"{doctype}:{docname}")

	# 5) Sales Order (+ invoices): cancel then delete.
	retired_sales_orders = _retire_sales_orders_for_cascade(sr, linked.get("sales_orders") or [])

	# 6) Clear any remaining SR → Sales Order / medical-record links, then delete SR.
	_delete_patient_medical = None
	try:
		from healthcare.api.lab_request_actions import _delete_patient_medical_records_for_reference

		_delete_patient_medical = _delete_patient_medical_records_for_reference
	except Exception:
		pass
	if _delete_patient_medical:
		_delete_patient_medical("Service Request", name)

	# Ensure reference fields are cleared before delete.
	if frappe.db.exists("Service Request", name):
		frappe.db.set_value(
			"Service Request",
			name,
			{
				"reference_document_type": None,
				"reference_document_name": None,
				"patient_accepted_cost": 0,
			},
			update_modified=False,
		)
		if cint(frappe.db.get_value("Service Request", name, "docstatus")) == 1:
			try:
				frappe.get_doc("Service Request", name).cancel()
			except Exception:
				frappe.db.set_value("Service Request", name, "docstatus", 2, update_modified=False)
		if frappe.db.exists("Service Request", name):
			frappe.delete_doc("Service Request", name, ignore_permissions=True, force=1)

	frappe.db.commit()

	return {
		"ok": True,
		"deleted_service_request": name,
		"deleted_lab_tests": deleted_lab_tests,
		"deleted_other": deleted_other,
		"retired_sales_orders": retired_sales_orders,
		"patient_visits_unlinked": visits_updated,
		"unlinked_amended_service_requests": linked.get("amended_service_requests") or [],
	}


# ---------------------------------------------------------------------------
# Bulk cleanup: all ERPNext-created (non-legacy) lab Service Requests through
# cutoff. Cascade-deletes linked app Lab Tests + Sales Orders; keeps visits
# and legacy LAB/… imports. Same Healthcare Settings button as before.
# ---------------------------------------------------------------------------

_LEGACY_DUP_SR_CUTOFF_DATE = "2026-11-01"


def _find_erpnext_lab_service_requests_through_cutoff(cutoff_date: str | None = None) -> list[dict]:
	"""All non-legacy lab Service Requests with ``order_date <= cutoff`` (default 2026-11-01)."""
	cutoff = (cutoff_date or _LEGACY_DUP_SR_CUTOFF_DATE).strip() or _LEGACY_DUP_SR_CUTOFF_DATE

	srs = frappe.get_all(
		"Service Request",
		filters={
			"template_dt": "Lab Test Template",
			"docstatus": ["<", 2],
			"legacy": 0,
			"order_date": ["<=", cutoff],
		},
		fields=[
			"name",
			"patient",
			"patient_name",
			"order_date",
			"template_dn",
			"status",
			"reference_document_type",
			"reference_document_name",
		],
		order_by="order_date desc, name",
	)
	if not srs:
		return []

	sr_names = [sr.name for sr in srs]
	labs_by_sr: dict[str, list[str]] = {name: [] for name in sr_names}
	chunk = 500
	for i in range(0, len(sr_names), chunk):
		batch = sr_names[i : i + chunk]
		for lt in frappe.get_all(
			"Lab Test",
			filters={"service_request": ["in", batch], "docstatus": ["<", 2]},
			fields=["name", "service_request"],
		):
			labs_by_sr.setdefault(lt.service_request, []).append(lt.name)

	rows: list[dict] = []
	for sr in srs:
		sales_order = None
		if (sr.reference_document_type or "") == "Sales Order":
			sales_order = sr.reference_document_name
		rows.append(
			{
				"service_request": sr.name,
				"patient": sr.patient,
				"patient_name": sr.patient_name,
				"order_date": str(sr.order_date) if sr.order_date else "",
				"template_dn": sr.template_dn,
				"status": sr.status,
				"app_lab_tests": labs_by_sr.get(sr.name) or [],
				"sales_order": sales_order,
			}
		)
	return rows


# Back-compat alias for the Healthcare Settings button method names
_find_legacy_duplicate_lab_service_requests = _find_erpnext_lab_service_requests_through_cutoff


def _require_bulk_cascade_delete_permission() -> None:
	user = frappe.session.user
	if user == "Administrator":
		return
	roles = set(frappe.get_roles(user))
	if roles.intersection(_CASCADE_DELETE_ROLES):
		return
	frappe.throw(
		_("Only System Manager or Healthcare Administrator can run this cleanup."),
		frappe.PermissionError,
	)


@frappe.whitelist()
def preview_delete_legacy_duplicate_lab_service_requests(cutoff_date: str | None = None) -> dict:
	"""Preview all ERPNext-created lab Service Requests with order_date <= cutoff.

	Legacy LAB/… imports are not included. Default cutoff is 1 Nov 2026.
	"""
	_require_bulk_cascade_delete_permission()
	assert_editing_allowed()
	cutoff = (cutoff_date or _LEGACY_DUP_SR_CUTOFF_DATE).strip() or _LEGACY_DUP_SR_CUTOFF_DATE
	rows = _find_erpnext_lab_service_requests_through_cutoff(cutoff)
	sample = [
		{
			"service_request": r["service_request"],
			"patient_name": r["patient_name"],
			"order_date": r["order_date"],
			"template_dn": r.get("template_dn") or "",
			"app_lab_tests": ", ".join((r.get("app_lab_tests") or [])[:5]),
			"sales_order": r.get("sales_order") or "",
		}
		for r in rows[:25]
	]
	return {
		"cutoff_date": cutoff,
		"count": len(rows),
		"sample": sample,
		"service_requests": [r["service_request"] for r in rows],
	}


@frappe.whitelist()
def delete_legacy_duplicate_lab_service_requests(cutoff_date: str | None = None) -> dict:
	"""Cascade-delete all ERPNext-created lab Service Requests through cutoff.

	For each: delete linked app Lab Tests, cancel/delete Sales Order, unlink
	Patient Visit lab child rows, then delete the Service Request. Legacy LAB/…
	records are not deleted. Patient Visits are kept.
	"""
	_require_bulk_cascade_delete_permission()
	assert_editing_allowed()
	cutoff = (cutoff_date or _LEGACY_DUP_SR_CUTOFF_DATE).strip() or _LEGACY_DUP_SR_CUTOFF_DATE
	rows = _find_erpnext_lab_service_requests_through_cutoff(cutoff)

	deleted = []
	errors = []
	for row in rows:
		name = row["service_request"]
		if not frappe.db.exists("Service Request", name):
			continue
		try:
			result = cascade_delete_service_request(name)
			deleted.append(
				{
					"service_request": name,
					"deleted_lab_tests": result.get("deleted_lab_tests") or [],
					"retired_sales_orders": result.get("retired_sales_orders") or [],
					"patient_visits_unlinked": result.get("patient_visits_unlinked") or [],
				}
			)
			frappe.db.commit()
		except Exception as e:
			frappe.db.rollback()
			errors.append({"service_request": name, "error": strip_html(cstr(e))})
			frappe.log_error(
				title=f"Failed cascade delete of ERPNext lab SR {name}",
				message=frappe.get_traceback(),
			)

	return {
		"ok": True,
		"cutoff_date": cutoff,
		"matched": len(rows),
		"deleted_count": len(deleted),
		"deleted": deleted,
		"errors": errors,
	}
