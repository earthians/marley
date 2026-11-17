import frappe
from frappe.utils import cint, today, getdate, flt

from healthcare.api.sales_order_cost_center import (
	apply_cost_center_to_sales_order,
	apply_cost_center_to_sales_invoice,
	apply_sales_order_document_discount,
	cost_center_from_base_reference,
	cost_center_from_sales_order,
	cost_center_from_visit_or_admission,
	sales_invoice_item_from_sales_order_item,
)

@frappe.whitelist()
def get_service_orders(
    reference_type=None,  # 'Patient Visit' or 'Inpatient Admission'
    reference_name=None,   # specific visit or admission ID
    patient=None,
    status=None,
    from_date=None,
    to_date=None,
    search=None,
    limit=50,
    offset=0
):
    """Get list of Sales Orders for services"""
    from healthcare.api.billing_search import billing_search_or_filters

    filters = {}
    search_term = (search or "").strip()
    or_filters = billing_search_or_filters(search_term, patient) if search_term else None

    if not search_term and reference_name:
        if reference_type:
            filters['custom_reference_type'] = reference_type
        filters['custom_reference_name'] = reference_name
    if patient:
        filters['patient'] = patient
    if status:
        filters['status'] = status
    if from_date and to_date:
        filters['transaction_date'] = ['between', [from_date, to_date]]
    elif from_date:
        filters['transaction_date'] = ['>=', from_date]
    elif to_date:
        filters['transaction_date'] = ['<=', to_date]

    # Get permitted cost centers
    from healthcare.api.common import get_permitted_cost_centers
    permitted_cc = get_permitted_cost_centers()
    if permitted_cc is not None:
        if not permitted_cc:
            return []
        filters['cost_center'] = ['in', permitted_cc]
    
    list_kwargs = dict(
        doctype='Sales Order',
        filters=filters,
        fields=[
            'name',
            'customer',
            'customer_name',
            'transaction_date',
            'status',
            'grand_total',
            'total',
            'custom_reference_type',
            'custom_reference_name',
            'custom_base_reference',
            'custom_base_reference_name',
            'patient',
            'patient_name',
            'docstatus',
            'cost_center',
        ],
        limit=limit,
        limit_start=offset,
        order_by='transaction_date desc, creation desc',
    )
    if or_filters:
        list_kwargs['or_filters'] = or_filters
    sales_orders = frappe.get_all(**list_kwargs)

    if patient and reference_name and not search_term:
        from healthcare.api.patient_file_no_charge import file_no_charge_sales_orders_for_list

        extra_rows = file_no_charge_sales_orders_for_list(patient)
        seen = {row.name for row in sales_orders}
        for row in extra_rows:
            row_name = row.get("name")
            if row_name and row_name not in seen:
                sales_orders.append(frappe._dict(row))
                seen.add(row_name)

    from healthcare.controllers.sales_order import ensure_service_sales_order_status

    # Check if invoice exists for each sales order (partial = still billable).
    # Service-only SOs stuck on "To Deliver" get skip_delivery_note + status refresh.
    for so in sales_orders:
        if so.get("status") in ("To Deliver", "To Deliver and Bill") and cint(so.get("docstatus")) == 1:
            fixed = ensure_service_sales_order_status(so.name)
            if fixed:
                so.status = fixed
        _apply_sales_order_invoice_status(so)

    cc_keys = list({so.get('cost_center') for so in sales_orders if so.get('cost_center')})
    cc_labels = {}
    if cc_keys:
        for row in frappe.get_all('Cost Center', filters={'name': ['in', cc_keys]}, fields=['name', 'cost_center_name']):
            cc_labels[row.name] = row.cost_center_name or row.name
    for so in sales_orders:
        cc = so.get('cost_center')
        so['cost_center_name'] = cc_labels.get(cc) if cc else ''

    from healthcare.api.pos_dispense_return import enrich_sales_order_billable_fields

    for so in sales_orders:
        enrich_sales_order_billable_fields(so)

    from healthcare.api.billing import _attach_sales_order_items

    _attach_sales_order_items(sales_orders)

    return sales_orders


