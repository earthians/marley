# # Add to healthcare/api/billing.py

# import frappe
# @frappe.whitelist()
# def get_inpatient_balances(patient=None):
#     """
#     Get inpatient balances for all patients or a specific patient
#     Returns list of admissions with outstanding balances
#     """
   
#     filters = {"docstatus": 1}
#     if patient:
#         filters["patient_name"] = patient
#     # Get all inpatient admissions
#     admissions = frappe.get_all("Inpatient Admission",
#         # filters=filters,
#         fields=["name", "patient", "patient_name", "admitted_datetime", "cost_center", "status"]
#     )
#     balances = []
#     today = frappe.utils.today()
    
#     for admission in admissions:
#         # Get all invoices for this admission
#         invoices = frappe.get_all("Sales Invoice",
#             filters={
#                 "custom_reference_name": admission.name,
#                 "docstatus": 1
#             },
#             fields=["name", "grand_total", "outstanding_amount", "posting_date", "status"]
#         )
#         total_amount = sum(inv.grand_total for inv in invoices)
#         total_paid = sum(inv.grand_total - inv.outstanding_amount for inv in invoices)
#         outstanding = sum(inv.outstanding_amount for inv in invoices)
        
#         # Calculate days overdue
#         days_overdue = 0
#         last_invoice_date = None
#         if invoices:
#             last_invoice = max(invoices, key=lambda x: x.posting_date)
#             last_invoice_date = last_invoice.posting_date
#             if last_invoice.outstanding_amount > 0:
#                 days_overdue = (frappe.utils.date_diff(today, last_invoice.posting_date))
        
#         if total_amount > 0:  # Only include admissions with charges
#             balances.append({
#                 "admission_id": admission.name,
#                 "patient_name": admission.patient_name,
#                 "patient_id": admission.patient,
#                 "admission_date": admission.admission_datetime.split()[0] if admission.admission_datetime else "",
#                 "discharge_date": admission.discharge_datetime.split()[0] if admission.discharge_datetime else None,
#                 "cost_center": admission.cost_center,
#                 "total_amount": total_amount,
#                 "total_paid": total_paid,
#                 "outstanding_amount": outstanding,
#                 "days_overdue": max(0, days_overdue),
#                 "last_invoice_date": last_invoice_date
#             })
    
#     # Sort by outstanding amount (highest first) and then by days overdue
#     balances.sort(key=lambda x: (-x["outstanding_amount"], -x["days_overdue"]))
    
#     return balances


# # Add to healthcare/api/billing.py

# @frappe.whitelist()
# def get_outpatient_balances(patient=None):
#     """
#     Get outpatient balances for all patients or a specific patient
#     Returns list of patient visits with outstanding balances
#     """
#     filters = {"docstatus": 1}
#     if patient:
#         filters["patient"] = patient
    
#     # Get all patient encounters (visits)
#     visits = frappe.get_all("Patient Visit",
#         # filters=filters,
#         fields=["name", "patient", "patient_name", "encounter_date", "practitioner", "status"]
#     )
    
#     balances = []
#     today = frappe.utils.today()
    
#     for visit in visits:
#         # Get all invoices for this visit
#         invoices = frappe.get_all("Sales Invoice",
#             filters={
#                 "custom_reference_name": visit.name,
#                 "docstatus": 1
#             },
#             fields=["name", "grand_total", "outstanding_amount", "posting_date", "status"]
#         )
#         print("huku ni wapi", str(invoices))
#         total_amount = sum(inv.grand_total for inv in invoices)
#         total_paid = sum(inv.grand_total - inv.outstanding_amount for inv in invoices)
#         outstanding = sum(inv.outstanding_amount for inv in invoices)
        
#         # Calculate days overdue
#         days_overdue = 0
#         last_invoice_date = None
#         if invoices:
#             last_invoice = max(invoices, key=lambda x: x.posting_date)
#             last_invoice_date = last_invoice.posting_date
#             if last_invoice.outstanding_amount > 0:
#                 days_overdue = frappe.utils.date_diff(today, last_invoice.posting_date)
        
#         if total_amount > 0:  # Only include visits with charges
#             balances.append({
#                 "visit_id": visit.name,
#                 "patient_name": visit.patient_name,
#                 "patient_id": visit.patient,
#                 "visit_date": visit.encounter_date if visit.encounter_date else "",
#                 "practitioner": visit.practitioner,
#                 "total_amount": total_amount,
#                 "total_paid": total_paid,
#                 "outstanding_amount": outstanding,
#                 "days_overdue": max(0, days_overdue),
#                 "last_invoice_date": last_invoice_date
#             })
    
#     # Sort by outstanding amount (highest first) and then by days overdue
#     balances.sort(key=lambda x: (-x["outstanding_amount"], -x["days_overdue"]))
    
#     return balances


# healthcare/api/billing.py

import json

import frappe
from frappe import _
from frappe.utils import add_months, cint, cstr, flt, formatdate, getdate, nowdate, today
from healthcare.healthcare.editing_lock import assert_editing_allowed


def _billing_item_uom_options(item_code):
	"""Distinct UOMs from Item (stock, sales, conversion table)."""
	item = frappe.get_cached_doc("Item", item_code)
	seen = []
	for u in (item.stock_uom, item.sales_uom):
		if u and u not in seen:
			seen.append(u)
	for row in item.get("uoms") or []:
		u = row.uom
		if u and u not in seen:
			seen.append(u)
	return seen


def _resolve_healthcare_service_template_for_item(item_code):
	"""
	For non-stock (service) Items, find a linked healthcare template (same link pattern as Service Request).
	Returns (template_doctype, template_name) or (None, None).
	"""
	if not item_code or not frappe.db.exists("Item", item_code):
		return None, None
	if cint(frappe.db.get_value("Item", item_code, "is_stock_item")):
		return None, None

	disabled_filter = {"disabled": 0}

	name = frappe.db.get_value("Lab Test Template", {"item": item_code, **disabled_filter}, "name")
	if name:
		return "Lab Test Template", name

	name = frappe.db.get_value(
		"Healthcare Service Template", {"item_code": item_code, **disabled_filter}, "name"
	)
	if name:
		return "Healthcare Service Template", name

	name = frappe.db.get_value(
		"Clinical Procedure Template", {"item": item_code, **disabled_filter}, "name"
	)
	if name:
		return "Clinical Procedure Template", name
	name = frappe.db.get_value(
		"Clinical Procedure Template", {"item_code": item_code, **disabled_filter}, "name"
	)
	if name:
		return "Clinical Procedure Template", name

	name = frappe.db.get_value("Therapy Type", {"item": item_code, **disabled_filter}, "name")
	if name:
		return "Therapy Type", name

	name = frappe.db.get_value("Observation Template", {"item": item_code}, "name")
	if name:
		return "Observation Template", name

	return None, None


@frappe.whitelist()
def get_sales_item_pricing_for_billing(
	item_code,
	company,
	customer=None,
	qty=1,
	posting_date=None,
	price_list=None,
	patient=None,
	uom=None,
):
	"""
	Resolve selling rate and UOMs for billing modals.

	- Stock items: ERPNext get_item_details (Item Price / pricing), then Item.standard_rate, then valuation.
	- Service items (maintain stock = 0): if linked to Lab / Clinical Procedure / Therapy / Observation /
	  Healthcare Service template, base rate from template (same fields as service request API);
	  otherwise same ERPNext chain as above.
	- When ``patient`` is set and the line is a service item, apply Healthcare Settings patient-category
	  multiplier (same table as Service Request).
	"""
	if not item_code or not company:
		frappe.throw(_("item_code and company are required"))

	item_code = cstr(item_code).strip()
	qty = flt(qty) or 1
	transaction_date = getdate(posting_date) if posting_date else getdate(nowdate())
	uom = cstr(uom).strip() if uom else None

	selling_price_list = cstr(price_list).strip() if price_list else None
	if not selling_price_list:
		selling_price_list = frappe.db.get_single_value("Selling Settings", "selling_price_list")
	if not selling_price_list and frappe.db.exists("Price List", "Standard Selling"):
		selling_price_list = "Standard Selling"

	company_currency = frappe.get_cached_value("Company", company, "default_currency")
	if not company_currency:
		frappe.throw(_("Company {0} has no default currency").format(company))

	is_stock_item = cint(frappe.db.get_value("Item", item_code, "is_stock_item"))
	is_service_item = not is_stock_item

	template_dt, template_dn = _resolve_healthcare_service_template_for_item(item_code)
	template_base = None
	if template_dt and template_dn:
		from healthcare.api.service_request import _get_template_base_rate

		template_base = flt(_get_template_base_rate(template_dt, template_dn))

	from erpnext.stock.get_item_details import get_item_details, get_valuation_rate

	out = frappe._dict()
	try:
		ctx = frappe._dict(
			{
				"item_code": item_code,
				"company": company,
				"customer": customer or "",
				"qty": qty,
				"doctype": "Sales Invoice",
				"name": None,
				"transaction_date": transaction_date,
				"posting_date": transaction_date,
				"currency": company_currency,
				"conversion_rate": 1.0,
				"price_list": selling_price_list,
				"selling_price_list": selling_price_list,
				"plc_conversion_rate": 1.0,
				"price_list_currency": None,
				"update_stock": 0,
				"is_pos": 0,
				"is_return": 0,
				"is_subcontracted": 0,
				"ignore_pricing_rule": 0,
			}
		)
		if uom:
			ctx["uom"] = uom
		out = get_item_details(ctx, doc=None, for_validate=False, overwrite_warehouse=True)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "get_sales_item_pricing_for_billing")

	erp_rate = flt(out.get("rate")) or flt(out.get("net_rate")) or flt(out.get("price_list_rate"))
	uom_out = out.get("uom")
	stock_uom = out.get("stock_uom")
	item_name = out.get("item_name")
	warehouse = out.get("warehouse")

	item_meta = frappe.db.get_value(
		"Item",
		item_code,
		["item_name", "stock_uom", "sales_uom", "standard_rate"],
		as_dict=True,
	)
	if item_meta:
		if not item_name:
			item_name = item_meta.item_name
		if not stock_uom:
			stock_uom = item_meta.stock_uom
		if not uom_out:
			uom_out = item_meta.sales_uom or item_meta.stock_uom

	if not erp_rate and item_meta:
		erp_rate = flt(item_meta.standard_rate)

	if not erp_rate:
		val = get_valuation_rate(item_code, company, warehouse)
		erp_rate = flt(val.get("valuation_rate")) if val else 0

	if is_service_item and template_base > 0:
		base_before_multiplier = template_base
		pricing_source = "healthcare_template"
	elif is_service_item:
		base_before_multiplier = erp_rate
		pricing_source = "erpnext_service"
	else:
		base_before_multiplier = erp_rate
		pricing_source = "erpnext_stock"

	multiplier = 1.0
	patient_category = None
	discount_pct = 0.0
	discount_amount = 0.0
	net_rate = None
	final_rate = flt(base_before_multiplier)
	if patient and is_service_item and frappe.db.exists("Patient", patient):
		from healthcare.controllers.insurance_pricing import resolve_charge
		from healthcare.healthcare.doctype.service_request.service_request import (
			_get_patient_category_multiplier,
		)

		multiplier, patient_category = _get_patient_category_multiplier(patient)
		# Infer OP/IP when caller didn't pass a care type — admission refs are IP.
		patient_care_type = None
		charged = resolve_charge(
			patient=patient,
			base_rate=base_before_multiplier,
			patient_care_type=patient_care_type,
			item_code=item_code,
			template_dt=template_dt,
			template_dn=template_dn,
			multiplier=multiplier,
		)
		# Return list rate; caller puts insurance % into discount_percentage on the SI line.
		final_rate = flt(charged["rate_before_discount"])
		multiplier = flt(charged["multiplier"])
		discount_pct = flt(charged["discount_pct"])
		discount_amount = flt(charged.get("discount_amount") or 0)
		net_rate = flt(charged["rate"])
		if charged.get("used_insurance_price"):
			base_before_multiplier = flt(charged["base_rate"])
			pricing_source = "insurance_inclusive_price"
	else:
		final_rate = flt(base_before_multiplier) * flt(multiplier)
		net_rate = final_rate

	uom_options = _billing_item_uom_options(item_code)

	return {
		"rate": final_rate,
		"base_rate": flt(base_before_multiplier),
		"uom": uom_out,
		"stock_uom": stock_uom,
		"item_name": item_name,
		"price_list": selling_price_list,
		"is_service_item": int(is_service_item),
		"is_stock_item": int(is_stock_item),
		"pricing_source": pricing_source,
		"service_template_dt": template_dt,
		"service_template_dn": template_dn,
		"patient_category": patient_category,
		"multiplier": multiplier,
		"discount_pct": discount_pct,
		"discount_amount": discount_amount,
		"net_rate": flt(net_rate if net_rate is not None else final_rate),
		"uom_options": uom_options,
	}


