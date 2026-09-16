# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Doctor commission generation from billed Sales Orders linked to configured source DocTypes."""

from __future__ import annotations

from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, now_datetime


GENERIC_PRACTITIONER_FIELDS = [
	"practitioner",
	"doctor",
	"healthcare_practitioner",
	"practioner",
	"primary_practitioner",
	"admission_by_doctor",
	"admission_practitioner",
	"discharge_doctor",
	"discharge_practitioner",
]

DOCTYPE_PRACTITIONER_FIELDS = {
	"Patient Visit": ["practitioner"],
	"Service Request": ["practitioner"],
	"Patient Appointment": ["practitioner"],
	"Patient Medication Order": ["practitioner"],
	"Lab Test": ["practitioner"],
	"Medication Request": ["practitioner"],
	"Therapy Session": ["practitioner"],
	"Session Schedule": ["doctor", "practitioner"],
	"Inpatient Admission": [
		"primary_practitioner",
		"admission_by_doctor",
		"admission_practitioner",
	],
	"Discharge": ["discharge_doctor", "discharge_practitioner"],
	"Observation": ["healthcare_practitioner"],
	"IP Service": ["practioner"],
}

OP_COMMISSION_SOURCE_DOCTYPE = "Patient Visit"


def get_doctor_commission_generation_settings() -> dict[str, int]:
	"""Healthcare Settings that scope commission payroll generation."""
	return {
		"op_only": cint(
			frappe.db.get_single_value(
				"Healthcare Settings", "calculate_doctors_commission_from_op_only"
			)
		),
		"paid_only": cint(
			frappe.db.get_single_value(
				"Healthcare Settings", "calculate_doctors_comission_on_paid_service_only"
			)
		),
		"backdated_days": cint(
			frappe.db.get_single_value(
				"Healthcare Settings", "backdated_days_for_unpaid_commission"
			)
		),
	}


def filter_commission_sources_for_settings(sources, *, op_only: bool = False):
	"""When OP-only is enabled, keep only Patient Visit commission sources."""
	if not op_only:
		return list(sources or [])
	filtered = [
		s
		for s in (sources or [])
		if (getattr(s, "source_doctype", None) or s.get("source_doctype") or "").strip()
		== OP_COMMISSION_SOURCE_DOCTYPE
	]
	return filtered