@frappe.whitelist()
def get_service_order_summary(reference_type=None, reference_name=None, patient=None, from_date=None, to_date=None, search=None):
    """Get summary of orders for a reference"""
    from healthcare.api.billing_search import billing_search_or_filters

    filters = {}
    search_term = (search or "").strip()
    or_filters = billing_search_or_filters(search_term, patient) if search_term else None

    if not search_term and reference_name:
        if reference_type:
            filters['custom_reference_type'] = reference_type
        filters['custom_reference_name'] = reference_name
    if patient:
        filters['patient'] = patient
    if from_date and to_date:
        filters['transaction_date'] = ['between', [from_date, to_date]]
    elif from_date:
        filters['transaction_date'] = ['>=', from_date]
    elif to_date:
        filters['transaction_date'] = ['<=', to_date]

    from healthcare.api.common import get_permitted_cost_centers
    permitted_cc = get_permitted_cost_centers()
    if permitted_cc is not None:
        if not permitted_cc:
            return {
                'total_orders': 0,
                'total_amount': 0,
                'draft': {'count': 0, 'amount': 0},
                'submitted': {'count': 0, 'amount': 0},
                'cancelled': {'count': 0, 'amount': 0},
                'invoiced': {'count': 0, 'amount': 0},
                'partially_invoiced': {'count': 0, 'amount': 0},
                'not_invoiced': {'count': 0, 'amount': 0},
            }
        filters['cost_center'] = ['in', permitted_cc]

    summary_kwargs = dict(
        doctype='Sales Order',
        filters=filters,
        fields=['name', 'status', 'grand_total'],
    )
    if or_filters:
        summary_kwargs['or_filters'] = or_filters
    sales_orders = frappe.get_all(**summary_kwargs)

    if patient and reference_name and not search_term:
        from healthcare.api.patient_file_no_charge import file_no_charge_sales_orders_for_list

        seen = {so.name for so in sales_orders}
        for row in file_no_charge_sales_orders_for_list(patient):
            if row.get("name") not in seen:
                sales_orders.append(
                    frappe._dict(
                        name=row["name"],
                        status=row["status"],
                        grand_total=row["grand_total"],
                    )
                )
                seen.add(row["name"])
    
    summary = {
        'total_orders': len(sales_orders),
        'total_amount': 0,
        'draft': {'count': 0, 'amount': 0},
        'submitted': {'count': 0, 'amount': 0},
        'cancelled': {'count': 0, 'amount': 0},
        'invoiced': {'count': 0, 'amount': 0},
        'partially_invoiced': {'count': 0, 'amount': 0},
        'not_invoiced': {'count': 0, 'amount': 0}
    }

    from healthcare.api.pos_dispense_return import enrich_sales_order_billable_fields

    def _summary_amount(so_row):
        enrich_sales_order_billable_fields(so_row)
        if so_row.get("billable_grand_total") is not None:
            return flt(so_row.get("billable_grand_total") or 0)
        return flt(so_row.grand_total or 0)
    
    for so in sales_orders:
        order_amount = _summary_amount(so)
        summary['total_amount'] += order_amount
        links = _sales_order_invoice_links(so.name)
        remaining = _sales_order_has_remaining_to_invoice(so.name)

        if links and not remaining:
            invoice_status = links[0].status
            if invoice_status == 'Paid':
                summary['invoiced']['count'] += 1
                summary['invoiced']['amount'] += order_amount
            elif invoice_status in ['Unpaid', 'Overdue', 'Partially Paid']:
                summary['partially_invoiced']['count'] += 1
                summary['partially_invoiced']['amount'] += order_amount
            else:
                summary['partially_invoiced']['count'] += 1
                summary['partially_invoiced']['amount'] += order_amount
        elif links and remaining:
            summary['partially_invoiced']['count'] += 1
            summary['partially_invoiced']['amount'] += order_amount
        else:
            if order_amount <= 0:
                continue
            summary['not_invoiced']['count'] += 1
            summary['not_invoiced']['amount'] += order_amount
        
        # Status from sales order
        if so.status == 'Draft':
            summary['draft']['count'] += 1
            summary['draft']['amount'] += order_amount
        elif so.status == 'To Bill':
            summary['submitted']['count'] += 1
            summary['submitted']['amount'] += order_amount
    
    return summary


# @frappe.whitelist()
# def create_bulk_invoice(reference_type, reference_name):
#     """Create a single invoice for all orders under a reference"""
#     # Get all sales orders for this reference
#     sales_orders = frappe.get_all(
#         'Sales Order',
#         filters={
#             'custom_reference_type': reference_type,
#             'custom_reference_name': reference_name,
#             'status': ['in', ['To Bill', 'Draft']],
#             'docstatus': 1  # Submitted
#         },
#         fields=['name', 'customer', 'grand_total']
#     )
    
#     if not sales_orders:
#         frappe.throw("No orders found to invoice")
    
#     # Get customer from first order
#     customer = sales_orders[0].customer
    