def _sales_invoice_filters_for_reference(reference_type, reference_name, submitted_only=False):
	"""Match combined / healthcare invoices linked to a visit or admission."""
	if not reference_name:
		return None
	docstatus = 1 if submitted_only else ["in", [0, 1]]
	filters = {
		"custom_reference_name": reference_name,
		"docstatus": docstatus,
	}
	if reference_type:
		filters["custom_reference_type"] = reference_type
	return filters


def _format_stored_date_only(val):
	"""Return ``YYYY-MM-DD`` from a DB value that may be str, date, or datetime."""
	if val is None or val == "":
		return ""
	if isinstance(val, str):
		return val.strip().split()[0]
	try:
		return frappe.utils.getdate(val).strftime("%Y-%m-%d")
	except Exception:
		s = str(val).strip()
		return s.split()[0][:10] if s else ""


@frappe.whitelist()
def get_inpatient_balances(patient=None, from_date=None, to_date=None):
    """
    Get inpatient balances for all patients or a specific patient
    Returns list of admissions with outstanding balances
    """
    from healthcare.api.common import apply_cost_center_scope_to_filters

    adm_filters = {}
    if apply_cost_center_scope_to_filters(adm_filters):
        return []
    if patient:
        adm_filters["patient"] = patient

    if from_date and to_date:
        adm_filters["admitted_datetime"] = ["between", [f"{from_date} 00:00:00", f"{to_date} 23:59:59"]]
    elif from_date:
        adm_filters["admitted_datetime"] = [">=", f"{from_date} 00:00:00"]
    elif to_date:
        adm_filters["admitted_datetime"] = ["<=", f"{to_date} 23:59:59"]

    admissions = frappe.get_all(
        "Inpatient Admission",
        filters=adm_filters or None,
        fields=[
            "name",
            "patient",
            "patient_name",
            "admitted_datetime",
            "discharge_datetime",
            "cost_center",
            "status",
        ],
    )
    balances = []
    today = frappe.utils.today()
    
    for admission in admissions:
        inv_filters = _sales_invoice_filters_for_reference(
            "Inpatient Admission", admission.name, submitted_only=True
        )
        invoices = frappe.get_all(
            "Sales Invoice",
            filters=inv_filters,
            fields=["name", "grand_total", "outstanding_amount", "posting_date", "status"],
        )
        if not invoices:
            invoices = frappe.get_all(
                "Sales Invoice",
                filters={
                    "custom_reference_name": admission.name,
                    "docstatus": 1,
                },
                fields=["name", "grand_total", "outstanding_amount", "posting_date", "status"],
            )
        total_amount = sum(inv.grand_total for inv in invoices)
        total_paid = sum(inv.grand_total - inv.outstanding_amount for inv in invoices)
        outstanding = sum(inv.outstanding_amount for inv in invoices)
        
        # Calculate days overdue
        days_overdue = 0
        last_invoice_date = None
        if invoices:
            last_invoice = max(invoices, key=lambda x: x.posting_date)
            last_invoice_date = last_invoice.posting_date
            if last_invoice.outstanding_amount > 0:
                days_overdue = (frappe.utils.date_diff(today, last_invoice.posting_date))
        
        if total_amount > 0:  # Only include admissions with charges
            latest_invoice_name = None
            if invoices:
                latest_invoice_name = max(invoices, key=lambda x: x.posting_date or "").name
            admitted = admission.get("admitted_datetime")
            discharge_dt = admission.get("discharge_datetime")
            admission_date_str = _format_stored_date_only(admitted)
            discharge_date_str = _format_stored_date_only(discharge_dt) or None
            balances.append({
                "admission_id": admission.name,
                "patient_name": admission.patient_name,
                "patient_id": admission.patient,
                "admission_date": admission_date_str,
                "discharge_date": discharge_date_str,
                "cost_center": admission.cost_center,
                "latest_invoice_name": latest_invoice_name,
                "total_amount": total_amount,
                "total_paid": total_paid,
                "outstanding_amount": outstanding,
                "days_overdue": max(0, days_overdue),
                "last_invoice_date": last_invoice_date
            })
    
    # Sort by outstanding amount (highest first) and then by days overdue
    balances.sort(key=lambda x: (-x["outstanding_amount"], -x["days_overdue"]))
    
    return balances


def _get_patient_visit_balances(patient=None, from_date=None, to_date=None, iop_only=None):
    """
    Patient Visit balances with optional IOP filter.

    iop_only: True = IOP visits only, False = non-IOP OP visits, None = all visits.
    """
    from healthcare.api.care_episode import patient_visit_type_info
    from healthcare.api.common import apply_cost_center_scope_to_filters

    visit_filters = {}
    if apply_cost_center_scope_to_filters(visit_filters):
        return []
    if patient:
        visit_filters["patient"] = patient
    # The all-patients worklist (no patient, no date range) would otherwise fetch EVERY visit and
    # then do per-visit type + invoice lookups (N+1), taking 40s+. Bound it to a recent window so
    # the dashboard doesn't hang; a specific patient or explicit date range overrides this.
    if not patient and not from_date and not to_date:
        from_date = frappe.utils.add_days(frappe.utils.today(), -180)
    if from_date and to_date:
        visit_filters["encounter_date"] = ["between", [from_date, to_date]]
    elif from_date:
        visit_filters["encounter_date"] = [">=", from_date]
    elif to_date:
        visit_filters["encounter_date"] = ["<=", to_date]

    visits = frappe.get_all(
        "Patient Visit",
        filters=visit_filters or None,
        fields=[
            "name",
            "patient",
            "patient_name",
            "encounter_date",
            "practitioner",
            "status",
            "cost_center",
            "visit_type",
        ],
        order_by="encounter_date desc",
        limit=1000,
    )

    balances = []
    today = frappe.utils.today()

    for visit in visits:
        if iop_only is not None:
            is_iop = patient_visit_type_info(visit.name).get("is_iop_visit")
            if iop_only and not is_iop:
                continue
            if not iop_only and is_iop:
                continue
            if not iop_only and (visit.get("visit_type") or "").strip() == DAILY_AUTO_VISIT_TYPE:
                continue

        inv_filters = _sales_invoice_filters_for_reference(
            "Patient Visit", visit.name, submitted_only=True
        )
        invoices = frappe.get_all(
            "Sales Invoice",
            filters=inv_filters,
            fields=["name", "grand_total", "outstanding_amount", "posting_date", "status"],
        )
        if not invoices:
            invoices = frappe.get_all(
                "Sales Invoice",
                filters={
                    "custom_reference_name": visit.name,
                    "docstatus": 1,
                },
                fields=["name", "grand_total", "outstanding_amount", "posting_date", "status"],
            )

        total_amount = sum(inv.grand_total for inv in invoices)
        total_paid = sum(inv.grand_total - inv.outstanding_amount for inv in invoices)
        outstanding = sum(inv.outstanding_amount for inv in invoices)

        days_overdue = 0
        last_invoice_date = None
        if invoices:
            last_invoice = max(invoices, key=lambda x: x.posting_date)
            last_invoice_date = last_invoice.posting_date
            if last_invoice.outstanding_amount > 0:
                days_overdue = frappe.utils.date_diff(today, last_invoice.posting_date)

        if total_amount > 0:
            latest_invoice_name = None
            if invoices:
                latest_invoice_name = max(invoices, key=lambda x: x.posting_date or "").name
            balances.append({
                "visit_id": visit.name,
                "patient_name": visit.patient_name,
                "patient_id": visit.patient,
                "visit_date": visit.encounter_date if visit.encounter_date else "",
                "practitioner": visit.practitioner,
                "cost_center": visit.get("cost_center"),
                "latest_invoice_name": latest_invoice_name,
                "total_amount": total_amount,
                "total_paid": total_paid,
                "outstanding_amount": outstanding,
                "days_overdue": max(0, days_overdue),
                "last_invoice_date": last_invoice_date,
            })

    balances.sort(key=lambda x: (-x["outstanding_amount"], -x["days_overdue"]))
    return balances


@frappe.whitelist()
def get_outpatient_balances(patient=None, from_date=None, to_date=None):
    """Outpatient (non-IOP) patient visit balances."""
    return _get_patient_visit_balances(
        patient=patient, from_date=from_date, to_date=to_date, iop_only=False
    )


@frappe.whitelist()
def get_iop_balances(patient=None, from_date=None, to_date=None):
    """IOP patient visit balances (visit type IOP or linked IOP enrollment)."""
    return _get_patient_visit_balances(
        patient=patient, from_date=from_date, to_date=to_date, iop_only=True
    )


DAILY_AUTO_VISIT_TYPE = "Daily Auto Visit"


def _sales_invoices_for_reference(reference_type, reference_name):
    inv_filters = _sales_invoice_filters_for_reference(
        reference_type, reference_name, submitted_only=True
    )
    invoices = frappe.get_all(
        "Sales Invoice",
        filters=inv_filters,
        fields=["name", "grand_total", "outstanding_amount", "posting_date", "status"],
    )
    if not invoices:
        invoices = frappe.get_all(
            "Sales Invoice",
            filters={
                "custom_reference_name": reference_name,
                "docstatus": 1,
            },
            fields=["name", "grand_total", "outstanding_amount", "posting_date", "status"],
        )
    return invoices


def _patient_visit_balance_row(visit, *, include_uninvoiced_orders=False):
    from healthcare.api.sales_order import _pending_billable_sales_order_names

    invoices = _sales_invoices_for_reference("Patient Visit", visit.name)

    total_amount = sum(flt(inv.grand_total) for inv in invoices)
    total_paid = sum(flt(inv.grand_total) - flt(inv.outstanding_amount) for inv in invoices)
    outstanding = sum(flt(inv.outstanding_amount) for inv in invoices)
    uninvoiced_amount = 0.0
    pending_sales_order_names = []

    if include_uninvoiced_orders:
        pending_sales_order_names = _pending_billable_sales_order_names(
            "Patient Visit",
            visit.name,
            patient=visit.patient,
        )
        for so_name in pending_sales_order_names:
            uninvoiced_amount += flt(frappe.db.get_value("Sales Order", so_name, "grand_total"))
        total_amount += uninvoiced_amount
        outstanding += uninvoiced_amount

    if total_amount <= 0 and not pending_sales_order_names:
        return None

    today = frappe.utils.today()
    days_overdue = 0
    last_invoice_date = None
    if invoices:
        last_invoice = max(invoices, key=lambda x: x.posting_date or "")
        last_invoice_date = last_invoice.posting_date
        if flt(last_invoice.outstanding_amount) > 0:
            days_overdue = frappe.utils.date_diff(today, last_invoice.posting_date)
    elif outstanding > 0 and visit.encounter_date:
        days_overdue = max(0, frappe.utils.date_diff(today, visit.encounter_date))

    latest_invoice_name = None
    if invoices:
        latest_invoice_name = max(invoices, key=lambda x: x.posting_date or "").name

    row = {
        "visit_id": visit.name,
        "patient_name": visit.patient_name,
        "patient_id": visit.patient,
        "visit_date": visit.encounter_date if visit.encounter_date else "",
        "practitioner": visit.practitioner,
        "cost_center": visit.get("cost_center"),
        "latest_invoice_name": latest_invoice_name,
        "total_amount": total_amount,
        "total_paid": total_paid,
        "outstanding_amount": outstanding,
        "days_overdue": max(0, days_overdue),
        "last_invoice_date": last_invoice_date,
    }
    if include_uninvoiced_orders:
        row["pending_sales_order_names"] = pending_sales_order_names
        row["uninvoiced_amount"] = uninvoiced_amount
    return row