def generate_doctor_commission_period(period_doc, include_backdated: bool | int = False):
	"""Fill Doctor Commission Payroll child tables from Sales Order service lines."""
	period_doc = period_doc if hasattr(period_doc, "doctors") else frappe.get_doc(
		"Doctor Commission Payroll", period_doc
	)
	include_backdated = cint(include_backdated)

	sources = get_enabled_commission_sources()
	gen_settings = get_doctor_commission_generation_settings()
	sources = filter_commission_sources_for_settings(sources, op_only=gen_settings["op_only"])
	if not sources:
		if gen_settings["op_only"]:
			frappe.throw(
				_(
					"Calculate Doctors Commission from OP Only is enabled in Healthcare Settings, "
					"but Patient Visit is not enabled as a Doctor Commission Source."
				)
			)
		frappe.throw(
			_(
				"No enabled Doctor Commission Source records found. "
				"Add DocTypes that should earn commission (e.g. Session Schedule) first."
			)
		)

	source_doctypes = [s.source_doctype for s in sources]
	rules = load_active_commission_rules(period_doc.from_date, period_doc.to_date)
	allowed_branches = resolve_payroll_cost_centers(period_doc, rules)
	fetch_kwargs = dict(
		company=period_doc.company,
		cost_center=period_doc.cost_center,
		cost_centers=None if (period_doc.cost_center or "").strip() else allowed_branches,
		source_doctypes=source_doctypes,
		op_only=gen_settings["op_only"],
		paid_only=gen_settings["paid_only"],
		exclude_commission_generated=True,
	)
	service_rows = fetch_commissionable_sales_order_items(
		from_date=period_doc.from_date,
		to_date=period_doc.to_date,
		**fetch_kwargs,
	)

	backdated_count = 0
	if include_backdated:
		backdated_rows = fetch_backdated_paid_commission_items(
			period_from=period_doc.from_date,
			period_to=period_doc.to_date,
			backdated_days=gen_settings["backdated_days"],
			**fetch_kwargs,
		)
		if backdated_rows:
			seen = {(r.sales_order, cint(r.idx or 0)) for r in service_rows}
			for row in backdated_rows:
				key = (row.sales_order, cint(row.idx or 0))
				if key in seen:
					continue
				service_rows.append(row)
				seen.add(key)
				backdated_count += 1

	if not service_rows:
		period_doc.set("doctors", [])
		period_doc.set("items", [])
		period_doc.total_service_amount = 0
		period_doc.total_cases = 0
		period_doc.total_commission = 0
		period_doc.status = "Generated"
		period_doc.generated_on = now_datetime()
		period_doc.generated_by = frappe.session.user
		period_doc.save(ignore_permissions=True)
		_clear_draft_commission_payslips(period_doc.name)
		return {"doctors": 0, "items": 0, "backdated_items": 0, "payslips": 0}

	practitioner_by_base = resolve_practitioners_for_sources(service_rows, sources)
	eligible = get_commission_eligible_practitioners(
		{p for p in practitioner_by_base.values() if p}
	)
	default_percent = flt(period_doc.default_commission_percent)
	if default_percent <= 0:
		default_percent = flt(frappe.db.get_single_value("Healthcare Settings", "doctors_commission"))

	item_groups = get_item_groups({r.item_code for r in service_rows if r.item_code})

	# Sort for stable case indexing per doctor/branch
	service_rows = sorted(
		service_rows,
		key=lambda r: (
			str(r.transaction_date or ""),
			str(r.sales_order or ""),
			cint(r.idx or 0),
		),
	)

	case_counter = defaultdict(int)
	detail_rows = []
	skipped_no_practitioner = 0
	skipped_not_eligible = 0

	for row in service_rows:
		key = (row.custom_base_reference, row.custom_base_reference_name)
		practitioner = practitioner_by_base.get(key)
		if not practitioner:
			skipped_no_practitioner += 1
			continue
		if practitioner not in eligible:
			skipped_not_eligible += 1
			continue

		branch = (row.cost_center or "").strip() or None
		case_key = (practitioner, branch or "")
		case_counter[case_key] += 1
		case_index = case_counter[case_key]

		# Match base rule (practitioner+cost_center only) for free_cases
		base_rule = match_base_commission_rule(
			rules,
			practitioner=practitioner,
			cost_center=branch,
			on_date=row.transaction_date,
		)

		# Match full rule (with item specificity) for commission calculation
		rule = match_commission_rule(
			rules,
			practitioner=practitioner,
			cost_center=branch,
			item_code=row.item_code,
			item_group=item_groups.get(row.item_code),
			on_date=row.transaction_date,
		)

		commission_amount, calc_type, percent_used = calculate_line_commission(
			rule=rule,
			service_amount=flt(row.amount),
			case_index=case_index,
			default_percent=default_percent,
			base_rule=base_rule,
		)

		details = eligible.get(practitioner) or {}
		line_base = {
			"practitioner": practitioner,
			"practitioner_name": details.get("practitioner_name") or "",
			"transaction_date": row.transaction_date,
			"patient": row.patient,
			"patient_name": row.custom_patient_name or "",
			"source_doctype": row.custom_base_reference,
			"source_name": row.custom_base_reference_name,
			"sales_order": row.sales_order,
			"item_code": row.item_code,
			"item_name": row.item_name,
			"cost_center": branch,
			"commission_rule": rule.name if rule else None,
			"calculation_type": calc_type,
			"commission_percent": percent_used,
			"case_index": case_index,
		}
		# One row per service line per mode of payment (from the rule's Payment Modes).
		for share in payment_mode_shares(
			rule.get("payment_modes") if rule else None,
			service_amount=flt(row.amount),
			qty=flt(row.qty),
			commission_amount=commission_amount,
		):
			detail_rows.append({**line_base, **share})

	doctor_map = defaultdict(
		lambda: {
			"cases_count": 0,
			"service_amount": 0.0,
			"calculated_commission": 0.0,
			"practitioner_name": "",
			"doctors_id": "",
			"cost_center": None,
		}
	)
	for line in detail_rows:
		dkey = (line["practitioner"], line.get("cost_center") or "")
		bucket = doctor_map[dkey]
		bucket["service_amount"] += flt(line["service_amount"])
		bucket["calculated_commission"] += flt(line["commission_amount"])
		bucket["practitioner_name"] = line.get("practitioner_name") or bucket["practitioner_name"]
		details = eligible.get(line["practitioner"]) or {}
		bucket["doctors_id"] = details.get("doctors_id") or line["practitioner"]
		bucket["cost_center"] = line.get("cost_center")
	# Cases are counted once per service line, not once per payment-mode row.
	for case_key, count in case_counter.items():
		if case_key in doctor_map:
			doctor_map[case_key]["cases_count"] = count

	period_doc.set("items", [])
	for line in detail_rows:
		period_doc.append("items", line)

	period_doc.set("doctors", [])
	for (practitioner, _branch), data in sorted(doctor_map.items(), key=lambda x: x[0][0]):
		details = eligible.get(practitioner) or {}
		period_doc.append(
			"doctors",
			{
				"practitioner": practitioner,
				"practitioner_name": data["practitioner_name"],
				"doctors_id": data["doctors_id"],
				"employee": getattr(details, "employee", None) or details.get("employee"),
				"cost_center": data["cost_center"],
				"cases_count": data["cases_count"],
				"service_amount": data["service_amount"],
				"calculated_commission": data["calculated_commission"],
				"adjusted_commission": data["calculated_commission"],
			},
		)

	period_doc._recalc_totals()
	period_doc.status = "Generated"
	period_doc.generated_on = now_datetime()
	period_doc.generated_by = frappe.session.user
	period_doc.save(ignore_permissions=True)

	# Draft Commission Payslips — one per doctor, services split per payment mode.
	payslips = build_commission_payslips_for_payroll(period_doc, replace=True)

	return {
		"doctors": len(period_doc.doctors or []),
		"items": len(period_doc.items or []),
		"backdated_items": backdated_count,
		"skipped_no_practitioner": skipped_no_practitioner,
		"skipped_not_eligible": skipped_not_eligible,
		"payslips": payslips.get("payslips", 0),
		"payslip_items": payslips.get("items", 0),
	}