#     # Create Sales Invoice
#     invoice = frappe.new_doc('Sales Invoice')
#     invoice.customer = customer
#     invoice.custom_reference_type = reference_type
#     invoice.custom_reference_name = reference_name
#     invoice.posting_date = today()
    
#     # Add items from each sales order
#     for so in sales_orders:
#         # Get items from sales order
#         so_items = frappe.get_all(
#             'Sales Order Item',
#             filters={'parent': so.name},
#             fields=['item_code', 'qty', 'rate', 'amount', 'description']
#         )
        
#         for item in so_items:
#             invoice.append('items', {
#                 'item_code': item.item_code,
#                 'qty': item.qty,
#                 'rate': item.rate,
#                 'amount': item.amount,
#                 'description': item.description,
#                 'sales_order': so.name
#             })
    
#     invoice.save()
#     frappe.db.commit()
    
#     return invoice.name

def _sales_order_has_billable_qty(sales_order_name, so_doc=None):
	from healthcare.api.pos_dispense_return import sales_order_has_billable_qty

	so = so_doc or frappe.get_doc("Sales Order", sales_order_name)
	return sales_order_has_billable_qty(so) or bool(
		_uninvoiced_delivery_notes_for_sales_orders([so.name])
	)


def _delivery_note_rows_for_sales_orders(so_names: list[str]) -> list[dict]:
	"""Submitted non-return Delivery Note lines linked to the given Sales Orders."""
	names = [n for n in (so_names or []) if n]
	if not names:
		return []
	return frappe.db.sql(
		"""
		SELECT
			dn.name AS delivery_note,
			dni.name AS dn_detail,
			dni.so_detail,
			dni.against_sales_order AS sales_order,
			dni.item_code,
			dni.qty,
			dni.billed_amt
		FROM `tabDelivery Note` dn
		INNER JOIN `tabDelivery Note Item` dni ON dni.parent = dn.name
		WHERE dni.against_sales_order IN %(sos)s
		  AND dn.docstatus = 1
		  AND IFNULL(dn.is_return, 0) = 0
		ORDER BY dn.creation ASC, dni.idx ASC
		""",
		{"sos": names},
		as_dict=True,
	)


def _so_details_covered_by_delivery_note(so_names: list[str]) -> set[str]:
	"""Sales Order Item names that already have a Delivery Note (bill via DN, not SO)."""
	return {
		row.so_detail
		for row in _delivery_note_rows_for_sales_orders(so_names)
		if row.get("so_detail")
	}


def _dn_has_pending_invoice_qty(delivery_note: str) -> bool:
	"""True when the Delivery Note still has qty left to invoice (ignores cancelled SI)."""
	try:
		from erpnext.stock.doctype.delivery_note.delivery_note import (
			get_invoiced_qty_map,
			get_returned_qty_map,
		)
	except ImportError:
		return not frappe.db.exists(
			"Sales Invoice Item",
			{"delivery_note": delivery_note, "docstatus": ["<", 2]},
		)

	dn = frappe.get_doc("Delivery Note", delivery_note)
	# Include draft invoices so bulk create does not duplicate open SI drafts
	draft_or_submitted = frappe.db.sql(
		"""
		SELECT dn_detail, SUM(qty) AS qty
		FROM `tabSales Invoice Item`
		WHERE delivery_note = %s AND docstatus < 2
		GROUP BY dn_detail
		""",
		delivery_note,
		as_dict=True,
	)
	invoiced_qty_map = {r.dn_detail: flt(r.qty) for r in draft_or_submitted if r.dn_detail}
	if not invoiced_qty_map:
		invoiced_qty_map = get_invoiced_qty_map(delivery_note)

	returned_qty_map = get_returned_qty_map(delivery_note)
	for item in dn.items:
		pending = flt(item.qty) - flt(invoiced_qty_map.get(item.name, 0))
		returned = flt(returned_qty_map.get(item.name, 0))
		if returned > 0:
			pending = max(0, pending - returned)
		if pending > 0:
			return True
	return False


def _uninvoiced_delivery_notes_for_sales_orders(so_names: list[str]) -> list[str]:
	seen = []
	for row in _delivery_note_rows_for_sales_orders(so_names):
		dn = row.delivery_note
		if dn in seen:
			continue
		if _dn_has_pending_invoice_qty(dn):
			seen.append(dn)
	return seen


def _submitted_si_qty_by_so_detail(so_name: str) -> dict[str, float]:
	"""Qty already on submitted Sales Invoices for each Sales Order Item row."""
	rows = frappe.db.sql(
		"""
		SELECT sii.so_detail AS so_detail, SUM(sii.qty) AS qty
		FROM `tabSales Invoice Item` sii
		INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
		WHERE sii.sales_order = %s
		  AND si.docstatus = 1
		  AND IFNULL(si.is_return, 0) = 0
		  AND IFNULL(sii.so_detail, '') != ''
		GROUP BY sii.so_detail
		""",
		so_name,
		as_dict=True,
	)
	return {r.so_detail: flt(r.qty) for r in rows if r.so_detail}