@frappe.whitelist()
def get_daily_auto_visit_balances(patient=None, from_date=None, to_date=None):
    """Daily Auto Visit balances (includes submitted sales orders not yet invoiced)."""
    visit_filters = {"visit_type": DAILY_AUTO_VISIT_TYPE}
    if patient:
        visit_filters["patient"] = patient
    if from_date and to_date:
        visit_filters["encounter_date"] = ["between", [from_date, to_date]]
    elif from_date:
        visit_filters["encounter_date"] = [">=", from_date]
    elif to_date:
        visit_filters["encounter_date"] = ["<=", to_date]

    visits = frappe.get_all(
        "Patient Visit",
        filters=visit_filters,
        fields=[
            "name",
            "patient",
            "patient_name",
            "encounter_date",
            "practitioner",
            "status",
            "cost_center",
        ],
    )

    balances = []
    for visit in visits:
        row = _patient_visit_balance_row(visit, include_uninvoiced_orders=True)
        if row:
            balances.append(row)

    balances.sort(key=lambda x: (-x["outstanding_amount"], -x["days_overdue"]))
    return balances


@frappe.whitelist()
def get_payment_entries(
    reference_type=None,
    reference_name=None,
    patient=None,
    from_date=None,
    to_date=None,
    mode_of_payment=None,
    receptionist_shift=None,
    filter_by_open_shift=None,
    cashier=None,
    cost_center=None,
):
    from healthcare.api.receptionist_shift import resolve_receptionist_shift_filter, SHIFT_LINK_FIELD

    shift_filter = resolve_receptionist_shift_filter(
        receptionist_shift=receptionist_shift,
        filter_by_open_shift=filter_by_open_shift,
    )
    if shift_filter is not None and not shift_filter:
        return []

    # Submitted payments plus draft refund/credit payouts (reception portal saves refunds as draft).
    conditions = ["(pe.docstatus = 1 OR (pe.docstatus = 0 AND pe.payment_type = 'Pay'))"]
    params = {}

    if shift_filter and frappe.get_meta("Payment Entry").has_field(SHIFT_LINK_FIELD):
        conditions.append(f"IFNULL(pe.{SHIFT_LINK_FIELD}, '') = %(receptionist_shift)s")
        params["receptionist_shift"] = shift_filter

    if from_date:
        conditions.append("pe.posting_date >= %(from_date)s")
        params["from_date"] = from_date
    if to_date:
        conditions.append("pe.posting_date <= %(to_date)s")
        params["to_date"] = to_date
    if mode_of_payment:
        conditions.append("pe.mode_of_payment = %(mode_of_payment)s")
        params["mode_of_payment"] = mode_of_payment
    has_payment_owner = frappe.get_meta("Payment Entry").has_field("custom_payment_owner")
    credited_expr = (
        "IFNULL(NULLIF(pe.custom_payment_owner, ''), pe.owner)"
        if has_payment_owner
        else "pe.owner"
    )
    pe_meta = frappe.get_meta("Payment Entry")
    has_op_or_ip = pe_meta.has_field("custom_op_or_ip")
    has_case_no = pe_meta.has_field("custom_case_no")
    has_unique_identity = pe_meta.has_field("custom_unique_identity")
    op_or_ip_select = "MAX(pe.custom_op_or_ip) AS custom_op_or_ip" if has_op_or_ip else "NULL AS custom_op_or_ip"
    case_no_select = "MAX(pe.custom_case_no) AS custom_case_no" if has_case_no else "NULL AS custom_case_no"
    unique_identity_select = (
        "MAX(pe.custom_unique_identity) AS custom_unique_identity"
        if has_unique_identity
        else "NULL AS custom_unique_identity"
    )

    if cashier:
        conditions.append(f"{credited_expr} = %(cashier)s")
        params["cashier"] = cashier

    patient_customer = None
    if patient:
        patient_customer = frappe.db.get_value("Patient", patient, "customer")
        params["patient"] = patient
        if patient_customer:
            params["customer"] = patient_customer

    # Advances = Payment Entries with no Sales Invoice reference (unallocated credit).
    # Always include them for the patient/customer even when a visit/admission case filter
    # is set — otherwise selecting a case hides all advances.
    advance_clause = None
    if patient_customer:
        advance_clause = "(per.reference_name IS NULL AND pe.party = %(customer)s)"
    elif patient:
        # No linked customer — cannot reliably match party; leave advances out of case filter
        advance_clause = None

    if reference_name:
        params["reference_name"] = reference_name
        invoice_match_parts = ["si.custom_reference_name = %(reference_name)s"]
        if reference_type:
            params["reference_type"] = reference_type
            invoice_match_parts = [
                "(si.custom_reference_type = %(reference_type)s AND si.custom_reference_name = %(reference_name)s)"
            ]
        # Also include advances tagged with this case on Payment Entry
        if has_case_no:
            invoice_match_parts.append(
                "(per.reference_name IS NULL AND IFNULL(pe.custom_case_no, '') = %(reference_name)s)"
            )
        if advance_clause:
            # Any patient advance (case-tagged or not) still shows under this patient+case view
            invoice_match_parts.append(advance_clause)
        if patient and not patient_customer:
            conditions.append("si.patient = %(patient)s")
            conditions.append("si.custom_reference_name = %(reference_name)s")
            if reference_type:
                conditions.append("si.custom_reference_type = %(reference_type)s")
        else:
            conditions.append("(" + " OR ".join(invoice_match_parts) + ")")
    elif patient:
        if patient_customer:
            conditions.append(
                "(si.patient = %(patient)s OR (per.reference_name IS NULL AND pe.party = %(customer)s))"
            )
        else:
            conditions.append("si.patient = %(patient)s")

    from healthcare.api.common import get_permitted_cost_centers, resolve_cost_center_filter

    permitted_cc = get_permitted_cost_centers()
    if permitted_cc is not None:
        if not permitted_cc:
            return []
        params["permitted_cc"] = tuple(permitted_cc)
        if patient_customer:
            conditions.append(
                "(IFNULL(pe.cost_center, '') IN %(permitted_cc)s "
                "OR (IFNULL(pe.cost_center, '') = '' AND pe.party = %(customer)s))"
            )
        else:
            conditions.append("IFNULL(pe.cost_center, '') IN %(permitted_cc)s")

    requested_cc = (cost_center or "").strip()
    if requested_cc:
        resolved = resolve_cost_center_filter(requested_cc)
        if resolved is False:
            return []
        if isinstance(resolved, str):
            conditions.append("IFNULL(pe.cost_center, '') = %(filter_cc)s")
            params["filter_cc"] = resolved
        elif isinstance(resolved, (list, tuple)) and resolved:
            params["filter_cc_list"] = tuple(resolved)
            conditions.append("IFNULL(pe.cost_center, '') IN %(filter_cc_list)s")

    where_sql = " AND ".join(conditions)
    rows = frappe.db.sql(
        f"""
        SELECT
            pe.name,
            pe.docstatus,
            pe.posting_date,
            pe.creation,
            pe.payment_type,
            pe.mode_of_payment,
            pe.paid_amount,
            pe.party,
            pe.party_name,
            pe.reference_no,
            pe.cost_center,
            pe.remarks,
            {credited_expr} AS cashier,
            MAX(IFNULL(NULLIF(u.full_name, ''), {credited_expr})) AS cashier_name,
            GROUP_CONCAT(DISTINCT per.reference_name ORDER BY per.reference_name SEPARATOR ', ') AS invoice_name,
            MAX(si.custom_reference_type) AS invoice_reference_type,
            MAX(si.custom_reference_name) AS invoice_reference_name,
            {op_or_ip_select},
            {case_no_select},
            {unique_identity_select}
        FROM `tabPayment Entry` pe
        LEFT JOIN `tabUser` u
            ON u.name = {credited_expr}
        LEFT JOIN `tabPayment Entry Reference` per
            ON per.parent = pe.name
           AND per.reference_doctype = 'Sales Invoice'
        LEFT JOIN `tabSales Invoice` si
            ON si.name = per.reference_name
        WHERE {where_sql}
        GROUP BY pe.name
        ORDER BY pe.posting_date DESC, pe.creation DESC
        """,
        params,
        as_dict=True,
    )
    return rows


@frappe.whitelist()
def get_payment_summary(
    reference_type=None,
    reference_name=None,
    patient=None,
    from_date=None,
    to_date=None,
    mode_of_payment=None,
    receptionist_shift=None,
    filter_by_open_shift=None,
    cashier=None,
    cost_center=None,
):
    rows = get_payment_entries(
        reference_type=reference_type,
        reference_name=reference_name,
        patient=patient,
        from_date=from_date,
        to_date=to_date,
        mode_of_payment=mode_of_payment,
        receptionist_shift=receptionist_shift,
        filter_by_open_shift=filter_by_open_shift,
        cashier=cashier,
        cost_center=cost_center,
    )
    submitted_rows = [r for r in rows if cint(r.get("docstatus")) == 1]
    total_paid = sum(
        -flt(r.get("paid_amount")) if r.get("payment_type") == "Pay" else flt(r.get("paid_amount"))
        for r in submitted_rows
    )
    by_mode = {}
    for r in submitted_rows:
        mode = (r.get("mode_of_payment") or "Unknown").strip() or "Unknown"
        signed = -flt(r.get("paid_amount")) if r.get("payment_type") == "Pay" else flt(r.get("paid_amount"))
        if mode not in by_mode:
            by_mode[mode] = {"mode_of_payment": mode, "count": 0, "amount": 0.0}
        by_mode[mode]["count"] += 1
        by_mode[mode]["amount"] += signed

    modes = sorted(by_mode.values(), key=lambda x: (-x["amount"], x["mode_of_payment"]))
    return {
        "payment_count": len(submitted_rows),
        "total_paid": total_paid,
        "advance_amount": _compute_patient_advance_amount(patient),
        "modes": modes,
    }


_COLLECTION_AMOUNT_KEYS = (
    "consultation",
    "pharmacy",
    "lab",
    "cash",
    "cheque",
    "card",
    "bwallet",
    "disc",
    "balance",
    "total_due",
    "paid_previous",
    "disc_previous",
)


def _collection_zero_amounts():
    return {k: 0.0 for k in _COLLECTION_AMOUNT_KEYS}


def _collection_add_amounts(dst, src):
    for k in _COLLECTION_AMOUNT_KEYS:
        dst[k] = flt(dst.get(k)) + flt(src.get(k))


def _collection_round_amounts(row):
    for k in _COLLECTION_AMOUNT_KEYS:
        row[k] = round(flt(row.get(k)), 3)
    row["total_due"] = round(
        flt(row.get("consultation")) + flt(row.get("pharmacy")) + flt(row.get("lab")),
        3,
    )


def _collection_mode_bucket(mode):
    m = (mode or "").strip().lower()
    if not m:
        return "cash"
    if "cash" in m:
        return "cash"
    if "wallet" in m or "benefit" in m:
        return "bwallet"
    if "card" in m or "visa" in m or "master" in m or "credit" in m:
        return "card"
    return "cheque"


def _collection_service_split(items, so_base_by_name):
    consult = pharm = lab = 0.0
    from healthcare.api.reception_reports import _soa_is_lab_item, _soa_is_medicine_item

    for it in items or []:
        amt = flt(it.get("net_amount") if it.get("net_amount") not in (None, "") else it.get("amount"))
        so_name = (it.get("sales_order") or "").strip()
        base_ref = (so_base_by_name.get(so_name) or "") if so_name else ""
        code = it.get("item_code")
        group = it.get("item_group")
        if _soa_is_lab_item(code, item_group=group, base_reference=base_ref):
            lab += amt
        elif _soa_is_medicine_item(code, item_group=group, base_reference=base_ref):
            pharm += amt
        else:
            consult += amt
    return consult, pharm, lab