def fetch_backdated_paid_commission_items(
	period_from,
	period_to,
	backdated_days: int = 0,
	**fetch_kwargs,
):
	"""Paid Sales Orders before the payroll period whose commission was never generated.

	Window: [to_date - backdated_days, from_date) — services offered earlier that only
	became paid (or remained unmarked) by the time this payroll runs.
	"""
	days = cint(backdated_days)
	if days <= 0:
		return []

	period_from = getdate(period_from)
	period_to = getdate(period_to)
	back_from = add_days(period_to, -days)
	back_to = add_days(period_from, -1)
	if back_from > back_to:
		return []

	# Always require paid for late-paid catch-up, regardless of period paid_only setting.
	kwargs = dict(fetch_kwargs)
	kwargs["paid_only"] = True
	kwargs["exclude_commission_generated"] = True
	return fetch_commissionable_sales_order_items(
		from_date=back_from,
		to_date=back_to,
		**kwargs,
	)


def fetch_commissionable_sales_order_items(
	from_date,
	to_date,
	company=None,
	cost_center=None,
	cost_centers=None,
	source_doctypes=None,
	op_only: bool = False,
	paid_only: bool = False,
	exclude_commission_generated: bool = False,
):
	"""Sales Order item lines billed against configured commission source DocTypes."""
	if not source_doctypes:
		return []

	if op_only:
		source_doctypes = [OP_COMMISSION_SOURCE_DOCTYPE]

	source_doctypes = [dt for dt in (source_doctypes or []) if dt]
	if not source_doctypes:
		return []

	so_meta = frappe.get_meta("Sales Order")
	conditions = [
		"so.docstatus = 1",
		"so.transaction_date >= %(from_date)s",
		"so.transaction_date <= %(to_date)s",
		"IFNULL(so.custom_base_reference, '') != ''",
		"IFNULL(so.custom_base_reference_name, '') != ''",
		"so.custom_base_reference IN %(source_doctypes)s",
	]
	values = {
		"from_date": getdate(from_date),
		"to_date": getdate(to_date),
		"source_doctypes": tuple(source_doctypes),
	}

	if paid_only:
		# Match Patient Visit billing: commission only when the Sales Order is fully paid.
		conditions.append(
			"(COALESCE(so.grand_total, 0) <= 0 OR COALESCE(so.advance_paid, 0) >= COALESCE(so.grand_total, 0))"
		)

	if exclude_commission_generated and so_meta.has_field("custom_commission_generated"):
		conditions.append("IFNULL(so.custom_commission_generated, 0) = 0")

	# cost_center may be on SO header and/or item; prefer header then item
	has_so_cc = so_meta.has_field("cost_center")
	has_soi_cc = frappe.get_meta("Sales Order Item").has_field("cost_center")

	if company:
		conditions.append("so.company = %(company)s")
		values["company"] = company

	cc_expr = "NULL"
	if has_so_cc and has_soi_cc:
		cc_expr = "IFNULL(so.cost_center, soi.cost_center)"
	elif has_so_cc:
		cc_expr = "so.cost_center"
	elif has_soi_cc:
		cc_expr = "soi.cost_center"

	# Single payroll/report branch filter, or an explicit list from commission rules.
	# ``cost_centers is None`` → no branch restriction (e.g. commission report).
	# ``cost_centers == []`` → intentionally empty (no matching rule branches).
	branch_list: list[str] | None = None
	single = (cost_center or "").strip()
	if single:
		branch_list = [single]
	elif cost_centers is not None:
		branch_list = [
			(cc or "").strip()
			for cc in (cost_centers or [])
			if (cc or "").strip()
		]

	if branch_list is not None:
		if not branch_list:
			return []
		values["cost_centers"] = tuple(branch_list)
		if has_so_cc and has_soi_cc:
			conditions.append(
				"(IFNULL(so.cost_center, '') IN %(cost_centers)s "
				"OR IFNULL(soi.cost_center, '') IN %(cost_centers)s)"
			)
		elif has_so_cc:
			conditions.append("so.cost_center IN %(cost_centers)s")
		elif has_soi_cc:
			conditions.append("soi.cost_center IN %(cost_centers)s")
		else:
			frappe.throw(
				_(
					"Sales Order has no Cost Center field, so commission cannot be "
					"limited to branches defined on Doctor Commission Rules."
				)
			)
	return frappe.db.sql(
		f"""
		SELECT
			so.name AS sales_order,
			so.transaction_date,
			so.patient,
			so.custom_patient_name,
			so.custom_base_reference,
			so.custom_base_reference_name,
			soi.idx,
			soi.item_code,
			soi.item_name,
			soi.qty,
			soi.amount,
			{cc_expr} AS cost_center
		FROM `tabSales Order` so
		INNER JOIN `tabSales Order Item` soi
			ON soi.parent = so.name AND soi.parenttype = 'Sales Order'
		WHERE {" AND ".join(conditions)}
		ORDER BY so.transaction_date ASC, so.name ASC, soi.idx ASC
		""",
		values,
		as_dict=True,
	)


def set_sales_orders_commission_generated(sales_orders, value: int = 1):
	"""Tick/untick Sales Order.custom_commission_generated for payroll submit/cancel."""
	if not frappe.get_meta("Sales Order").has_field("custom_commission_generated"):
		return
	names = sorted({(so or "").strip() for so in (sales_orders or []) if (so or "").strip()})
	if not names:
		return
	flag = 1 if cint(value) else 0
	for chunk_start in range(0, len(names), 200):
		chunk = names[chunk_start : chunk_start + 200]
		frappe.db.sql(
			"""
			UPDATE `tabSales Order`
			SET custom_commission_generated = %(flag)s
			WHERE name IN %(names)s
			""",
			{"flag": flag, "names": tuple(chunk)},
		)