def _sales_order_invoice_links(so_name: str) -> list[dict]:
	"""Submitted/draft Sales Invoices linked to this Sales Order (via SI Item.sales_order)."""
	return frappe.db.sql(
		"""
		SELECT DISTINCT
			si.name,
			si.status,
			si.docstatus,
			si.outstanding_amount,
			si.grand_total,
			si.creation
		FROM `tabSales Invoice Item` sii
		INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
		WHERE sii.sales_order = %s
		  AND si.docstatus < 2
		ORDER BY si.creation DESC
		""",
		so_name,
		as_dict=True,
	)


def _apply_sales_order_invoice_status(so) -> None:
	"""Set invoice_name / invoice_status on a Sales Order list row."""
	links = _sales_order_invoice_links(so.name)
	remaining = _sales_order_has_remaining_to_invoice(so.name)

	if not links:
		so.invoice_status = "Not Created"
		so.invoice_name = None
		so.invoice_amount = 0
		return

	primary = links[0]
	so.invoice_name = primary.name
	so.invoice_amount = flt(primary.grand_total)

	if not remaining:
		so.invoice_status = primary.status or "Invoiced"
		so.invoice_date = frappe.db.get_value("Sales Invoice", primary.name, "posting_date")
		return

	# Linked invoice(s) exist but something still open — still expose the invoice id
	so.invoice_status = "Partial"
	so.partial_invoice_name = primary.name


def _sales_order_has_remaining_to_invoice(so) -> bool:
	"""True if services remain on the SO and/or linked DNs still need invoicing."""
	so_name = so.name if hasattr(so, "name") else so
	doc = so if hasattr(so, "items") else frappe.get_doc("Sales Order", so_name)
	dn_covered = _so_details_covered_by_delivery_note([doc.name])
	from healthcare.api.pos_dispense_return import (
		get_returned_qty_for_so_item,
		is_pos_dispense_sales_order,
	)

	si_qty = _submitted_si_qty_by_so_detail(doc.name)
	for item in doc.items:
		if item.name in dn_covered:
			# Stock lines are billed via Delivery Note invoice, not SO lines
			continue
		sold = flt(item.qty)
		if sold <= 0:
			continue
		if is_pos_dispense_sales_order(doc):
			sold = max(0, sold - get_returned_qty_for_so_item(doc, item))
		invoiced = max(flt(getattr(item, "billed_qty", None) or 0), flt(si_qty.get(item.name) or 0))
		if sold - invoiced > 0.0005:
			return True
	return bool(_uninvoiced_delivery_notes_for_sales_orders([doc.name]))


def _load_billable_sales_orders_by_names(names):
	"""Return submitted Sales Order docs that still have invoiceable SO or DN qty."""
	import json

	if isinstance(names, str):
		names = json.loads(names) if names.strip().startswith("[") else [names]
	if not names:
		frappe.throw(frappe._("Select at least one sales order to invoice."))

	from healthcare.api.common import get_permitted_cost_centers

	permitted_cc = get_permitted_cost_centers()
	docs = []
	customer = None

	for name in names:
		name = (name or "").strip()
		if not name:
			continue
		if not frappe.db.exists("Sales Order", name):
			frappe.throw(frappe._("Sales Order {0} not found").format(name))

		so = frappe.get_doc("Sales Order", name)
		if so.docstatus != 1:
			frappe.throw(
				frappe._("Sales Order {0} must be submitted before invoicing.").format(name)
			)

		if permitted_cc is not None:
			if not permitted_cc:
				frappe.throw(frappe._("You do not have permission to bill these orders."))
			if so.cost_center and so.cost_center not in permitted_cc:
				frappe.throw(
					frappe._("You do not have permission for the cost center on {0}.").format(name)
				)

		if customer and so.customer != customer:
			frappe.throw(frappe._("All selected orders must belong to the same customer."))
		customer = so.customer
		if not _sales_order_has_remaining_to_invoice(so):
			frappe.throw(
				frappe._(
					"Sales Order {0} has nothing left to invoice (services and delivery notes are fully billed or returned)."
				).format(name)
			)
		docs.append(so)

	if not docs:
		frappe.throw(frappe._("Select at least one sales order to invoice."))
	return docs