def _collection_allocate(consult, pharm, lab, allocated):
    allocated = flt(allocated)
    total = flt(consult) + flt(pharm) + flt(lab)
    if allocated <= 0:
        return 0.0, 0.0, 0.0
    if total <= 0:
        return allocated, 0.0, 0.0
    return (
        allocated * flt(consult) / total,
        allocated * flt(pharm) / total,
        allocated * flt(lab) / total,
    )


def _collection_doctor_label(ref_type, ref_name, consult, pharm, lab, cache):
    key = (ref_type, ref_name)
    if key in cache:
        named = cache[key]
        if named:
            return named
    else:
        named = ""
        if ref_type == "Patient Visit" and ref_name:
            named = frappe.db.get_value("Patient Visit", ref_name, "practitioner_name") or ""
        elif ref_type == "Inpatient Admission" and ref_name:
            row = frappe.db.get_value(
                "Inpatient Admission",
                ref_name,
                ["admission_doctor_name", "primary_practitioner"],
                as_dict=True,
            ) or {}
            named = (row.get("admission_doctor_name") or "").strip()
            if not named and row.get("primary_practitioner"):
                named = (
                    frappe.db.get_value(
                        "Healthcare Practitioner",
                        row.primary_practitioner,
                        "practitioner_name",
                    )
                    or ""
                )
        cache[key] = named
        if named:
            return named
    if flt(lab) >= flt(pharm) and flt(lab) > flt(consult):
        return "LAB VISIT"
    if flt(pharm) > flt(consult):
        return "PHARMACY"
    return named or ""


def _collection_case_date(ref_type, ref_name, fallback, cache):
    key = (ref_type, ref_name)
    if key in cache:
        return cache[key] or fallback
    dt = None
    if ref_type == "Patient Visit" and ref_name:
        dt = frappe.db.get_value("Patient Visit", ref_name, "encounter_date")
    elif ref_type == "Inpatient Admission" and ref_name:
        dt = frappe.db.get_value("Inpatient Admission", ref_name, "admitted_datetime")
        if dt:
            dt = getdate(dt)
    cache[key] = dt
    return dt or fallback


def _collection_patient_display(patient, party_name, cache):
    if patient and patient in cache:
        return cache[patient]
    out = {"file_no": "", "patient_name": party_name or ""}
    if patient:
        row = frappe.db.get_value("Patient", patient, ["file_no", "patient_name"], as_dict=True) or {}
        out["file_no"] = row.get("file_no") or ""
        out["patient_name"] = row.get("patient_name") or party_name or patient
    cache[patient or ""] = out
    return out


@frappe.whitelist()
def get_daily_collection_summary(
    reference_type=None,
    reference_name=None,
    patient=None,
    from_date=None,
    to_date=None,
    mode_of_payment=None,
    receptionist_shift=None,
    filter_by_open_shift=None,
    cashier=None,
    cost_center=None,
):
    """Daily Collection Summary: cashier → IP / OP visit rows with service + mode splits."""
    from_date = getdate(from_date or today())
    to_date = getdate(to_date or from_date)
    if from_date > to_date:
        frappe.throw(_("From Date must be before To Date"))

    pe_rows = get_payment_entries(
        reference_type=reference_type,
        reference_name=reference_name,
        patient=patient,
        from_date=str(from_date),
        to_date=str(to_date),
        mode_of_payment=mode_of_payment,
        receptionist_shift=receptionist_shift,
        filter_by_open_shift=filter_by_open_shift,
        cashier=cashier,
        cost_center=cost_center,
    )
    receive = [
        r
        for r in pe_rows
        if cint(r.get("docstatus")) == 1 and (r.get("payment_type") or "Receive") != "Pay"
    ]

    company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
        "Global Defaults", "default_company"
    )
    company_name = (
        frappe.db.get_value("Company", company, "company_name") if company else ""
    ) or company or ""
    branch = ""
    requested_cc = (cost_center or "").strip()
    cc_names = []
    for r in receive:
        cc = (r.get("cost_center") or "").strip()
        if cc and cc not in cc_names:
            cc_names.append(cc)
    if requested_cc:
        branch = (
            frappe.db.get_value("Cost Center", requested_cc, "cost_center_name") or requested_cc
        )
    elif len(cc_names) == 1:
        branch = (
            frappe.db.get_value("Cost Center", cc_names[0], "cost_center_name") or cc_names[0]
        )
    elif cc_names:
        branch = "All"
    else:
        from healthcare.api.common import get_permitted_cost_centers

        permitted = get_permitted_cost_centers()
        if permitted and len(permitted) == 1:
            branch = (
                frappe.db.get_value("Cost Center", permitted[0], "cost_center_name") or permitted[0]
            )
        elif not permitted:
            branch = ""

    empty = {
        "from_date": str(from_date),
        "to_date": str(to_date),
        "company": company_name,
        "branch": branch or "",
        "users": [],
        "report_total": _collection_zero_amounts(),
    }
    if not receive:
        _collection_round_amounts(empty["report_total"])
        return empty

    pe_names = [r.name for r in receive]
    refs = frappe.get_all(
        "Payment Entry Reference",
        filters={"parent": ["in", pe_names], "reference_doctype": "Sales Invoice"},
        fields=["parent", "reference_name", "allocated_amount"],
        limit_page_length=0,
    )
    refs_by_pe = {}
    invoice_names = []
    for ref in refs:
        refs_by_pe.setdefault(ref.parent, []).append(ref)
        if ref.reference_name and ref.reference_name not in invoice_names:
            invoice_names.append(ref.reference_name)

    invoices = {}
    items_by_invoice = {}
    so_base_by_name = {}
    if invoice_names:
        si_meta = frappe.get_meta("Sales Invoice")
        si_fields = [
            "name",
            "posting_date",
            "grand_total",
            "outstanding_amount",
        ]
        for fieldname in (
            "patient",
            "patient_name",
            "discount_amount",
            "custom_reference_type",
            "custom_reference_name",
            "cost_center",
        ):
            if si_meta.has_field(fieldname):
                si_fields.append(fieldname)
        for inv in frappe.get_all(
            "Sales Invoice",
            filters={"name": ["in", invoice_names]},
            fields=si_fields,
            limit_page_length=0,
        ):
            invoices[inv.name] = inv
        item_meta = frappe.get_meta("Sales Invoice Item")
        item_fields = ["parent", "item_code", "item_name", "amount"]
        for fieldname in ("item_group", "net_amount", "discount_amount", "sales_order"):
            if item_meta.has_field(fieldname):
                item_fields.append(fieldname)
        item_rows = frappe.get_all(
            "Sales Invoice Item",
            filters={"parent": ["in", invoice_names]},
            fields=item_fields,
            limit_page_length=0,
        )
        so_names = []
        for it in item_rows:
            items_by_invoice.setdefault(it.parent, []).append(it)
            so_name = it.get("sales_order")
            if so_name and so_name not in so_names:
                so_names.append(so_name)
        if so_names:
            so_fields = ["name"]
            if frappe.get_meta("Sales Order").has_field("custom_base_reference"):
                so_fields.append("custom_base_reference")
            for so in frappe.get_all(
                "Sales Order",
                filters={"name": ["in", so_names]},
                fields=so_fields,
                limit_page_length=0,
            ):
                so_base_by_name[so.name] = so.get("custom_base_reference") or ""

    doctor_cache, date_cache, patient_cache = {}, {}, {}
    grouped = {}
    invoice_seen = set()

    for pe in receive:
        cashier_id = pe.get("cashier") or pe.get("owner") or ""
        cashier_name = pe.get("cashier_name") or cashier_id
        mode_key = _collection_mode_bucket(pe.get("mode_of_payment"))
        pe_refs = refs_by_pe.get(pe.name) or []
        if not pe_refs:
            ref_type = (pe.get("custom_op_or_ip") or "").strip()
            if ref_type == "Inpatient Admission" or ref_type.upper() == "IP":
                patient_type = "IP"
                ref_type = "Inpatient Admission"
            else:
                patient_type = "OP"
                if ref_type == "Patient Visit" or ref_type.upper() == "OP":
                    ref_type = "Patient Visit"
                else:
                    ref_type = ""
            visit_no = (pe.get("custom_case_no") or pe.get("invoice_reference_name") or pe.name or "").strip()
            disp = _collection_patient_display(None, pe.get("party_name"), patient_cache)
            key = (cashier_id, patient_type, visit_no or pe.name)
            row = grouped.get(key)
            if not row:
                row = {
                    "cashier": cashier_id,
                    "cashier_name": cashier_name,
                    "patient_type": patient_type,
                    "visit_no": visit_no,
                    "date": pe.get("posting_date"),
                    "file_no": disp["file_no"],
                    "patient_name": disp["patient_name"] or pe.get("party_name") or "",
                    "doctor_name": "",
                    **_collection_zero_amounts(),
                }
                grouped[key] = row
            amt = flt(pe.get("paid_amount"))
            row[mode_key] = flt(row.get(mode_key)) + amt
            row["consultation"] = flt(row.get("consultation")) + amt
            continue

        for ref in pe_refs:
            inv = invoices.get(ref.reference_name)
            allocated = flt(ref.allocated_amount)
            if allocated <= 0:
                allocated = flt(pe.get("paid_amount"))
            if not inv:
                continue
            ref_type = (inv.get("custom_reference_type") or pe.get("custom_op_or_ip") or "").strip()
            ref_name = (inv.get("custom_reference_name") or pe.get("custom_case_no") or "").strip()
            if ref_type == "Inpatient Admission" or (ref_type or "").upper() == "IP":
                patient_type = "IP"
                ref_type = "Inpatient Admission"
            else:
                patient_type = "OP"
                if ref_type == "Patient Visit" or (ref_type or "").upper() == "OP":
                    ref_type = "Patient Visit"
            visit_no = ref_name or inv.name
            inv_date = getdate(inv.get("posting_date")) if inv.get("posting_date") else None
            is_previous = bool(inv_date and inv_date < from_date)
            consult_net, pharm_net, lab_net = _collection_service_split(
                items_by_invoice.get(inv.name), so_base_by_name
            )
            a_consult, a_pharm, a_lab = _collection_allocate(consult_net, pharm_net, lab_net, allocated)
            disp = _collection_patient_display(inv.get("patient"), inv.get("patient_name") or pe.get("party_name"), patient_cache)
            case_date = _collection_case_date(ref_type, ref_name, pe.get("posting_date"), date_cache)
            doctor = _collection_doctor_label(ref_type, ref_name, a_consult, a_pharm, a_lab, doctor_cache)
            key = (cashier_id, patient_type, visit_no)
            row = grouped.get(key)
            if not row:
                row = {
                    "cashier": cashier_id,
                    "cashier_name": cashier_name,
                    "patient_type": patient_type,
                    "visit_no": visit_no,
                    "date": case_date,
                    "file_no": disp["file_no"],
                    "patient_name": disp["patient_name"],
                    "doctor_name": doctor,
                    **_collection_zero_amounts(),
                }
                grouped[key] = row
            elif doctor and (
                not row.get("doctor_name")
                or (
                    row.get("doctor_name") in ("PHARMACY", "LAB VISIT")
                    and doctor not in ("PHARMACY", "LAB VISIT")
                )
            ):
                row["doctor_name"] = doctor
            row[mode_key] = flt(row.get(mode_key)) + allocated
            seen_key = (key, inv.name)
            inv_disc = flt(inv.get("discount_amount"))
            if not inv_disc:
                inv_disc = sum(flt(it.get("discount_amount")) for it in items_by_invoice.get(inv.name) or [])
            if is_previous:
                row["paid_previous"] = flt(row.get("paid_previous")) + allocated
                if seen_key not in invoice_seen:
                    row["disc_previous"] = flt(row.get("disc_previous")) + inv_disc
                    row["balance"] = flt(row.get("balance")) + flt(inv.get("outstanding_amount"))
                    invoice_seen.add(seen_key)
            else:
                row["consultation"] = flt(row.get("consultation")) + a_consult
                row["pharmacy"] = flt(row.get("pharmacy")) + a_pharm
                row["lab"] = flt(row.get("lab")) + a_lab
                if seen_key not in invoice_seen:
                    row["disc"] = flt(row.get("disc")) + inv_disc
                    row["balance"] = flt(row.get("balance")) + flt(inv.get("outstanding_amount"))
                    invoice_seen.add(seen_key)

    users_map = {}
    for row in grouped.values():
        _collection_round_amounts(row)
        if row.get("date"):
            try:
                row["date"] = formatdate(row["date"], "dd-MMM-yy").upper()
            except Exception:
                row["date"] = str(row["date"])
        cid = row["cashier"] or ""
        bucket = users_map.setdefault(
            cid,
            {
                "cashier": cid,
                "cashier_name": row["cashier_name"],
                "ip": [],
                "op": [],
            },
        )
        if row["patient_type"] == "IP":
            bucket["ip"].append(row)
        else:
            bucket["op"].append(row)

    users = []
    report_total = _collection_zero_amounts()
    for bucket in users_map.values():
        bucket["ip"].sort(key=lambda r: (r.get("date") or "", r.get("visit_no") or ""))
        bucket["op"].sort(key=lambda r: (r.get("date") or "", r.get("visit_no") or ""))
        ip_total = _collection_zero_amounts()
        op_total = _collection_zero_amounts()
        for r in bucket["ip"]:
            _collection_add_amounts(ip_total, r)
        for r in bucket["op"]:
            _collection_add_amounts(op_total, r)
        user_total = _collection_zero_amounts()
        _collection_add_amounts(user_total, ip_total)
        _collection_add_amounts(user_total, op_total)
        _collection_round_amounts(ip_total)
        _collection_round_amounts(op_total)
        _collection_round_amounts(user_total)
        bucket["ip_total"] = ip_total
        bucket["op_total"] = op_total
        bucket["user_total"] = user_total
        _collection_add_amounts(report_total, user_total)
        users.append(bucket)

    users.sort(key=lambda u: (u.get("cashier_name") or u.get("cashier") or "").lower())
    _collection_round_amounts(report_total)
    return {
        "from_date": str(from_date),
        "to_date": str(to_date),
        "company": company_name,
        "branch": branch or "",
        "users": users,
        "report_total": report_total,
    }