def get_enabled_commission_sources():
	return frappe.get_all(
		"Doctor Commission Source",
		filters={"enabled": 1},
		fields=["name", "source_doctype", "practitioner_field"],
		order_by="source_doctype asc",
	)


def resolve_practitioners_for_sources(rows, sources):
	"""Map (source_doctype, source_name) -> practitioner using configured/auto fields."""
	field_by_dt = {
		s.source_doctype: (s.practitioner_field or "").strip() or None for s in sources
	}
	by_doctype = defaultdict(set)
	for row in rows:
		by_doctype[row.custom_base_reference].add(row.custom_base_reference_name)

	resolved = {}
	for doctype, names in by_doctype.items():
		if not frappe.db.exists("DocType", doctype):
			continue
		fields = []
		configured = field_by_dt.get(doctype)
		if configured:
			fields = [configured]
		else:
			fields = get_practitioner_fields_for_doctype(doctype)
		if not fields:
			continue

		names = list(names)
		for i in range(0, len(names), 500):
			chunk = names[i : i + 500]
			docs = frappe.get_all(
				doctype,
				filters={"name": ["in", chunk]},
				fields=["name", *fields],
			)
			for doc in docs:
				practitioner = None
				for field in fields:
					value = doc.get(field)
					if value:
						practitioner = value
						break
				if practitioner:
					resolved[(doctype, doc.name)] = practitioner
	return resolved


def get_practitioner_fields_for_doctype(doctype):
	try:
		meta = frappe.get_meta(doctype)
	except Exception:
		return []

	preferred = DOCTYPE_PRACTITIONER_FIELDS.get(doctype, GENERIC_PRACTITIONER_FIELDS)
	available = []
	for fieldname in preferred:
		df = meta.get_field(fieldname)
		if df and df.fieldtype == "Link" and df.options == "Healthcare Practitioner":
			available.append(fieldname)

	for df in meta.fields:
		if (
			df.fieldtype == "Link"
			and df.options == "Healthcare Practitioner"
			and df.fieldname not in available
		):
			available.append(df.fieldname)
	return available


def get_commission_eligible_practitioners(practitioner_ids):
	"""Only practitioners with receive_commision checked."""
	if not practitioner_ids:
		return {}

	has_flag = frappe.get_meta("Healthcare Practitioner").has_field("receive_commision")
	fields = ["name", "practitioner_name", "employee"]
	if frappe.get_meta("Healthcare Practitioner").has_field("doctors_id"):
		fields.append("doctors_id")

	filters = {"name": ["in", list(practitioner_ids)]}
	if has_flag:
		filters["receive_commision"] = 1

	rows = frappe.get_all("Healthcare Practitioner", filters=filters, fields=fields)
	return {r.name: r for r in rows}


def list_all_commission_eligible_practitioners():
	"""All practitioners marked to receive commission."""
	has_flag = frappe.get_meta("Healthcare Practitioner").has_field("receive_commision")
	fields = ["name", "practitioner_name", "employee"]
	if frappe.get_meta("Healthcare Practitioner").has_field("doctors_id"):
		fields.append("doctors_id")

	filters = {}
	if has_flag:
		filters["receive_commision"] = 1

	rows = frappe.get_all(
		"Healthcare Practitioner",
		filters=filters,
		fields=fields,
		order_by="practitioner_name asc",
	)
	return rows


def fetch_doctors_for_period(period_doc):
	"""Fill Doctors table with all eligible practitioners (receive_commision = 1).

	Does not calculate commission — use generate_commission for that.
	"""
	period_doc = period_doc if hasattr(period_doc, "doctors") else frappe.get_doc(
		"Doctor Commission Payroll", period_doc
	)

	practitioners = list_all_commission_eligible_practitioners()
	if not practitioners:
		frappe.throw(
			_(
				"No Healthcare Practitioners found with Receive Commission enabled. "
				"Open Healthcare Practitioner and tick Receive Commision."
			)
		)

	existing_adjusted = {
		(row.practitioner or ""): flt(row.adjusted_commission)
		for row in (period_doc.doctors or [])
		if row.practitioner and row.adjusted_commission not in (None, "")
	}

	period_doc.set("doctors", [])
	for p in practitioners:
		period_doc.append(
			"doctors",
			{
				"practitioner": p.name,
				"practitioner_name": p.practitioner_name or "",
				"doctors_id": getattr(p, "doctors_id", None) or p.name,
				"employee": p.employee,
				"cost_center": period_doc.cost_center,
				"cases_count": 0,
				"service_amount": 0,
				"calculated_commission": 0,
				"adjusted_commission": existing_adjusted.get(p.name, 0),
			},
		)

	# Keep service lines as-is; only refresh doctor list.
	period_doc._recalc_totals()
	period_doc.save(ignore_permissions=True)

	return {"doctors": len(period_doc.doctors or [])}