def close_all_cost_before_patient_transfer_enabled() -> bool:
	return cint(
		frappe.db.get_single_value(
			"Healthcare Settings", "close_all_cost_before_patient_transfer"
		)
	)


def _group_sales_orders_by_cost_center(sales_orders):
	groups: dict[str, list] = {}
	for so in sales_orders:
		cc = cost_center_from_sales_order(so) or ""
		groups.setdefault(cc, []).append(so)
	return groups


def _create_invoices_from_sales_orders_by_cost_center(
	sales_orders,
	reference_type=None,
	reference_name=None,
	patient=None,
):
	"""Create invoice(s) per cost center, each group split SO services vs DN stock."""
	invoices = []
	for cc, group in _group_sales_orders_by_cost_center(sales_orders).items():
		created = _create_invoices_from_sales_orders(
			group,
			reference_type=reference_type,
			reference_name=reference_name,
			patient=patient,
		)
		for row in created:
			row = dict(row)
			row["cost_center"] = cc or None
			invoices.append(row)
	return invoices


def _normalize_invoice_result(details: list[dict]):
	"""Return a single invoice name, or a split payload for the frontend."""
	if not details:
		frappe.throw(frappe._("No invoices were created."))
	if len(details) == 1:
		return details[0]["invoice"]
	return {
		"split_by_fulfillment": True,
		"split_by_cost_center": any(d.get("cost_center") for d in details),
		"invoices": [row["invoice"] for row in details],
		"details": details,
	}


def _invoice_sales_orders(
	sales_orders,
	reference_type=None,
	reference_name=None,
	patient=None,
):
	"""Create invoice(s): all service SO lines on one invoice; stock from Delivery Note.

	When Close All Cost Before Patient Transfer is on, service invoices are still
	split by cost center.
	"""
	if not sales_orders:
		frappe.throw(frappe._("Select at least one sales order to invoice."))

	if close_all_cost_before_patient_transfer_enabled():
		details = _create_invoices_from_sales_orders_by_cost_center(
			sales_orders,
			reference_type=reference_type,
			reference_name=reference_name,
			patient=patient,
		)
		return _normalize_invoice_result(details)

	details = _create_invoices_from_sales_orders(
		sales_orders,
		reference_type=reference_type,
		reference_name=reference_name,
		patient=patient,
	)
	return _normalize_invoice_result(details)


def _pending_billable_sales_order_names(
	reference_type=None,
	reference_name=None,
	patient=None,
):
	"""Submitted Sales Order names that still have SO or DN qty to invoice."""
	names: list[str] = []

	if reference_type and reference_name:
		filters = {
			"custom_reference_type": reference_type,
			"custom_reference_name": reference_name,
			"docstatus": 1,
		}
		from healthcare.api.common import get_permitted_cost_centers

		permitted_cc = get_permitted_cost_centers()
		if permitted_cc is not None:
			if not permitted_cc:
				return []
			filters["cost_center"] = ["in", permitted_cc]

		for row in frappe.get_all("Sales Order", filters=filters, fields=["name"]):
			so = frappe.get_doc("Sales Order", row.name)
			if _sales_order_has_remaining_to_invoice(so):
				names.append(row.name)

	if patient:
		from healthcare.api.patient_file_no_charge import pending_file_no_charge_sales_orders

		for name in pending_file_no_charge_sales_orders(patient):
			if name not in names:
				names.append(name)

	return names


def close_pending_costs_for_admission(inpatient_admission: str) -> dict:
	"""Invoice pending admission sales orders before a cost-center transfer (when setting enabled)."""
	if not close_all_cost_before_patient_transfer_enabled():
		return {"skipped": True, "invoices": [], "details": []}

	if not inpatient_admission or not frappe.db.exists("Inpatient Admission", inpatient_admission):
		frappe.throw(frappe._("Inpatient Admission not found"))

	patient = frappe.db.get_value("Inpatient Admission", inpatient_admission, "patient")
	names = _pending_billable_sales_order_names(
		"Inpatient Admission",
		inpatient_admission,
		patient=patient,
	)
	if not names:
		return {"skipped": False, "invoices": [], "details": [], "message": "No pending sales orders"}

	sales_orders = _load_billable_sales_orders_by_names(names)
	result = _invoice_sales_orders(
		sales_orders,
		reference_type="Inpatient Admission",
		reference_name=inpatient_admission,
		patient=patient,
	)

	if isinstance(result, str):
		return {
			"skipped": False,
			"invoices": [result],
			"details": [{"invoice": result, "cost_center": None}],
		}

	return {
		"skipped": False,
		"invoices": result.get("invoices") or [],
		"details": result.get("details") or [],
		"split_by_cost_center": bool(result.get("split_by_cost_center")),
		"split_by_fulfillment": bool(result.get("split_by_fulfillment")),
	}