@frappe.whitelist()
def get_patient_statement_of_account(patient=None, from_date=None, to_date=None, company=None):
    """Customer statement of account (General Ledger) for a patient's linked Customer."""
    # Financial data — restrict to billing-facing roles (the GL report is run privileged below).
    frappe.only_for((
        "System Manager",
        "Healthcare Administrator",
        "Reception",
        "Receptionist",
        "Accounts User",
        "Accounts Manager",
        "Doctor",
        "Physician",
    ))
    if not patient:
        frappe.throw(_("Patient is required"))

    patient_row = frappe.db.get_value(
        "Patient", patient, ["customer", "patient_name"], as_dict=True
    )
    if not patient_row or not patient_row.customer:
        frappe.throw(
            _("Patient {0} has no linked Customer. Link a customer on the patient record first.").format(
                patient
            )
        )

    company = company or frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
        "Global Defaults", "default_company"
    )
    if not company:
        frappe.throw(_("Company is required"))

    to_date = getdate(to_date or today())
    from_date = getdate(from_date or add_months(to_date, -12))
    if from_date > to_date:
        frappe.throw(_("From Date must be before To Date"))

    from erpnext.accounts.report.general_ledger.general_ledger import execute

    filters = frappe._dict(
        {
            "company": company,
            "from_date": from_date,
            "to_date": to_date,
            "party_type": "Customer",
            "party": json.dumps([patient_row.customer]),
        }
    )

    # The General Ledger report reads GL Entry, which portal roles (e.g. Receptionist) have
    # no DocPerm on. This endpoint is already scoped to one patient's Customer (party filter),
    # so run the report privileged and restore the user, instead of exposing GL Entry broadly.
    _original_user = frappe.session.user
    try:
        frappe.set_user("Administrator")
        _columns, raw_data = execute(filters)
    finally:
        frappe.set_user(_original_user)

    entries = []
    for row in raw_data or []:
        if not isinstance(row, dict):
            continue
        posting_date = row.get("posting_date")
        entries.append(
            {
                "posting_date": str(posting_date) if posting_date else None,
                "account": row.get("account"),
                "debit": flt(row.get("debit")),
                "credit": flt(row.get("credit")),
                "balance": flt(row.get("balance")),
                "voucher_type": row.get("voucher_type"),
                "voucher_no": row.get("voucher_no"),
                "against_voucher": row.get("against_voucher"),
                "remarks": row.get("remarks"),
                "is_section_row": not posting_date,
            }
        )

    customer_name = frappe.db.get_value("Customer", patient_row.customer, "customer_name")

    return {
        "patient": patient,
        "patient_name": patient_row.patient_name,
        "customer": patient_row.customer,
        "customer_name": customer_name,
        "company": company,
        "from_date": str(from_date),
        "to_date": str(to_date),
        "currency": frappe.get_cached_value("Company", company, "default_currency"),
        "entries": entries,
        "closing_balance": flt(entries[-1].get("balance")) if entries else 0.0,
    }


@frappe.whitelist()
def create_credit_note(sales_invoice=None, reason=None):
    """Create and submit a credit note (return Sales Invoice) against a submitted invoice.

    Financial action — restricted to billing-facing roles. The reason is recorded on the
    credit note for audit (BIL-11).
    """
    frappe.only_for((
        "System Manager",
        "Healthcare Administrator",
        "Accounts User",
        "Accounts Manager",
        "Reception",
        "Receptionist",
    ))
    if not sales_invoice:
        frappe.throw(_("Sales Invoice is required"))
    if not (reason and str(reason).strip()):
        frappe.throw(_("A reason is required to create a credit note."))

    src = frappe.db.get_value(
        "Sales Invoice", sales_invoice, ["docstatus", "is_return"], as_dict=True
    )
    if not src:
        frappe.throw(_("Sales Invoice {0} was not found.").format(frappe.bold(sales_invoice)))
    if src.is_return:
        frappe.throw(_("{0} is already a credit note.").format(frappe.bold(sales_invoice)))
    if src.docstatus != 1:
        frappe.throw(_("A credit note can only be created against a submitted invoice."))

    from erpnext.controllers.sales_and_purchase_return import make_return_doc

    credit_note = make_return_doc("Sales Invoice", sales_invoice)
    credit_note.remarks = ((credit_note.remarks or "").strip() + f"\nCredit Note reason: {reason.strip()}").strip()
    credit_note.flags.ignore_permissions = True
    credit_note.insert(ignore_permissions=True)
    credit_note.submit()

    return {"credit_note": credit_note.name, "grand_total": flt(credit_note.grand_total)}


def _compute_patient_advance_amount(patient=None):
    """Unallocated (advance/credit) balance held for a patient's customer.

    This is money the patient has paid that is not yet applied to any invoice.
    When no patient is scoped, returns the total advance across permitted branches.
    """
    conditions = [
        "docstatus = 1",
        "payment_type = 'Receive'",
        "party_type = 'Customer'",
        "IFNULL(unallocated_amount, 0) > 0",
    ]
    params = {}

    if patient:
        customer = frappe.db.get_value("Patient", patient, "customer")
        if not customer:
            return 0.0
        conditions.append("party = %(customer)s")
        params["customer"] = customer
    else:
        from healthcare.api.common import get_permitted_cost_centers

        permitted_cc = get_permitted_cost_centers()
        if permitted_cc is not None:
            if not permitted_cc:
                return 0.0
            conditions.append("IFNULL(cost_center, '') IN %(permitted_cc)s")
            params["permitted_cc"] = tuple(permitted_cc)

    result = frappe.db.sql(
        f"SELECT SUM(unallocated_amount) FROM `tabPayment Entry` WHERE {' AND '.join(conditions)}",
        params,
    )
    return flt(result[0][0]) if result and result[0][0] else 0.0


@frappe.whitelist()
def get_invoice_items(invoice_name):
    """
    Get items from a specific sales invoice
    """
    if not invoice_name:
        return []
    
    invoice = frappe.get_doc("Sales Invoice", invoice_name)
    items = []
    
    for item in invoice.items:
        items.append({
            "item_code": item.item_code,
            "item_name": item.item_name,
            "description": item.description,
            "qty": item.qty,
            "rate": item.rate,
            "amount": item.amount,
            "discount_amount": item.discount_amount,
            "net_amount": item.net_amount
        })
    
    return items


@frappe.whitelist()
def get_invoice_details(invoice_name):
    """
    Get detailed information about an invoice including items (for Reception slide-over).
    """
    if not invoice_name:
        return None

    invoice = frappe.get_doc("Sales Invoice", invoice_name)
    frappe.has_permission("Sales Invoice", "read", doc=invoice, throw=True)

    cc = getattr(invoice, "custom_created_at", None)
    cc_label = (
        frappe.db.get_value("Cost Center", cc, "cost_center_name") if cc else None
    ) or cc

    dept = getattr(invoice, "department", None) or getattr(invoice, "custom_department", None)

    return {
        "name": invoice.name,
        "docstatus": invoice.docstatus,
        "company": invoice.company,
        "customer": invoice.customer,
        "customer_name": invoice.customer_name,
        "posting_date": invoice.posting_date,
        "due_date": invoice.due_date,
        "grand_total": invoice.grand_total,
        "outstanding_amount": invoice.outstanding_amount,
        "status": invoice.status,
        "cost_center": invoice.cost_center,
        "department": dept,
        "custom_created_at": getattr(invoice, "custom_created_at", None),
        "collection_cost_center_name": cc_label,
        "custom_internal_employee": int(getattr(invoice, "custom_internal_employee", 0) or 0),
        "custom_reference_type": getattr(invoice, "custom_reference_type", None),
        "custom_reference_name": getattr(invoice, "custom_reference_name", None),
        "patient": getattr(invoice, "patient", None),
        "items": [
            {
                "name": item.name,
                "item_code": item.item_code,
                "item_name": item.item_name,
                "description": item.description,
                "qty": item.qty,
                "rate": item.rate,
                "price_list_rate": flt(getattr(item, "price_list_rate", 0)),
                "amount": item.amount,
                "discount_amount": flt(getattr(item, "discount_amount", 0)),
                "discount_percentage": flt(getattr(item, "discount_percentage", 0)),
                "net_amount": item.net_amount,
                "cost_center": getattr(item, "cost_center", None),
            }
            for item in invoice.items
        ],
    }


def _apply_sales_invoice_item_discount(line, discount_amount=None, discount_percentage=None):
	"""Set per-line discount. Gross unit rate stays in price_list_rate; net rate is saved to line.rate.

	ERPNext calculate_item_rate compares item.rate to (rate_with_margin - discount_amount) and
	*wipes the discount* when they don't match — so we must set line.rate to the discounted
	(net) rate here, otherwise the discount is lost on save.
	"""
	if hasattr(line, "pricing_rules"):
		line.pricing_rules = None
	if hasattr(line, "ignore_pricing_rule"):
		line.ignore_pricing_rule = 1

	gross = flt(getattr(line, "price_list_rate", 0)) or flt(getattr(line, "rate", 0))

	if discount_amount is not None:
		disc_amt = flt(discount_amount)
		pct = (disc_amt / gross * 100.0) if gross > 0 else 0.0
		line.discount_amount = disc_amt
		line.discount_percentage = pct
		line.rate = flt(gross - disc_amt)
		return

	if discount_percentage is not None:
		pct = flt(discount_percentage)
		disc_amt = (gross * pct / 100.0) if gross > 0 else 0.0
		line.discount_percentage = pct
		line.discount_amount = disc_amt
		line.rate = flt(gross - disc_amt)