def create_additional_salaries_for_payroll(payroll_doc):
	"""Create one Additional Salary per doctor row (HRMS) after payroll is submitted."""
	payroll_doc = payroll_doc if hasattr(payroll_doc, "doctors") else frappe.get_doc(
		"Doctor Commission Payroll", payroll_doc
	)

	if "hrms" not in frappe.get_installed_apps():
		frappe.throw(_("Install HRMS to create Additional Salary from doctor commission."))

	if not frappe.db.exists("DocType", "Additional Salary"):
		frappe.throw(_("Additional Salary DocType not found. Ensure HRMS is installed."))

	salary_component = payroll_doc.salary_component or frappe.db.get_single_value(
		"Healthcare Settings", "doctor_commission_salary_component"
	)
	if not salary_component:
		frappe.throw(
			_(
				"Set Salary Component on Doctor Commission Payroll "
				"(or Healthcare Settings → Doctor Commission Salary Component)."
			)
		)

	payroll_date = payroll_doc.payroll_date or payroll_doc.to_date
	if not payroll_date:
		frappe.throw(_("Set Payroll Date (or To Date) before creating Additional Salary."))

	created = 0
	skipped = 0
	errors = []

	for row in payroll_doc.doctors or []:
		amount = flt(
			row.adjusted_commission
			if row.adjusted_commission not in (None, "")
			else row.calculated_commission
		)
		if amount <= 0:
			skipped += 1
			continue

		if row.additional_salary and frappe.db.exists("Additional Salary", row.additional_salary):
			skipped += 1
			continue

		employee = row.employee or frappe.db.get_value(
			"Healthcare Practitioner", row.practitioner, "employee"
		)
		if not employee:
			skipped += 1
			errors.append(
				_("{0}: no Employee linked on Healthcare Practitioner").format(
					row.practitioner_name or row.practitioner
				)
			)
			continue

		company = payroll_doc.company or frappe.db.get_value("Employee", employee, "company")
		if not company:
			skipped += 1
			errors.append(
				_("{0}: could not resolve Company for employee {1}").format(
					row.practitioner_name or row.practitioner, employee
				)
			)
			continue

		try:
			ads = frappe.get_doc(
				{
					"doctype": "Additional Salary",
					"naming_series": "HR-ADS-.YY.-.MM.-",
					"employee": employee,
					"company": company,
					"salary_component": salary_component,
					"amount": amount,
					"payroll_date": payroll_date,
					"is_recurring": 0,
					"overwrite_salary_structure_amount": 0,
					"ref_doctype": "Doctor Commission Payroll",
					"ref_docname": payroll_doc.name,
				}
			)
			ads.flags.ignore_permissions = True
			ads.insert()
			ads.submit()
			row.additional_salary = ads.name
			row.employee = employee
			created += 1
		except Exception as e:
			skipped += 1
			errors.append(
				_("{0}: {1}").format(row.practitioner_name or row.practitioner, str(e))
			)

	if created:
		payroll_doc.salary_component = salary_component
		payroll_doc.payroll_date = payroll_date
		payroll_doc.additional_salaries_created = 1
		payroll_doc.status = "Salary Created"
		payroll_doc.flags.ignore_validate_update_after_submit = True
		payroll_doc.save(ignore_permissions=True)

	return {"created": created, "skipped": skipped, "errors": errors}


def collect_cost_centers_from_rules(rules: list) -> list[str]:
	"""Unique branch names listed on rule Table MultiSelect rows (order preserved)."""
	out: list[str] = []
	seen: set[str] = set()
	for rule in rules or []:
		for cc in rule.get("cost_centers") or []:
			name = (cc or "").strip()
			if name and name not in seen:
				seen.add(name)
				out.append(name)
	return out


def collect_cost_centers_from_all_active_rules() -> list[str]:
	"""Any branch listed on any active Doctor Commission Rule."""
	if not frappe.db.exists("DocType", "Doctor Commission Rule Cost Center"):
		return []
	rows = frappe.db.sql(
		"""
		select distinct child.cost_center
		from `tabDoctor Commission Rule Cost Center` child
		inner join `tabDoctor Commission Rule` parent
			on parent.name = child.parent
		where parent.is_active = 1
			and child.parenttype = 'Doctor Commission Rule'
			and ifnull(child.cost_center, '') != ''
		order by child.cost_center asc
		""",
		as_dict=True,
	)
	return [(r.cost_center or "").strip() for r in rows if (r.cost_center or "").strip()]


def resolve_payroll_cost_centers(period_doc, period_rules: list) -> list[str]:
	"""Branches to include when payroll has no single Branch filter.

	1. Branches listed on commission rules overlapping this period
	2. Else any branch listed on any active commission rule
	3. Never unrestricted (all company branches)
	"""
	explicit = (getattr(period_doc, "cost_center", None) or "").strip()
	if explicit:
		return [explicit]

	period_branches = collect_cost_centers_from_rules(period_rules)
	if period_branches:
		return period_branches

	any_branches = collect_cost_centers_from_all_active_rules()
	if any_branches:
		return any_branches

	frappe.throw(
		_(
			"No branches are set on Doctor Commission Rules. "
			"Add Branches / Cost Centers on at least one active rule, "
			"or set Branch on this payroll, before generating."
		)
	)


def load_active_commission_rules(from_date, to_date):
	from_date = getdate(from_date)
	to_date = getdate(to_date)
	rules = frappe.get_all(
		"Doctor Commission Rule",
		filters={"is_active": 1},
		fields=[
			"name",
			"practitioner",
			"item_code",
			"item_group",
			"calculation_type",
			"commission_percent",
			"fixed_amount",
			"free_cases",
			"tier_after_cases",
			"tier_commission_percent",
			"valid_from",
			"valid_to",
			"priority",
		],
		order_by="priority desc, modified desc",
	)
	_attach_rule_cost_centers(rules)
	_attach_rule_payment_modes(rules)
	out = []
	for rule in rules:
		vf = getdate(rule.valid_from) if rule.valid_from else None
		vt = getdate(rule.valid_to) if rule.valid_to else None
		# Keep rule if it overlaps the period at all; line-level still checks date.
		if vf and vf > to_date:
			continue
		if vt and vt < from_date:
			continue
		out.append(rule)
	return out