def _apply_invoice_healthcare_refs(invoice, ref_type, ref_name, patient, company=None, customer=None):
	if customer and not invoice.customer:
		invoice.customer = customer
	if company and not invoice.company:
		invoice.company = company
	if ref_type and invoice.meta.has_field("custom_reference_type"):
		invoice.custom_reference_type = ref_type
	if ref_name and invoice.meta.has_field("custom_reference_name"):
		invoice.custom_reference_name = ref_name
		if ref_type and invoice.meta.has_field("custom_base_reference"):
			invoice.custom_base_reference = ref_type
		if invoice.meta.has_field("custom_base_reference_name"):
			invoice.custom_base_reference_name = ref_name
	if patient and invoice.meta.has_field("patient"):
		invoice.patient = patient
	invoice.ignore_pricing_rule = 1
	if not invoice.posting_date:
		invoice.posting_date = today()
	if not invoice.due_date:
		invoice.due_date = frappe.utils.add_days(today(), 30)


def _sync_invoice_uom_from_previous_docs(invoice) -> None:
	from healthcare.api.sales_order_cost_center import sync_sales_invoice_uom_from_previous_docs

	sync_sales_invoice_uom_from_previous_docs(invoice)


def _finalize_and_save_invoice(invoice, header_cc=None, ref_type=None, ref_name=None):
	from healthcare.api.receptionist_shift import stamp_receptionist_shift_on_doc
	from healthcare.api.sales_order_cost_center import (
		finalize_sales_invoice_cost_centers,
		set_missing_values_ignoring_permissions,
	)

	# Party resolution must not fail on Customer.custom_employee User Permissions.
	invoice.flags.ignore_permissions = True

	cc = header_cc
	if not cc and ref_type and ref_name:
		cc = cost_center_from_visit_or_admission(ref_type, ref_name)

	if cc:
		finalize_sales_invoice_cost_centers(invoice, cc)
	else:
		set_missing_values_ignoring_permissions(invoice)

	stamp_receptionist_shift_on_doc(invoice)
	_sync_invoice_uom_from_previous_docs(invoice)

	# Re-apply after ERPNext validate/set_missing_item_details may reset UOM factors
	_orig_validate_with_previous = invoice.validate_with_previous_doc

	def _validate_with_previous_preserving_uom(*args, **kwargs):
		_sync_invoice_uom_from_previous_docs(invoice)
		return _orig_validate_with_previous(*args, **kwargs)

	invoice.validate_with_previous_doc = _validate_with_previous_preserving_uom

	invoice.flags.ignore_permissions = True
	# save() → insert() drops the kwarg; call insert explicitly for new docs.
	if invoice.get("__islocal") or not invoice.get("name"):
		invoice.insert(ignore_permissions=True)
	else:
		invoice.save(ignore_permissions=True)
	return invoice.name


def _create_delivery_note_invoice(
	delivery_notes: list[str],
	*,
	reference_type=None,
	reference_name=None,
	patient=None,
	customer=None,
	company=None,
	header_cc=None,
):
	"""One Sales Invoice mapped from one or more Delivery Notes (stock / pharmacy)."""
	from erpnext.stock.doctype.delivery_note.delivery_note import make_sales_invoice as make_si_from_dn

	# make_sales_invoice runs set_missing_values (Customer has_permission) before save —
	# seed the target with ignore_permissions so EMP-linked Customers still map.
	target = frappe.new_doc("Sales Invoice")
	target.flags.ignore_permissions = True
	for dn_name in delivery_notes:
		try:
			target = make_si_from_dn(dn_name, target_doc=target)
			target.flags.ignore_permissions = True
		except Exception:
			frappe.log_error(title=f"DN→SI map failed: {dn_name}")
			raise

	if not target or not target.get("items"):
		return None

	_apply_invoice_healthcare_refs(
		target,
		reference_type,
		reference_name,
		patient,
		company=company,
		customer=customer,
	)
	# Stock already moved on DN — never update stock again on this invoice
	if target.meta.has_field("update_stock"):
		target.update_stock = 0

	name = _finalize_and_save_invoice(
		target, header_cc=header_cc, ref_type=reference_type, ref_name=reference_name
	)
	return {
		"invoice": name,
		"source": "delivery_note",
		"delivery_notes": list(delivery_notes),
	}