def _set_line_gross_rate(line, gross_rate):
	"""Store the user-facing unit rate as price list rate (before line discount)."""
	gross = flt(gross_rate)
	if hasattr(line, "price_list_rate"):
		line.price_list_rate = gross
	line.rate = gross


@frappe.whitelist()
def update_sales_invoice_items(invoice_name, items):
    """Update draft Sales Invoice lines — edit existing rows, add new services, remove omitted rows."""
    assert_editing_allowed()
    if not invoice_name:
        frappe.throw(_("Invoice name is required"))

    if isinstance(items, str):
        items = json.loads(items)
    if not isinstance(items, list) or not items:
        frappe.throw(_("At least one invoice line is required"))

    doc = frappe.get_doc("Sales Invoice", invoice_name)
    frappe.has_permission("Sales Invoice", "write", doc=doc, throw=True)
    if doc.docstatus != 0:
        frappe.throw(_("Only draft invoices can be edited"))

    default_cc = (
        getattr(doc, "custom_created_at", None)
        or doc.cost_center
        or ""
    )

    incoming_names = {
        (row.get("name") or "").strip()
        for row in items
        if isinstance(row, dict) and (row.get("name") or "").strip()
    }
    for line in list(doc.items):
        if line.name not in incoming_names:
            doc.remove(line)

    by_name = {line.name: line for line in doc.items}
    touched = 0

    for row in items:
        if not isinstance(row, dict):
            continue
        row_name = (row.get("name") or "").strip()
        if row_name:
            if row_name not in by_name:
                frappe.throw(_("Invoice line not found: {0}").format(row_name))
            line = by_name[row_name]
            if row.get("qty") is not None:
                qty = flt(row.get("qty"))
                if qty <= 0:
                    frappe.throw(_("Quantity must be greater than zero for {0}").format(line.item_code))
                line.qty = qty
            if row.get("rate") is not None:
                _set_line_gross_rate(line, row.get("rate"))
            if row.get("discount_amount") is not None or row.get("discount_percentage") is not None:
                _apply_sales_invoice_item_discount(
                    line,
                    discount_amount=row.get("discount_amount"),
                    discount_percentage=row.get("discount_percentage"),
                )
            cc = row.get("cost_center")
            if cc is not None and hasattr(line, "cost_center"):
                line.cost_center = (cc or "").strip() or line.cost_center
            touched += 1
            continue

        item_code = (row.get("item_code") or "").strip()
        if not item_code:
            frappe.throw(_("Each new invoice line needs an item"))
        qty = flt(row.get("qty"))
        if qty <= 0:
            frappe.throw(_("Quantity must be greater than zero for {0}").format(item_code))
        gross = flt(row.get("rate"))
        line = {
            "item_code": item_code,
            "item_name": row.get("item_name"),
            "description": row.get("description"),
            "qty": qty,
            "rate": gross,
            "price_list_rate": gross,
            "cost_center": (row.get("cost_center") or "").strip() or default_cc,
        }
        if row.get("uom"):
            line["uom"] = row.get("uom")
        if row.get("discount_amount") is not None or row.get("discount_percentage") is not None:
            line["discount_amount"] = flt(row.get("discount_amount") or 0)
            line["discount_percentage"] = flt(row.get("discount_percentage") or 0)
            if line.get("discount_amount") or line.get("discount_percentage"):
                line["ignore_pricing_rule"] = 1
        doc.append("items", line)
        new_line = doc.items[-1]
        if row.get("discount_amount") is not None or row.get("discount_percentage") is not None:
            _apply_sales_invoice_item_discount(
                new_line,
                discount_amount=row.get("discount_amount"),
                discount_percentage=row.get("discount_percentage"),
            )
        touched += 1

    if not touched or not doc.items:
        frappe.throw(_("No invoice lines were updated"))

    from healthcare.api.sales_order_cost_center import finalize_sales_invoice_cost_centers

    finalize_sales_invoice_cost_centers(doc, default_cc)
    doc.run_method("calculate_taxes_and_totals")
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return get_invoice_details(invoice_name)


def _ensure_sales_invoice_due_date(doc):
    """ERPNext rejects Due Date before Posting Date. Old drafts often have a stale due date."""
    posting = getdate(doc.posting_date) or getdate(today())
    due = getdate(today())
    if due < posting:
        due = posting
    doc.due_date = due
    for row in doc.get("payment_schedule") or []:
        row_due = getdate(row.due_date) if row.due_date else None
        if not row_due or row_due < posting:
            row.due_date = due