def _attach_rule_cost_centers(rules: list) -> None:
	"""Attach ``cost_centers`` list from the Table MultiSelect child table."""
	if not rules:
		return
	names = [r.name for r in rules if r.get("name")]
	by_parent: dict[str, list[str]] = {n: [] for n in names}
	if names and frappe.db.exists("DocType", "Doctor Commission Rule Cost Center"):
		for row in frappe.get_all(
			"Doctor Commission Rule Cost Center",
			filters={"parent": ["in", names], "parenttype": "Doctor Commission Rule"},
			fields=["parent", "cost_center"],
		):
			cc = (row.cost_center or "").strip()
			if cc and cc not in by_parent[row.parent]:
				by_parent[row.parent].append(cc)
	# Legacy single Link column (pre-multiselect) if still present on cached rows.
	for rule in rules:
		ccs = list(by_parent.get(rule.name) or [])
		legacy = (rule.get("cost_center") or "").strip()
		if legacy and legacy not in ccs:
			ccs.append(legacy)
		rule["cost_centers"] = ccs


def _attach_rule_payment_modes(rules: list) -> None:
	"""Attach ``payment_modes`` list from the rule's Payment Modes child table."""
	if not rules:
		return
	names = [r.name for r in rules if r.get("name")]
	by_parent: dict[str, list[dict]] = {n: [] for n in names}
	if names and frappe.db.exists("DocType", "Doctor Commission Rule Payment Mode"):
		for row in frappe.get_all(
			"Doctor Commission Rule Payment Mode",
			filters={"parent": ["in", names], "parenttype": "Doctor Commission Rule"},
			fields=["parent", "mode_of_payment", "percent", "idx"],
			order_by="idx asc",
		):
			mode = (row.mode_of_payment or "").strip()
			if mode:
				by_parent[row.parent].append(
					{"mode_of_payment": mode, "percent": flt(row.percent)}
				)
	for rule in rules:
		rule["payment_modes"] = by_parent.get(rule.name) or []


def _rule_matches_cost_center(rule, cost_center: str | None) -> bool:
	"""Empty cost_centers = all branches; otherwise line branch must be listed."""
	ccs = rule.get("cost_centers") or []
	if not ccs:
		return True
	return (cost_center or "") in ccs


def match_commission_rule(rules, practitioner, cost_center, item_code, item_group, on_date):
	on_date = getdate(on_date) if on_date else None
	best = None
	best_score = -1

	for rule in rules:
		vf = getdate(rule.valid_from) if rule.valid_from else None
		vt = getdate(rule.valid_to) if rule.valid_to else None
		if on_date:
			if vf and on_date < vf:
				continue
			if vt and on_date > vt:
				continue

		score = cint(rule.priority or 0)
		# Specificity bonus
		if rule.practitioner:
			if rule.practitioner != practitioner:
				continue
			score += 100
		if rule.get("cost_centers"):
			if not _rule_matches_cost_center(rule, cost_center):
				continue
			score += 40
		if rule.item_code:
			if rule.item_code != item_code:
				continue
			score += 30
		if rule.item_group:
			if rule.item_group != item_group:
				continue
			score += 20

		if score > best_score:
			best_score = score
			best = rule
	return best


def match_base_commission_rule(rules, practitioner, cost_center, on_date):
	"""Match rule for practitioner+cost_center (ignore item filters).

	Used to check free_cases across all items for a practitioner/branch.
	Returns the best matching rule based on practitioner and cost_center only,
	even if that rule has item_code or item_group filters.
	"""
	on_date = getdate(on_date) if on_date else None
	best = None
	best_score = -1

	for rule in rules:
		vf = getdate(rule.valid_from) if rule.valid_from else None
		vt = getdate(rule.valid_to) if rule.valid_to else None
		if on_date:
			if vf and on_date < vf:
				continue
			if vt and on_date > vt:
				continue

		score = cint(rule.priority or 0)
		# Only match on practitioner and cost_center (ignore item filters)
		if rule.practitioner:
			if rule.practitioner != practitioner:
				continue
			score += 100
		if rule.get("cost_centers"):
			if not _rule_matches_cost_center(rule, cost_center):
				continue
			score += 40

		if score > best_score:
			best_score = score
			best = rule
	return best