def _create_service_sales_order_invoice(
	sales_orders,
	*,
	skip_so_details: set[str],
	reference_type=None,
	reference_name=None,
	patient=None,
):
	"""Sales Invoice for SO lines that were not fulfilled via Delivery Note."""
	first = sales_orders[0]
	ref_type = reference_type or first.custom_reference_type
	ref_name = reference_name or first.custom_reference_name
	pt = patient or getattr(first, "patient", None)

	invoice = frappe.new_doc("Sales Invoice")
	_apply_invoice_healthcare_refs(
		invoice,
		ref_type,
		ref_name,
		pt,
		company=getattr(first, "company", None),
		customer=first.customer,
	)

	items_added = 0
	header_cc = None
	for so in sales_orders:
		so_cc = cost_center_from_sales_order(so)
		if not header_cc and so_cc:
			header_cc = so_cc
		for item in so.items:
			if item.name in skip_so_details:
				continue
			line = sales_invoice_item_from_sales_order_item(so, item)
			if not line:
				continue
			invoice.append("items", line)
			items_added += 1

	if items_added == 0:
		return None

	# Order header discount (e.g. 10% package discount) must reach the invoice
	apply_sales_order_document_discount(invoice, sales_orders)

	name = _finalize_and_save_invoice(
		invoice, header_cc=header_cc, ref_type=ref_type, ref_name=ref_name
	)
	return {
		"invoice": name,
		"source": "sales_order",
		"sales_orders": [so.name for so in sales_orders],
	}


def _group_sales_orders_by_customer_company(sales_orders):
	groups: dict[tuple[str, str], list] = {}
	for so in sales_orders:
		key = (so.customer or "", getattr(so, "company", None) or "")
		groups.setdefault(key, []).append(so)
	return groups


def _create_invoices_from_sales_orders(sales_orders, reference_type=None, reference_name=None, patient=None):
	"""Create invoices: one service SI for all service SO lines; stock via DN.

	Multiple service Sales Orders (room stay charges, labs, etc.) share one invoice
	with one line per SO item. Delivery Notes stay on a separate stock invoice.
	Orders with different customer/company are still invoiced separately.
	"""
	if not sales_orders:
		frappe.throw(frappe._("Select at least one sales order to invoice."))

	created: list[dict] = []
	for group in _group_sales_orders_by_customer_company(sales_orders).values():
		created.extend(
			_create_invoices_for_sales_order_group(
				group,
				reference_type=reference_type,
				reference_name=reference_name,
				patient=patient,
			)
		)

	if not created:
		frappe.throw(
			frappe._(
				"No items found to invoice. Stock lines need an uninvoiced Delivery Note; "
				"service lines need remaining unbilled quantity on the Sales Order."
			)
		)

	frappe.db.commit()
	return created


def _create_invoices_for_sales_order_group(sales_orders, reference_type=None, reference_name=None, patient=None):
	"""One DN invoice and/or one service invoice for a customer/company group."""
	so_names = [so.name for so in sales_orders]
	first = sales_orders[0]
	ref_type = reference_type or first.custom_reference_type
	ref_name = reference_name or first.custom_reference_name
	pt = patient or getattr(first, "patient", None)
	header_cc = None
	for so in sales_orders:
		so_cc = cost_center_from_sales_order(so)
		if so_cc:
			header_cc = so_cc
			break

	dn_covered = _so_details_covered_by_delivery_note(so_names)
	pending_dns = _uninvoiced_delivery_notes_for_sales_orders(so_names)

	created: list[dict] = []

	if pending_dns:
		dn_row = _create_delivery_note_invoice(
			pending_dns,
			reference_type=ref_type,
			reference_name=ref_name,
			patient=pt,
			customer=first.customer,
			company=getattr(first, "company", None),
			header_cc=header_cc,
		)
		if dn_row:
			dn_row["sales_orders"] = so_names
			created.append(dn_row)

	service_row = _create_service_sales_order_invoice(
		sales_orders,
		skip_so_details=dn_covered,
		reference_type=ref_type,
		reference_name=ref_name,
		patient=pt,
	)
	if service_row:
		created.append(service_row)

	if created:
		from healthcare.controllers.sales_order import ensure_service_sales_order_status

		for so in sales_orders:
			ensure_service_sales_order_status(so_name=so.name)

	return created


def _create_invoices_for_one_sales_order(so, reference_type=None, reference_name=None, patient=None):
	"""DN invoice and/or service invoice for a single Sales Order."""
	return _create_invoices_for_sales_order_group(
		[so],
		reference_type=reference_type,
		reference_name=reference_name,
		patient=patient,
	)