@frappe.whitelist()
def submit_sales_invoice_doc(invoice_name):
    """Submit a draft Sales Invoice."""
    if not invoice_name:
        frappe.throw(_("Invoice name is required"))

    doc = frappe.get_doc("Sales Invoice", invoice_name)
    frappe.has_permission("Sales Invoice", "submit", doc=doc, throw=True)
    if doc.docstatus != 0:
        frappe.throw(_("Only draft invoices can be submitted"))

    from healthcare.api.sales_order_cost_center import (
        finalize_sales_invoice_cost_centers,
        sync_sales_invoice_uom_from_previous_docs,
    )

    finalize_sales_invoice_cost_centers(doc)
    sync_sales_invoice_uom_from_previous_docs(doc)
    _ensure_sales_invoice_due_date(doc)

    # set_missing_values / calculate during save can reset UOM — restore right before prevdoc check
    _orig = doc.validate_with_previous_doc

    def _validate_with_previous_preserving_uom(*args, **kwargs):
        sync_sales_invoice_uom_from_previous_docs(doc)
        return _orig(*args, **kwargs)

    doc.validate_with_previous_doc = _validate_with_previous_preserving_uom

    _orig_due = doc.validate_due_date

    def _validate_due_date_with_fix(*args, **kwargs):
        _ensure_sales_invoice_due_date(doc)
        return _orig_due(*args, **kwargs)

    doc.validate_due_date = _validate_due_date_with_fix

    doc.flags.ignore_permissions = True
    doc.save(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    return {"name": doc.name, "docstatus": doc.docstatus, "status": doc.status}


@frappe.whitelist()
def cancel_or_delete_sales_invoice(invoice_name):
    """
    Draft (docstatus 0): delete document.
    Submitted (docstatus 1): cancel document.
    """
    if not invoice_name:
        frappe.throw(_("Invoice name is required"))

    doc = frappe.get_doc("Sales Invoice", invoice_name)

    if doc.docstatus == 1:
        frappe.has_permission("Sales Invoice", "cancel", doc=doc, throw=True)
        doc.cancel()
        frappe.db.commit()
        return {"name": doc.name, "docstatus": doc.docstatus, "status": doc.status}

    if doc.docstatus == 0:
        frappe.has_permission("Sales Invoice", "delete", doc=doc, throw=True)
        frappe.delete_doc("Sales Invoice", invoice_name)
        frappe.db.commit()
        return {"deleted": True, "name": invoice_name}

    frappe.throw(_("This invoice cannot be cancelled"))


@frappe.whitelist()
def create_payment_entry(
    invoice_name,
    payment_amount=None,
    payment_mode=None,
    cost_center=None,
    department=None,
    reference_number=None,
    payment_modes=None,
):
    """
    Create payment entry(ies) against a sales invoice.

    Pass either a single payment_mode + payment_amount, or payment_modes as a list of
    {mode_of_payment, amount, reference_no?} — one Payment Entry is created per mode.
    """
    try:
        import json
        from frappe.utils import cstr

        if isinstance(payment_modes, str):
            payment_modes = json.loads(payment_modes) if payment_modes.strip() else None

        modes = []
        if isinstance(payment_modes, list) and payment_modes:
            for row in payment_modes:
                if not isinstance(row, dict):
                    continue
                mode = cstr(row.get("mode_of_payment") or row.get("payment_mode") or "").strip()
                amount = flt(row.get("amount") or row.get("paid_amount") or 0)
                if not mode or amount <= 0:
                    continue
                modes.append(
                    {
                        "mode_of_payment": mode,
                        "amount": amount,
                        "reference_no": cstr(row.get("reference_no") or "").strip() or None,
                    }
                )
        else:
            mode = cstr(payment_mode or "").strip()
            amount = flt(payment_amount)
            if not mode:
                return {"success": False, "message": _("Mode of payment is required.")}
            if amount <= 0:
                return {"success": False, "message": _("Payment amount must be greater than zero.")}
            modes.append(
                {
                    "mode_of_payment": mode,
                    "amount": amount,
                    "reference_no": cstr(reference_number or "").strip() or None,
                }
            )

        if not modes:
            return {
                "success": False,
                "message": _("Add at least one mode of payment with an amount greater than zero"),
            }

        seen = set()
        for row in modes:
            if row["mode_of_payment"] in seen:
                return {
                    "success": False,
                    "message": _("Duplicate mode of payment: {0}").format(row["mode_of_payment"]),
                }
            seen.add(row["mode_of_payment"])

        invoice = frappe.get_doc("Sales Invoice", invoice_name)
        if invoice.docstatus != 1:
            return {
                "success": False,
                "message": _("Only submitted invoices can receive payments."),
            }

        outstanding = flt(invoice.outstanding_amount)
        if outstanding <= 0:
            return {"success": False, "message": _("This invoice has no outstanding balance.")}

        total_paid = sum(flt(m["amount"]) for m in modes)
        company = frappe.get_doc("Company", invoice.company)
        default_receivable_account = company.default_receivable_account
        default_cash_account = company.default_cash_account
        default_bank_account = company.default_bank_account

        if not default_receivable_account:
            frappe.throw(
                "Default Receivable Account not set in Company {0}".format(invoice.company)
            )

        from healthcare.api.receptionist_shift import stamp_receptionist_shift_on_doc

        group_identity = None
        if len(modes) > 1 and frappe.get_meta("Payment Entry").has_field("custom_unique_identity"):
            group_identity = f"PEGRP-{frappe.generate_hash(length=12).upper()}"

        created = []
        for mode_row in modes:
            # Refresh outstanding after each PE so allocations stay accurate.
            invoice.reload()
            outstanding = flt(invoice.outstanding_amount)
            pay_amt = flt(mode_row["amount"])
            payment_mode = mode_row["mode_of_payment"]
            ref_no = mode_row.get("reference_no") or reference_number or f"PAY-{invoice_name}"

            paid_to_account = None
            if payment_mode.lower() == "cash":
                paid_to_account = default_cash_account
            else:
                paid_to_account = default_bank_account
            if not paid_to_account:
                paid_to_account = default_cash_account or default_bank_account
            if not paid_to_account:
                frappe.throw(
                    "No Cash or Bank account found. Please set default_cash_account or default_bank_account in Company {0}".format(
                        invoice.company
                    )
                )

            payment_entry = frappe.new_doc("Payment Entry")
            payment_entry.payment_type = "Receive"
            payment_entry.company = invoice.company
            payment_entry.party_type = "Customer"
            payment_entry.party = invoice.customer
            payment_entry.party_name = invoice.customer_name
            payment_entry.paid_amount = pay_amt
            payment_entry.received_amount = pay_amt
            payment_entry.reference_date = frappe.utils.today()
            payment_entry.reference_no = ref_no
            payment_entry.mode_of_payment = payment_mode
            payment_entry.department = department
            payment_entry.paid_from = default_receivable_account
            payment_entry.paid_to = paid_to_account
            if cost_center:
                payment_entry.cost_center = cost_center
            payment_entry.currency = company.default_currency
            if group_identity:
                payment_entry.custom_unique_identity = group_identity

            allocated = min(pay_amt, outstanding) if outstanding > 0 else pay_amt
            payment_entry.append(
                "references",
                {
                    "reference_doctype": "Sales Invoice",
                    "reference_name": invoice_name,
                    "total_amount": flt(invoice.grand_total),
                    "outstanding_amount": outstanding,
                    "allocated_amount": allocated,
                },
            )

            stamp_receptionist_shift_on_doc(payment_entry)
            payment_entry.insert()
            payment_entry.submit()
            created.append(payment_entry.name)

        frappe.db.commit()

        if len(created) == 1:
            return {
                "success": True,
                "message": f"Payment of {total_paid} successfully recorded against invoice {invoice_name}",
                "payment_entry": created[0],
                "payment_entries": created,
            }

        return {
            "success": True,
            "message": f"Payments recorded against invoice {invoice_name}: {', '.join(created)}",
            "payment_entry": created[0],
            "payment_entries": created,
        }

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(f"Payment Entry Error: {str(e)}", "Billing Payment")
        return {
            "success": False,
            "message": str(e)
        }


@frappe.whitelist()
def get_invoices_by_reference(reference_name, reference_type=None, patient=None):
	"""
	Get Sales Invoices for a Patient Visit or Inpatient Admission.

	Includes draft and submitted (excludes cancelled). Optionally filters by patient.
	Legacy rows with empty ``custom_reference_type`` but matching ``custom_reference_name``
	are included only when a typed query returns nothing.
	"""
	if not reference_name:
		return []

	fields = [
		"name",
		"docstatus",
		"grand_total",
		"outstanding_amount",
		"posting_date",
		"status",
		"custom_reference_type",
		"custom_reference_name",
		"patient",
	]

	def _fetch(flt):
		inv = frappe.get_all(
			"Sales Invoice",
			filters=flt,
			fields=fields,
			order_by="posting_date desc, modified desc",
		)
		if patient:
			inv = [r for r in inv if (r.get("patient") or "") == patient]
		return inv

	filters = _sales_invoice_filters_for_reference(reference_type, reference_name, submitted_only=False)
	if not filters:
		return []

	invoices = _fetch(filters)
	if not invoices and reference_type:
		legacy_filters = {
			"custom_reference_name": reference_name,
			"docstatus": ["in", [0, 1]],
		}
		invoices = _fetch(legacy_filters)

	return invoices


def _load_payload_list(payload):
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            payload = []
    return payload or []


def _get_or_create_employee_customer(employee_id):
    """Customer.name = Employee ID; Customer.customer_name = Employee display name."""
    employee_id = (employee_id or "").strip()
    if not employee_id:
        frappe.throw(_("Employee is required"))
    if not frappe.db.exists("Employee", employee_id):
        frappe.throw(_("Employee {0} not found").format(employee_id))

    employee = frappe.get_cached_doc("Employee", employee_id)
    display_name = (employee.employee_name or employee_id).strip()

    if frappe.db.exists("Customer", employee_id):
        current_name = frappe.db.get_value("Customer", employee_id, "customer_name")
        if current_name != display_name:
            frappe.db.set_value(
                "Customer", employee_id, "customer_name", display_name, update_modified=False
            )
        return employee_id

    legacy_name = frappe.db.get_value("Customer", {"customer_name": display_name}, "name")
    if legacy_name and legacy_name != employee_id:
        frappe.rename_doc("Customer", legacy_name, employee_id, force=True, merge=False)
        return employee_id

    customer_doc = frappe.get_doc(
        {
            "doctype": "Customer",
            "customer_name": display_name,
            "customer_type": "Individual",
            "customer_group": frappe.db.get_single_value("Selling Settings", "customer_group")
            or "Individual",
            "territory": frappe.db.get_single_value("Selling Settings", "territory")
            or "All Territories",
        }
    )
    customer_doc.insert(ignore_permissions=True)

    if customer_doc.name != employee_id:
        frappe.rename_doc("Customer", customer_doc.name, employee_id, force=True, merge=False)

    return employee_id


def _template_display_name(template_dt, template_dn):
    """Human-readable template title for reception (not raw document ID)."""
    if not template_dt or not template_dn:
        return ""
    if not frappe.db.exists(template_dt, template_dn):
        return (template_dn or "").strip()
    meta = frappe.get_meta(template_dt)
    for fieldname in (
        "template_name",
        "lab_test_name",
        "procedure_template",
        "therapy_type",
        "activity",
        "title",
        "name",
    ):
        if meta.has_field(fieldname):
            val = frappe.db.get_value(template_dt, template_dn, fieldname)
            if val:
                return str(val).strip()
    return (template_dn or "").strip()


def _kind_label_for_service_request(sr):
    """Reception-friendly category from Service Request template."""
    if not sr:
        return _("Clinical service")

    td = (sr.get("template_dt") or "").strip()
    dn = (sr.get("template_dn") or "").strip()
    dn_label = _template_display_name(td, dn) if dn else ""
    suffix = f" — {dn_label}" if dn_label else ""

    if td == "Lab Test Template":
        return _("Lab tests") + suffix
    if td == "Clinical Procedure Template":
        return _("Clinical procedure") + suffix
    if td == "Observation Template":
        return _("Observation") + suffix
    if td == "Therapy Type":
        return _("Therapy") + suffix
    if td == "Healthcare Service Template":
        return _("IP / ward service") + suffix
    if td == "Healthcare Activity":
        return _("Healthcare activity") + suffix
    if td == "Consultation Service Template":
        return _("Consultation") + suffix
    if td == "Appointment Type":
        return _("Appointment") + suffix

    if td:
        return td + suffix
    od = (sr.get("order_description") or "").strip()
    if od:
        return od[:120]
    return _("Service request")


def _order_kind_label(so_row, sr_by_name):
    """Human-readable order type for reception (labs, drugs, IP services, etc.)."""
    ref_t = (so_row.get("custom_reference_type") or "").strip()
    base_ref = (so_row.get("custom_base_reference") or "").strip()
    base_name = (so_row.get("custom_base_reference_name") or "").strip()

    if base_ref == "Patient Medication Order":
        return _("Medication / pharmacy")

    if base_ref in ("Admission Detail", "Medicine Given"):
        return _("Admission medicine charges")

    if base_ref == "Service Request" and base_name:
        sr = sr_by_name.get(base_name)
        return _kind_label_for_service_request(sr)

    if base_ref == "Lab Test" and base_name:
        lt = frappe.db.get_value(
            "Lab Test",
            base_name,
            ["lab_test_name", "template"],
            as_dict=True,
        ) or {}
        title = (lt.get("lab_test_name") or lt.get("template") or base_name).strip()
        return _("Lab test") + (f" — {title}" if title else "")

    if base_ref == "Patient Appointment" and base_name:
        apt_type = frappe.db.get_value("Patient Appointment", base_name, "appointment_type")
        pract = frappe.db.get_value("Patient Appointment", base_name, "practitioner_name")
        parts = [_("Appointment")]
        if apt_type:
            parts.append(str(apt_type))
        if pract:
            parts.append(str(pract))
        return " — ".join(parts[:3])

    if base_ref == "Inpatient Healthcare Service" and base_name:
        svc = frappe.db.get_value("Inpatient Healthcare Service", base_name, "service") or base_name
        return _("IP / ward service") + f" — {svc}"

    if base_ref == "IP Service" and base_name:
        return _("ECT Service") + f" — {base_name}"

    if base_ref == "Clinical Procedure" and base_name:
        title = frappe.db.get_value("Clinical Procedure", base_name, "procedure_template") or base_name
        return _("Clinical procedure") + f" — {title}"

    if ref_t == "Service Request":
        sr_name = so_row.get("custom_reference_name")
        sr = sr_by_name.get(sr_name) if sr_name else None
        return _kind_label_for_service_request(sr)

    if ref_t == "Patient Visit":
        return _("OP visit charges")
    if ref_t == "Inpatient Admission":
        return _("Admission charges")

    if ref_t == "Patient" and base_ref == "Patient":
        from healthcare.api.patient_file_no_charge import get_file_no_charge_config

        item_code = (get_file_no_charge_config().get("item_code") or "").strip()
        items = so_row.get("items") or []
        if item_code and any((it.get("item_code") == item_code for it in items)):
            return _("File number charge")
        return _("Patient charges")

    if base_ref:
        return base_ref + (f" — {base_name}" if base_name else "")

    return ref_t or _("Billing order")


def _attach_sales_order_items(rows):
    """Attach SO lines and reception labels.

    Lines are loaded via get_doc(\"Sales Order\").items — same as Desk — because
    frappe.get_all(\"Sales Order Item\", ...) often returns nothing for roles that
    can read Sales Order but lack explicit Sales Order Item list permission; get_all
    also applies a row limit by default.
    """
    sr_refs = []
    for r in rows:
        base_t = (r.get("custom_base_reference") or "").strip()
        base_n = (r.get("custom_base_reference_name") or "").strip()
        if base_t == "Service Request" and base_n:
            sr_refs.append(base_n)
            continue
        ref_t = (r.get("custom_reference_type") or "").strip()
        ref_n = (r.get("custom_reference_name") or "").strip()
        if ref_t == "Service Request" and ref_n:
            sr_refs.append(ref_n)
    sr_refs = list(dict.fromkeys(sr_refs))
    sr_by_name = {}
    if sr_refs:
        uniq_sr = list(dict.fromkeys(sr_refs))
        srs = frappe.get_all(
            "Service Request",
            filters={"name": ["in", uniq_sr]},
            fields=["name", "template_dt", "template_dn", "order_description"],
        )
        sr_by_name = {s.name: s for s in srs}

    for row in rows:
        so_name = row.get("name")
        items = []
        if so_name:
            try:
                doc = frappe.get_doc("Sales Order", so_name)
                from healthcare.api.pos_dispense_return import (
                    enrich_sales_order_billable_fields,
                    get_net_billable_qty_for_so_item,
                    get_returned_qty_for_so_item,
                    is_pos_dispense_sales_order,
                )

                enrich_sales_order_billable_fields(row)
                for it in doc.get("items") or []:
                    returned_qty = (
                        get_returned_qty_for_so_item(doc, it) if is_pos_dispense_sales_order(doc) else 0
                    )
                    billable_qty = get_net_billable_qty_for_so_item(doc, it)
                    items.append(
                        {
                            "item_code": it.item_code,
                            "item_name": (it.item_name or it.item_code or "").strip(),
                            "description": (getattr(it, "description", None) or "").strip(),
                            "qty": billable_qty,
                            "original_qty": it.qty,
                            "returned_qty": returned_qty,
                            "rate": it.rate,
                            "amount": flt(billable_qty) * flt(it.rate),
                        }
                    )
            except frappe.PermissionError:
                items = []
            except frappe.DoesNotExistError:
                items = []
        row["items"] = items
        row["order_kind_label"] = _order_kind_label(row, sr_by_name)


@frappe.whitelist()
def get_related_sales_orders(reference_type, reference_name):
    if not reference_type or not reference_name:
        frappe.throw(_("Reference type and reference name are required"))

    if reference_type not in ("Patient Visit", "Inpatient Admission"):
        frappe.throw(_("Unsupported reference type"))

    so_fields = [
        "name",
        "transaction_date",
        "grand_total",
        "status",
        "customer",
        "company",
        "custom_reference_type",
        "custom_reference_name",
        "custom_base_reference",
        "custom_base_reference_name",
    ]

    direct = frappe.get_all(
        "Sales Order",
        filters={
            "custom_reference_type": reference_type,
            "custom_reference_name": reference_name,
            "docstatus": ["!=", 2],
        },
        fields=so_fields,
        order_by="creation desc",
    )
    
    service_request_field = "patient_visit" if reference_type == "Patient Visit" else "inpatient_record"
    service_requests = frappe.get_all(
        "Service Request",
        filters={service_request_field: reference_name, "docstatus": ["!=", 2]},
        fields=["name"],
    )
    sr_names = [row.name for row in service_requests]
    sr_orders = []
    if sr_names:
        sr_orders_new = frappe.get_all(
            "Sales Order",
            filters={
                "custom_reference_type": reference_type,
                "custom_reference_name": reference_name,
                "custom_base_reference": "Service Request",
                "custom_base_reference_name": ["in", sr_names],
                "docstatus": ["!=", 2],
            },
            fields=so_fields,
            order_by="creation desc",
        )
        sr_orders_legacy = frappe.get_all(
            "Sales Order",
            filters={
                "custom_reference_type": "Service Request",
                "custom_reference_name": ["in", sr_names],
                "docstatus": ["!=", 2],
            },
            fields=so_fields,
            order_by="creation desc",
        )
        sr_orders = list(sr_orders_new) + list(sr_orders_legacy)

    out = []
    seen = set()
    for row in direct + sr_orders:
        if row.name in seen:
            continue
        seen.add(row.name)
        out.append(row)

    # Per-order lines: loaded inside _attach_sales_order_items via frappe.get_doc(...).items
    _attach_sales_order_items(out)
    return out

@frappe.whitelist()
def create_additional_collection_invoice(
    company,
    created_at_cost_center,
    customer=None,
    reference_type=None,
    reference_name=None,
    patient=None,
    posting_date=None,
    due_date=None,
    sales_orders=None,
    additional_items=None,
):
    sales_orders = _load_payload_list(sales_orders)
    additional_items = _load_payload_list(additional_items)

    if not company:
        frappe.throw(_("Company is required"))
    if not customer and patient:
        customer = frappe.db.get_value("Patient", patient, "customer")
    if not customer:
        frappe.throw(_("Customer is required (or provide patient linked to a customer)"))
    if not created_at_cost_center:
        frappe.throw(_("Collection cost center is required"))

    invoice = frappe.new_doc("Sales Invoice")
    invoice.company = company
    invoice.customer = customer
    invoice.posting_date = posting_date or nowdate()
    invoice.due_date = due_date or invoice.posting_date
    invoice.custom_created_at = created_at_cost_center
    invoice.ignore_pricing_rule = 1
    if patient:
        invoice.patient = patient
    if reference_type and reference_name:
        invoice.custom_reference_type = reference_type
        invoice.custom_reference_name = reference_name

    for so_name in sales_orders:
        if not so_name:
            continue
        so_doc = frappe.get_doc("Sales Order", so_name)
        from healthcare.api.sales_order_cost_center import sales_invoice_item_from_sales_order_item

        for item in so_doc.items:
            line = sales_invoice_item_from_sales_order_item(so_doc, item)
            if not line:
                continue
            line["cost_center"] = line.get("cost_center") or created_at_cost_center
            invoice.append("items", line)

    for row in additional_items:
        if not isinstance(row, dict):
            continue
        if not row.get("item_code"):
            continue
        qty = float(row.get("qty") or 0)
        if qty <= 0:
            continue
        line = {
            "item_code": row.get("item_code"),
            "item_name": row.get("item_name"),
            "description": row.get("description"),
            "qty": qty,
            "rate": float(row.get("rate") or 0),
            "cost_center": row.get("cost_center") or created_at_cost_center,
        }
        if row.get("uom"):
            line["uom"] = row.get("uom")
        invoice.append("items", line)

    if not invoice.items:
        frappe.throw(_("Please add at least one item or sales order"))

    from healthcare.api.receptionist_shift import stamp_receptionist_shift_on_doc

    stamp_receptionist_shift_on_doc(invoice)
    invoice.insert(ignore_permissions=True)
    return {"name": invoice.name, "grand_total": invoice.grand_total, "customer": invoice.customer}


@frappe.whitelist()
def create_internal_employee_invoice(
    employee_name=None,
    employee=None,
    company=None,
    created_at_cost_center=None,
    items=None,
    posting_date=None,
    due_date=None,
    patient=None,
):
    employee_id = (employee or employee_name or "").strip()
    if not employee_id:
        frappe.throw(_("Employee is required"))
    if not company:
        frappe.throw(_("Company is required"))
    if not created_at_cost_center:
        frappe.throw(_("Collection cost center is required"))

    items = _load_payload_list(items)
    if not items:
        frappe.throw(_("Please add at least one item"))

    customer = _get_or_create_employee_customer(employee_id)

    invoice = frappe.new_doc("Sales Invoice")
    invoice.company = company
    invoice.customer = customer
    invoice.posting_date = posting_date or nowdate()
    invoice.due_date = due_date or invoice.posting_date
    invoice.custom_created_at = created_at_cost_center
    invoice.custom_internal_employee = 1
    if patient and frappe.db.exists("Patient", patient):
        invoice.patient = patient

    for row in items:
        if not isinstance(row, dict):
            continue
        if not row.get("item_code"):
            continue
        qty = float(row.get("qty") or 0)
        if qty <= 0:
            continue
        line = {
            "item_code": row.get("item_code"),
            "item_name": row.get("item_name"),
            "description": row.get("description"),
            "qty": qty,
            "rate": float(row.get("rate") or 0),
            "cost_center": row.get("cost_center") or created_at_cost_center,
        }
        if row.get("uom"):
            line["uom"] = row.get("uom")
        invoice.append("items", line)

    if not invoice.items:
        frappe.throw(_("Please add at least one valid item"))

    from healthcare.api.sales_order_cost_center import finalize_sales_invoice_cost_centers

    finalize_sales_invoice_cost_centers(invoice, created_at_cost_center)
    from healthcare.api.receptionist_shift import stamp_receptionist_shift_on_doc

    stamp_receptionist_shift_on_doc(invoice)
    invoice.insert(ignore_permissions=True)
    return {"name": invoice.name, "customer": invoice.customer, "grand_total": invoice.grand_total}


@frappe.whitelist()
def list_dispatched_employee_medication(limit_start=0, limit_page_length=100):
    """POS employee medicine dispatches (SO + DN) awaiting internal employee invoice."""
    limit_start = int(limit_start or 0)
    limit_page_length = min(int(limit_page_length or 100), 500)

    if not frappe.db.has_column("Sales Order", "custom_internal_employee_dispensing"):
        return []

    rows = frappe.db.sql(
        """
        SELECT
            so.name,
            so.transaction_date,
            so.customer,
            so.customer_name,
            so.grand_total,
            so.company,
            so.status,
            so.cost_center
        FROM `tabSales Order` so
        WHERE so.docstatus = 1
          AND IFNULL(so.custom_is_pos, 0) = 1
          AND IFNULL(so.custom_internal_employee_dispensing, 0) = 1
          AND NOT EXISTS (
            SELECT 1
            FROM `tabSales Invoice Item` sii
            INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
            WHERE sii.sales_order = so.name
              AND si.docstatus != 2
          )
        ORDER BY so.creation DESC
        LIMIT %(limit)s OFFSET %(start)s
        """,
        {"start": limit_start, "limit": limit_page_length},
        as_dict=True,
    )

    for row in rows:
        cc = row.get("cost_center")
        row["collection_cost_center_name"] = (
            frappe.db.get_value("Cost Center", cc, "cost_center_name") if cc else None
        ) or cc
        row["employee_name"] = row.get("customer_name") or row.get("customer")
        dn = frappe.db.sql(
            """
            SELECT dn.name
            FROM `tabDelivery Note Item` dni
            INNER JOIN `tabDelivery Note` dn ON dn.name = dni.parent
            WHERE dni.against_sales_order = %s AND dn.docstatus = 1
            ORDER BY dn.creation DESC
            LIMIT 1
            """,
            row.name,
            as_dict=True,
        )
        row["delivery_note"] = dn[0].name if dn else None

    return rows


@frappe.whitelist()
def create_internal_employee_invoice_from_sales_order(sales_order_name):
    """Create draft internal-employee Sales Invoice from a dispatched POS sales order."""
    from healthcare.api.sales_order import _load_billable_sales_orders_by_names
    from healthcare.api.sales_order_cost_center import (
        apply_accounting_dimensions_from_sales_order_to_sales_invoice,
        cost_center_from_sales_order,
        finalize_sales_invoice_cost_centers,
        sales_invoice_item_from_sales_order_item,
    )

    sales_order_name = (sales_order_name or "").strip()
    if not sales_order_name:
        frappe.throw(_("Sales Order is required"))

    if not frappe.db.has_column("Sales Order", "custom_internal_employee_dispensing"):
        frappe.throw(_("Internal employee dispensing is not configured on Sales Order"))

    sales_orders = _load_billable_sales_orders_by_names([sales_order_name])
    so = sales_orders[0]

    if not int(getattr(so, "custom_internal_employee_dispensing", 0) or 0):
        frappe.throw(_("Sales Order {0} is not an internal employee dispensing order").format(sales_order_name))

    invoice = frappe.new_doc("Sales Invoice")
    invoice.customer = so.customer
    if so.company:
        invoice.company = so.company
    invoice.posting_date = nowdate()
    invoice.due_date = invoice.posting_date
    invoice.custom_internal_employee = 1
    if getattr(so, "patient", None) and frappe.db.exists("Patient", so.patient):
        invoice.patient = so.patient

    apply_accounting_dimensions_from_sales_order_to_sales_invoice(so, invoice)

    items_added = 0
    for item in so.items:
        line = sales_invoice_item_from_sales_order_item(so, item)
        if not line:
            continue
        invoice.append("items", line)
        items_added += 1

    if not items_added:
        frappe.throw(_("No items found on Sales Order {0}").format(sales_order_name))

    finalize_sales_invoice_cost_centers(invoice, cost_center_from_sales_order(so))
    from healthcare.api.receptionist_shift import stamp_receptionist_shift_on_doc

    stamp_receptionist_shift_on_doc(invoice)
    invoice.insert(ignore_permissions=True)
    return {
        "name": invoice.name,
        "customer": invoice.customer,
        "grand_total": invoice.grand_total,
        "sales_order": so.name,
    }


@frappe.whitelist()
def list_additional_collection_invoices(limit_start=0, limit_page_length=100):
    """Cross‑Branch Payment (cross–cost center): Created At cost center set; excludes internal employee."""
    limit_start = int(limit_start or 0)
    limit_page_length = min(int(limit_page_length or 100), 500)

    rows = frappe.db.sql(
        """
        SELECT
            name, docstatus, posting_date, customer, customer_name, grand_total,
            outstanding_amount, status, company, custom_created_at,
            custom_reference_type, custom_reference_name, patient
        FROM `tabSales Invoice`
        WHERE docstatus != 2
          AND IFNULL(custom_created_at, '') != ''
          AND IFNULL(custom_internal_employee, 0) = 0
        ORDER BY creation DESC
        LIMIT %(limit)s OFFSET %(start)s
        """,
        {"start": limit_start, "limit": limit_page_length},
        as_dict=True,
    )

    for r in rows:
        cc = r.get("custom_created_at")
        r["collection_cost_center_name"] = (
            frappe.db.get_value("Cost Center", cc, "cost_center_name") if cc else None
        ) or cc

    return rows


@frappe.whitelist()
def list_internal_employee_invoices(limit_start=0, limit_page_length=100):
    limit_start = int(limit_start or 0)
    limit_page_length = min(int(limit_page_length or 100), 500)

    rows = frappe.get_all(
        "Sales Invoice",
        filters={
            "docstatus": ["!=", 2],
            "custom_internal_employee": 1,
        },
        fields=[
            "name",
            "docstatus",
            "posting_date",
            "customer",
            "customer_name",
            "grand_total",
            "outstanding_amount",
            "status",
            "company",
            "custom_created_at",
            "patient",
        ],
        order_by="creation desc",
        limit_start=limit_start,
        limit_page_length=limit_page_length,
    )

    for r in rows:
        cc = r.get("custom_created_at")
        r["collection_cost_center_name"] = (
            frappe.db.get_value("Cost Center", cc, "cost_center_name") if cc else None
        ) or cc

    return rows


@frappe.whitelist()
def get_internal_employee_billing_summary():
    row = frappe.db.sql(
        """
        SELECT
            COUNT(*) AS invoice_count,
            COALESCE(SUM(grand_total), 0) AS total_billed,
            COALESCE(SUM(outstanding_amount), 0) AS total_outstanding
        FROM `tabSales Invoice`
        WHERE docstatus != 2
          AND IFNULL(custom_internal_employee, 0) = 1
        """,
        as_dict=True,
    )
    r = row[0] if row else {}
    return {
        "invoice_count": int(r.get("invoice_count") or 0),
        "total_billed": float(r.get("total_billed") or 0),
        "total_outstanding": float(r.get("total_outstanding") or 0),
    }