def calculate_line_commission(rule, service_amount, case_index, default_percent, base_rule=None):
	"""Return (commission_amount, calculation_type, percent_used).
	
	base_rule: practitioner+cost_center rule (no item filters) for free_cases check.
	rule: fully matched rule (with item specificity) for commission calculation.
	"""
	service_amount = flt(service_amount)
	case_index = cint(case_index)

	# Check free_cases from base rule (applies to all items)
	free_cases_rule = base_rule or rule
	if free_cases_rule:
		free_cases = cint(free_cases_rule.free_cases or 0)
		if free_cases and case_index <= free_cases:
			calc_type = free_cases_rule.calculation_type or "Percent of Amount"
			return 0.0, calc_type, 0.0

	# If no rule matched for commission calculation, use default
	if not rule:
		percent = flt(default_percent)
		return flt(service_amount * percent / 100.0), "Percent of Amount (Default)", percent

	calc = rule.calculation_type or "Percent of Amount"
	if calc == "Fixed Per Case":
		return flt(rule.fixed_amount), calc, 0.0

	if calc == "Tiered by Cases":
		tier_after = cint(rule.tier_after_cases or 0)
		if tier_after and case_index > tier_after:
			percent = flt(rule.tier_commission_percent)
		else:
			percent = flt(rule.commission_percent)
		return flt(service_amount * percent / 100.0), calc, percent

	percent = flt(rule.commission_percent)
	return flt(service_amount * percent / 100.0), calc, percent


def payment_mode_shares(payment_modes, *, service_amount, qty, commission_amount) -> list[dict]:
	"""Split one service line across the rule's payment modes.

	Each share carries the mode, its configured percent, and the proportional part of
	the service amount, qty and commission. Percentages are normalised by their own
	total so the shares always add back up to the original amounts (a relative
	rounding difference is absorbed by the last row). With no payment modes the line
	stays on a single 100% row.
	"""
	modes = [
		((row.get("mode_of_payment") or "").strip(), flt(row.get("percent")))
		for row in (payment_modes or [])
	]
	modes = [(mode, percent) for mode, percent in modes if mode and percent > 0]

	total_amount = flt(service_amount, 2)
	total_commission = flt(commission_amount, 2)
	total_qty = flt(qty)

	if not modes:
		return [
			{
				"mode_of_payment": None,
				"payment_mode_percent": 100.0,
				"qty": total_qty,
				"service_amount": total_amount,
				"commission_amount": total_commission,
			}
		]

	total_percent = sum(percent for _, percent in modes)
	shares: list[dict] = []
	for index, (mode, percent) in enumerate(modes):
		last = index == len(modes) - 1
		factor = (percent / total_percent) if total_percent else 0.0
		if last:
			share_amount = flt(total_amount - sum(s["service_amount"] for s in shares), 2)
			share_commission = flt(
				total_commission - sum(s["commission_amount"] for s in shares), 2
			)
			share_qty = flt(total_qty - sum(s["qty"] for s in shares))
		else:
			share_amount = flt(total_amount * factor, 2)
			share_commission = flt(total_commission * factor, 2)
			share_qty = flt(total_qty * factor)
		shares.append(
			{
				"mode_of_payment": mode,
				"payment_mode_percent": flt(percent, 2),
				"qty": share_qty,
				"service_amount": share_amount,
				"commission_amount": share_commission,
			}
		)
	return shares


COMMISSION_PAYSLIP_ITEM_FIELDS = (
	"practitioner",
	"practitioner_name",
	"transaction_date",
	"patient",
	"patient_name",
	"source_doctype",
	"source_name",
	"sales_order",
	"item_code",
	"item_name",
	"cost_center",
	"case_index",
	"qty",
	"mode_of_payment",
	"payment_mode_percent",
	"service_amount",
	"commission_rule",
	"calculation_type",
	"commission_percent",
	"commission_amount",
)


def _clear_draft_commission_payslips(payroll_name: str) -> int:
	"""Delete draft Commission Payslips previously generated for this payroll."""
	if not payroll_name or not frappe.db.exists("DocType", "Commission Payslip"):
		return 0
	names = frappe.get_all(
		"Commission Payslip",
		filters={"doctor_commission_payroll": payroll_name, "docstatus": 0},
		pluck="name",
	)
	for name in names:
		frappe.delete_doc("Commission Payslip", name, force=True, ignore_permissions=True)
	return len(names)


def _single_branch(lines) -> str | None:
	"""The one branch shared by every line, or None when lines span branches/blank."""
	branches = {(row.cost_center or "").strip() for row in (lines or [])}
	branches.discard("")
	return next(iter(branches)) if len(branches) == 1 else None


def build_commission_payslips_for_payroll(payroll_doc, *, replace: bool = True):
	"""Create one draft Commission Payslip per doctor that has service lines.

	Every payslip holds the doctor's service lines split per mode of payment, so the
	commission can be reviewed and printed per doctor.
	"""
	if not frappe.db.exists("DocType", "Commission Payslip"):
		return {"payslips": 0, "items": 0}

	payroll_doc = payroll_doc if hasattr(payroll_doc, "doctors") else frappe.get_doc(
		"Doctor Commission Payroll", payroll_doc
	)
	if payroll_doc.docstatus == 2:
		frappe.throw(_("Cancelled payrolls cannot create Commission Payslips."))

	if replace:
		_clear_draft_commission_payslips(payroll_doc.name)

	items_by_practitioner = defaultdict(list)
	for row in payroll_doc.items or []:
		if row.practitioner:
			items_by_practitioner[row.practitioner].append(row)

	doctor_rows = defaultdict(list)
	for row in payroll_doc.doctors or []:
		if row.practitioner:
			doctor_rows[row.practitioner].append(row)

	# One payslip per doctor (all branches), in the payroll's doctor order.
	order: list[str] = []
	for row in payroll_doc.doctors or []:
		if row.practitioner and row.practitioner not in order:
			order.append(row.practitioner)
	for practitioner in items_by_practitioner:
		if practitioner not in order:
			order.append(practitioner)

	created = 0
	item_count = 0
	for practitioner in order:
		lines = items_by_practitioner.get(practitioner) or []
		if not lines:
			continue
		rows = doctor_rows.get(practitioner) or []
		head = rows[0] if rows else None

		doc = frappe.new_doc("Commission Payslip")
		doc.doctor_commission_payroll = payroll_doc.name
		doc.practitioner = practitioner
		doc.practitioner_name = (
			(head.practitioner_name if head else None) or lines[0].practitioner_name or ""
		)
		doc.doctors_id = head.doctors_id if head else None
		doc.employee = head.employee if head else None
		doc.company = payroll_doc.company
		doc.cost_center = (
			_single_branch(lines)
			or (head.cost_center if head else None)
			or payroll_doc.cost_center
		)
		doc.from_date = payroll_doc.from_date
		doc.to_date = payroll_doc.to_date
		doc.generated_on = now_datetime()
		doc.generated_by = frappe.session.user
		for row in lines:
			doc.append("items", {field: row.get(field) for field in COMMISSION_PAYSLIP_ITEM_FIELDS})
		doc.flags.ignore_permissions = True
		doc.insert()
		created += 1
		item_count += len(lines)

	return {"payslips": created, "items": item_count}