# Backwards-compatible alias used by older callers expecting a single invoice name
def _create_invoice_from_sales_orders(sales_orders, reference_type=None, reference_name=None, patient=None):
	details = _create_invoices_from_sales_orders(
		sales_orders,
		reference_type=reference_type,
		reference_name=reference_name,
		patient=patient,
	)
	result = _normalize_invoice_result(details)
	if isinstance(result, str):
		return result
	# Callers that expect a string only will break — prefer returning the first
	# when used as legacy; _invoice_sales_orders uses _create_invoices_* instead.
	return result["invoices"][0]


@frappe.whitelist()
def create_bulk_invoice(reference_type=None, reference_name=None, sales_order_names=None, patient=None):
	"""Create a single invoice from selected sales orders or all billable orders on a reference."""
	import json

	if isinstance(sales_order_names, str):
		try:
			sales_order_names = json.loads(sales_order_names)
		except json.JSONDecodeError:
			sales_order_names = [sales_order_names]

	if sales_order_names:
		sales_orders = _load_billable_sales_orders_by_names(sales_order_names)
		return _invoice_sales_orders(
			sales_orders,
			reference_type=reference_type,
			reference_name=reference_name,
			patient=patient,
		)

	if reference_type and reference_name:
		names = _pending_billable_sales_order_names(
			reference_type,
			reference_name,
			patient=patient,
		)

		if not names:
			all_orders = frappe.get_all(
				"Sales Order",
				filters={
					"custom_reference_type": reference_type,
					"custom_reference_name": reference_name,
				},
				fields=["name", "docstatus"],
			)
			if all_orders:
				draft_count = sum(1 for o in all_orders if o.docstatus == 0)
				frappe.throw(
					frappe._(
						"No billable orders found. Found {0} order(s); {1} are still draft or already invoiced."
					).format(len(all_orders), draft_count)
				)
			frappe.throw(
				frappe._("No orders found for {0}: {1}").format(reference_type, reference_name)
			)

		sales_orders = _load_billable_sales_orders_by_names(names)
		return _invoice_sales_orders(
			sales_orders,
			reference_type=reference_type,
			reference_name=reference_name,
			patient=patient,
		)

	if patient:
		names = _pending_billable_sales_order_names(patient=patient)
		if not names:
			frappe.throw(frappe._("No pending sales orders found for patient {0}.").format(patient))
		sales_orders = _load_billable_sales_orders_by_names(names)
		return _invoice_sales_orders(
			sales_orders,
			reference_type="Patient",
			reference_name=patient,
			patient=patient,
		)

	frappe.throw(
		frappe._("Select at least one sales order to invoice, or choose a patient visit / admission.")
	)


@frappe.whitelist()
def create_service_order(data):
    """Create a new service sales order.

    Expected mapping (same as Sales Invoice):
    - reference_type / reference_name: ``Patient Visit`` or ``Inpatient Admission`` and the document name.
    - base_reference / base_reference_name: underlying doc (e.g. ``Lab Test``, ``Service Request``,
      ``Patient Medication Order``, ``Inpatient Healthcare Service``) and its name.
    """
    import json

    if isinstance(data, str):
        data = json.loads(data)

    ref_type = data.get('reference_type')
    if ref_type and ref_type not in ('Patient Visit', 'Inpatient Admission'):
        frappe.throw(frappe._('reference_type must be Patient Visit or Inpatient Admission'))

    so = frappe.new_doc('Sales Order')
    so.customer = data.get('customer')
    so.patient = data.get('patient')
    so.patient_name = data.get('patient_name')
    so.custom_reference_type = ref_type
    so.custom_reference_name = data.get('reference_name')
    so.custom_base_reference = data.get('base_reference')
    so.custom_base_reference_name = data.get('base_reference_name')
    so.transaction_date = data.get('transaction_date', today())
    # Service orders have nothing physical to deliver (validate also enforces this).
    so.skip_delivery_note = 1

    # Add items
    for item in data.get('items', []):
        so.append('items', {
            'item_code': item.get('item_code'),
            'item_name': item.get('item_name'),
            'description': item.get('description'),
            'qty': item.get('qty', 1),
            'rate': item.get('rate'),
            'amount': item.get('qty', 1) * item.get('rate', 0)
        })

    cc = data.get('cost_center')
    if not cc:
        cc = cost_center_from_base_reference(
            data.get('base_reference'), data.get('base_reference_name')
        )
    if not cc and ref_type:
        cc = cost_center_from_visit_or_admission(ref_type, data.get('reference_name'))
    apply_cost_center_to_sales_order(so, cc)

    so.save()
    frappe.db.commit()

    return so.name


# Add to healthcare/api/service_orders.py