def get_doctor_commission_view(payroll_doc, practitioner: str) -> dict:
	"""Services, payment-mode splits and commission for one doctor on a payroll.

	Backs the View Doctor dialog on Doctor Commission Payroll (and printing).
	"""
	payroll_doc = payroll_doc if hasattr(payroll_doc, "doctors") else frappe.get_doc(
		"Doctor Commission Payroll", payroll_doc
	)
	practitioner = (practitioner or "").strip()
	if not practitioner:
		frappe.throw(_("Doctor is required"))

	doctor_rows = [row for row in (payroll_doc.doctors or []) if row.practitioner == practitioner]
	if not doctor_rows:
		frappe.throw(_("{0} is not part of this Doctor Commission Payroll.").format(practitioner))
	head = doctor_rows[0]

	services: list[dict] = []
	index: dict[tuple, dict] = {}
	for row in payroll_doc.items or []:
		if row.practitioner != practitioner:
			continue
		key = (
			row.sales_order or "",
			row.item_code or "",
			str(row.transaction_date or ""),
			cint(row.case_index),
		)
		service = index.get(key)
		if not service:
			service = {
				"transaction_date": str(row.transaction_date) if row.transaction_date else "",
				"patient": row.patient,
				"patient_name": row.patient_name,
				"source_doctype": row.source_doctype,
				"source_name": row.source_name,
				"sales_order": row.sales_order,
				"item_code": row.item_code,
				"item_name": row.item_name,
				"cost_center": row.cost_center,
				"case_index": cint(row.case_index),
				"commission_rule": row.commission_rule,
				"calculation_type": row.calculation_type,
				"commission_percent": flt(row.commission_percent),
				"service_amount": 0.0,
				"commission_amount": 0.0,
				"modes": [],
			}
			index[key] = service
			services.append(service)

		service["modes"].append(
			{
				"mode_of_payment": row.mode_of_payment or "",
				"payment_mode_percent": flt(row.payment_mode_percent),
				"qty": flt(row.qty),
				"service_amount": flt(row.service_amount),
				"commission_amount": flt(row.commission_amount),
			}
		)
		service["service_amount"] += flt(row.service_amount)
		service["commission_amount"] += flt(row.commission_amount)

	if services:
		service_amount = sum(flt(service["service_amount"]) for service in services)
		calculated = sum(flt(service["commission_amount"]) for service in services)
		cases_count = len(services)
	else:
		service_amount = sum(flt(row.service_amount) for row in doctor_rows)
		calculated = sum(flt(row.calculated_commission) for row in doctor_rows)
		cases_count = sum(cint(row.cases_count) for row in doctor_rows)

	# A doctor can hold one payroll row per branch — total the overrides across them.
	adjusted = sum(
		flt(row.adjusted_commission)
		if row.adjusted_commission not in (None, "")
		else flt(row.calculated_commission)
		for row in doctor_rows
	)
	branch = (
		_single_branch([r for r in (payroll_doc.items or []) if r.practitioner == practitioner])
		or head.cost_center
		or payroll_doc.cost_center
	)

	return {
		"payroll": payroll_doc.name,
		"payroll_status": payroll_doc.status,
		"company": payroll_doc.company,
		"from_date": str(payroll_doc.from_date) if payroll_doc.from_date else "",
		"to_date": str(payroll_doc.to_date) if payroll_doc.to_date else "",
		"doctor": {
			"practitioner": head.practitioner,
			"practitioner_name": head.practitioner_name,
			"doctors_id": head.doctors_id,
			"employee": head.employee,
			"cost_center": branch,
			"cases_count": cases_count,
			"service_amount": service_amount,
			"calculated_commission": calculated,
			"adjusted_commission": adjusted,
			"remarks": head.remarks,
		},
		"services": services,
	}


def get_item_groups(item_codes):
	if not item_codes:
		return {}
	rows = frappe.get_all(
		"Item",
		filters={"name": ["in", list(item_codes)]},
		fields=["name", "item_group"],
	)
	return {r.name: r.item_group for r in rows}


@frappe.whitelist()
def get_default_commission_percent():
	return flt(frappe.db.get_single_value("Healthcare Settings", "doctors_commission"))
