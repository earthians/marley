import frappe
from frappe import _
from frappe.utils import cint, flt


# Fixed to 3 dp (BHD fils). All payment amounts are normalized here so float
# noise from the UI never trips "allocated > paid" checks.
MONEY_PRECISION = 3


def _money(amount) -> float:
	"""Force money to exactly 3 decimal places."""
	return flt(amount, MONEY_PRECISION)


def _money_gt(a, b) -> bool:
	return _money(a) > _money(b)


def _new_payment_group_identity() -> str:
	"""Shared id stamped on every Payment Entry created from one multi-mode submit."""
	return f"PEGRP-{frappe.generate_hash(length=12).upper()}"


def _apply_unique_identity(pe, identity: str | None) -> None:
	if not identity:
		return
	if pe.meta.has_field("custom_unique_identity"):
		pe.custom_unique_identity = identity


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _payment_search_cost_center_filter(filters: dict) -> bool:
	"""Apply portal cost-center scope. Returns False when user has CC perm but none allowed."""
	from healthcare.api.common import get_permitted_cost_centers

	permitted_cc = get_permitted_cost_centers()
	if permitted_cc is None:
		return True
	if not permitted_cc:
		return False
	filters["cost_center"] = ["in", permitted_cc]
	return True


def _format_invoice_payment_label(row: dict) -> str:
	parts = [row.get("name") or ""]
	if row.get("custom_reference_name"):
		ref = row.get("custom_reference_name")
		ref_type = row.get("custom_reference_type") or "Case"
		parts.append(f"{ref_type}: {ref}")
	if row.get("customer_name"):
		parts.append(row["customer_name"])
	if row.get("patient_name"):
		parts.append(row["patient_name"])
	outstanding = flt(row.get("outstanding_amount"))
	if outstanding:
		parts.append(f"Outstanding {outstanding:.3f}")
	return " · ".join(p for p in parts if p)


def _format_order_payment_label(row: dict) -> str:
	parts = [row.get("name") or ""]
	if row.get("custom_reference_name"):
		ref = row.get("custom_reference_name")
		ref_type = row.get("custom_reference_type") or "Case"
		parts.append(f"{ref_type}: {ref}")
	if row.get("customer_name"):
		parts.append(row["customer_name"])
	if row.get("patient_name"):
		parts.append(row["patient_name"])
	grand = flt(row.get("grand_total"))
	if grand:
		parts.append(f"Total {grand:.3f}")
	return " · ".join(p for p in parts if p)


@frappe.whitelist()
def search_sales_invoices_for_payment(search=None, patient=None, limit=30):
	"""Portal invoice picker for standalone payments (cost-center scoped, ignores strict DocPerm)."""
	limit = min(cint(limit) or 30, 50)
	filters = {
		"docstatus": 1,
		"outstanding_amount": [">", 0],
	}
	if patient:
		filters["patient"] = patient
	if not _payment_search_cost_center_filter(filters):
		return []

	search = (search or "").strip()
	if search:
		from healthcare.api.billing_search import billing_search_or_filters

		or_filters = billing_search_or_filters(search, patient)
		rows = frappe.get_all(
			"Sales Invoice",
			filters=filters,
			or_filters=or_filters,
			fields=[
				"name",
				"patient",
				"customer_name",
				"patient_name",
				"outstanding_amount",
				"grand_total",
				"posting_date",
				"custom_reference_type",
				"custom_reference_name",
			],
			limit=limit,
			order_by="modified desc",
		)
	else:
		rows = frappe.get_all(
			"Sales Invoice",
			filters=filters,
			fields=[
				"name",
				"patient",
				"customer_name",
				"patient_name",
				"outstanding_amount",
				"grand_total",
				"posting_date",
			],
			limit=limit,
			order_by="posting_date desc, modified desc",
		)

	return [
		{
			"name": row.name,
			"label": _format_invoice_payment_label(row),
			"outstanding_amount": flt(row.outstanding_amount),
			"customer_name": row.customer_name,
			"patient": row.patient,
			"patient_name": row.patient_name,
		}
		for row in rows
	]


@frappe.whitelist()
def search_sales_orders_for_payment(search=None, patient=None, limit=30):
	"""Portal sales order picker for standalone payments."""
	limit = min(cint(limit) or 30, 50)
	filters = {
		"docstatus": 1,
		"status": ["not in", ["Closed", "Cancelled", "Completed"]],
	}
	if patient:
		filters["patient"] = patient
	if not _payment_search_cost_center_filter(filters):
		return []

	search = (search or "").strip()
	if search:
		from healthcare.api.billing_search import billing_search_or_filters

		or_filters = billing_search_or_filters(search, patient)
		rows = frappe.get_all(
			"Sales Order",
			filters=filters,
			or_filters=or_filters,
			fields=[
				"name",
				"customer_name",
				"patient_name",
				"grand_total",
				"transaction_date",
				"custom_reference_type",
				"custom_reference_name",
			],
			limit=limit,
			order_by="modified desc",
		)
	else:
		rows = frappe.get_all(
			"Sales Order",
			filters=filters,
			fields=["name", "customer_name", "patient_name", "grand_total", "transaction_date"],
			limit=limit,
			order_by="transaction_date desc, modified desc",
		)

	return [
		{
			"name": row.name,
			"label": _format_order_payment_label(row),
			"grand_total": flt(row.grand_total),
			"customer_name": row.customer_name,
			"patient_name": row.patient_name,
		}
		for row in rows
	]

def _validate_input(data: dict) -> None:
    """Raise if any required field is missing or values are invalid."""
    required = ["reference_doctype", "reference_name"]
    for field in required:
        if not data.get(field):
            frappe.throw(_(f"{field.replace('_', ' ').title()} is required"))

    if data["reference_doctype"] not in ("Sales Invoice", "Sales Order"):
        frappe.throw(_("Reference Type must be Sales Invoice or Sales Order"))

    # Amount / mode validated via _parse_payment_modes (supports multi-mode).
    if not data.get("payment_modes") and not data.get("mode_of_payment"):
        frappe.throw(_("Mode of Payment is required"))
    if not data.get("payment_modes") and frappe.utils.flt(data.get("paid_amount")) <= 0:
        frappe.throw(_("Paid Amount must be greater than zero"))


def _get_reference_doc(reference_doctype: str, reference_name: str):
    """Fetch and return the reference document, throwing if it doesn't exist."""
    if not frappe.db.exists(reference_doctype, reference_name):
        frappe.throw(_(f"{reference_doctype} {reference_name} does not exist"))
    return frappe.get_doc(reference_doctype, reference_name)


def _resolve_company_and_currency(ref_doc) -> tuple[str, str]:
    """Return (company, currency) from the reference doc or system defaults."""
    company = ref_doc.get("company") or frappe.defaults.get_global_default("company")
    currency = (
        ref_doc.get("currency")
        or frappe.get_cached_value("Company", company, "default_currency")
    )
    return company, currency


def _resolve_party(ref_doc) -> str:
    """Return the customer/party name from the reference doc."""
    party = ref_doc.get("customer") or ref_doc.get("patient")
    if not party:
        frappe.throw(_("Could not determine customer/party from the reference document"))
    return party


def _mop_account_for_company(mode_of_payment: str, company: str) -> str | None:
    mop_doc = frappe.get_doc("Mode of Payment", mode_of_payment)
    return next((a.default_account for a in mop_doc.accounts if a.company == company), None)


def _resolve_accounts(company: str, mode_of_payment: str) -> tuple[str, str]:
    """
    Return (paid_from, paid_to) accounts.
    paid_from = company default receivable account
    paid_to   = cash/bank account based on Mode of Payment type
    """
    company_doc = frappe.get_cached_doc("Company", company)
    paid_from = company_doc.default_receivable_account
    if not paid_from:
        frappe.throw(_("Default Receivable Account is not set for company '{0}'").format(company))

    mop_doc = frappe.get_doc("Mode of Payment", mode_of_payment)
    mop_type = (mop_doc.type or "").strip()
    mop_account = _mop_account_for_company(mode_of_payment, company)

    mop_account_type = frappe.get_cached_value("Account", mop_account, "account_type") if mop_account else None

    if mop_type == "Cash":
        # Cash payments should not land on a Bank GL (ERPNext then requires cheque ref fields).
        if mop_account and mop_account_type != "Bank":
            paid_to = mop_account
        else:
            paid_to = company_doc.default_cash_account or mop_account
    elif mop_type == "Bank":
        paid_to = mop_account or company_doc.default_bank_account
    else:
        paid_to = mop_account or company_doc.default_cash_account or company_doc.default_bank_account

    if not paid_to:
        frappe.throw(
            _("No Cash or Bank account configured for Mode of Payment '{0}' in company '{1}'").format(
                mode_of_payment, company
            )
        )

    for account, label in [(paid_from, "Receivable Account"), (paid_to, "Payment Account")]:
        if not frappe.db.exists("Account", account):
            frappe.throw(_("{0} '{1}' does not exist").format(label, account))

    return paid_from, paid_to


def _default_transaction_reference(reference_name: str, data: dict) -> tuple[str, str]:
    reference_no = (data.get("reference_no") or "").strip()
    reference_date = data.get("reference_date") or frappe.utils.today()
    if not reference_no:
        reference_no = f"PAY-{reference_name}"
    return reference_no, reference_date


def _build_remarks(
    reference_doctype: str,
    reference_name: str,
    visit: str | None,
    patient: str | None,
    remarks: str,
    appointment: str | None = None,
) -> str:
    """Compose the remarks string from available context."""
    parts = [f"Payment against {reference_doctype} {reference_name}"]
    if appointment:
        parts.append(f"Appointment: {appointment}")
    if visit:
        parts.append(f"Visit: {visit}")
    if patient:
        parts.append(f"Patient: {patient}")
    if remarks:
        parts.append(remarks)
    return " | ".join(parts)


def _append_reference_row(pe, reference_doctype: str, reference_name: str, ref_doc, paid_amount: float) -> None:
    """Append the correct reference row to the Payment Entry."""
    if reference_doctype == "Sales Invoice":
        outstanding = frappe.utils.flt(ref_doc.outstanding_amount)
        allocated  = min(paid_amount, outstanding) if outstanding > 0 else paid_amount
        pe.append("references", {
            "reference_doctype":  "Sales Invoice",
            "reference_name":     reference_name,
            "bill_no":            ref_doc.get("bill_no") or "",
            "due_date":           ref_doc.get("due_date"),
            "total_amount":       frappe.utils.flt(ref_doc.grand_total),
            "outstanding_amount": outstanding,
            "allocated_amount":   allocated,
        })

    elif reference_doctype == "Sales Order":
        pe.append("references", {
            "reference_doctype":  "Sales Order",
            "reference_name":     reference_name,
            "total_amount":       frappe.utils.flt(ref_doc.grand_total),
            "outstanding_amount": frappe.utils.flt(ref_doc.get("advance_paid", 0)),
            "allocated_amount":   paid_amount,
        })


# ─── Main whitelisted method ──────────────────────────────────────────────────

@frappe.whitelist()
def create_payment_entry(data: dict) -> dict:
    """
    Create Payment Entry(ies) against a Sales Invoice or Sales Order.

    Expected data keys:
        reference_doctype   : "Sales Invoice" | "Sales Order"  (required)
        reference_name      : name of the reference doc         (required)
        paid_amount         : float                             (required unless payment_modes)
        mode_of_payment     : str                               (required unless payment_modes)
        payment_modes       : [{mode_of_payment, amount, reference_no?}]  (optional multi-mode)
        visit               : Patient Visit name                (optional)
        patient             : Patient docname                   (optional)
        remarks             : str                               (optional)
    """
    if isinstance(data, str):
        import json

        data = json.loads(data)

    _validate_input(data)
    modes = _parse_payment_modes(data)
    group_identity = _new_payment_group_identity() if len(modes) > 1 else None
    results = []
    for mode in modes:
        payload = dict(data)
        payload["mode_of_payment"] = mode["mode_of_payment"]
        payload["paid_amount"] = mode["amount"]
        if mode.get("reference_no"):
            payload["reference_no"] = mode["reference_no"]
        if group_identity:
            payload["custom_unique_identity"] = group_identity
        results.append(_create_single_payment_entry(payload))
    return _combine_multi_mode_results(results)


def _create_single_payment_entry(data: dict) -> dict:
    reference_doctype = data["reference_doctype"]
    reference_name = data["reference_name"]
    paid_amount = frappe.utils.flt(data["paid_amount"])
    mode_of_payment = data["mode_of_payment"]

    # Re-fetch so subsequent modes see reduced outstanding after prior PEs.
    ref_doc = _get_reference_doc(reference_doctype, reference_name)
    company, currency = _resolve_company_and_currency(ref_doc)
    party = _resolve_party(ref_doc)
    paid_from, paid_to = _resolve_accounts(company, mode_of_payment)

    pe = frappe.new_doc("Payment Entry")
    pe.payment_type = "Receive"
    pe.company = company
    pe.posting_date = frappe.utils.today()
    pe.mode_of_payment = mode_of_payment
    pe.party_type = "Customer"
    pe.party = party
    pe.party_name = frappe.db.get_value("Customer", party, "customer_name") or party
    pe.paid_from = paid_from
    pe.paid_to = paid_to
    pe.paid_from_account_currency = currency
    pe.paid_to_account_currency = currency
    pe.paid_amount = paid_amount
    pe.received_amount = paid_amount
    pe.source_exchange_rate = 1
    pe.target_exchange_rate = 1
    pe.difference_amount = 0
    pe.remarks = _build_remarks(
        reference_doctype,
        reference_name,
        data.get("visit"),
        data.get("patient"),
        data.get("remarks", ""),
        data.get("appointment"),
    )
    pe.custom_insurance_claim = data.get("custom_insurance_claim")
    if data.get("custom_insurance_company") and pe.meta.has_field("custom_insurance_company"):
        pe.custom_insurance_company = data.get("custom_insurance_company")
    _apply_unique_identity(pe, data.get("custom_unique_identity"))

    reference_no, reference_date = _default_transaction_reference(reference_name, data)
    pe.reference_no = reference_no
    pe.reference_date = reference_date

    _append_reference_row(pe, reference_doctype, reference_name, ref_doc, paid_amount)

    # Skipping pe.set_missing_values() — fails when Payment Entry controller
    # is overridden (e.g. EmployeePaymentEntry). All fields set explicitly.
    return _submit_payment_entry(pe)


def _patient_customer(patient: str) -> str:
	customer = frappe.db.get_value("Patient", patient, "customer")
	if not customer:
		frappe.throw(_("Patient {0} is not linked to a Customer for billing.").format(frappe.bold(patient)))
	return customer


def _resolve_company_for_patient(patient: str, company: str | None = None) -> str:
	if company:
		return company
	company = frappe.defaults.get_user_default("Company") or frappe.defaults.get_global_default("company")
	if not company:
		frappe.throw(_("Company is required for patient billing."))
	return company


def _get_patient_credit_balance(customer: str, company: str) -> float:
	"""Net patient credit available for refund or future invoices."""
	unallocated_received = flt(
		frappe.db.sql(
			"""
			SELECT COALESCE(SUM(unallocated_amount), 0)
			FROM `tabPayment Entry`
			WHERE docstatus = 1
			  AND party_type = 'Customer'
			  AND party = %(party)s
			  AND company = %(company)s
			  AND payment_type = 'Receive'
			  AND unallocated_amount > 0
			""",
			{"party": customer, "company": company},
		)[0][0]
	)

	# Pay entries without invoice references are refunds / payouts of patient credit.
	# They do not reduce unallocated_amount on the original Receive entries in ERPNext.
	refunded = flt(
		frappe.db.sql(
			"""
			SELECT COALESCE(SUM(pe.paid_amount), 0)
			FROM `tabPayment Entry` pe
			WHERE pe.docstatus = 1
			  AND pe.party_type = 'Customer'
			  AND pe.party = %(party)s
			  AND pe.company = %(company)s
			  AND pe.payment_type = 'Pay'
			  AND NOT EXISTS (
				  SELECT 1
				  FROM `tabPayment Entry Reference` ref
				  WHERE ref.parenttype = 'Payment Entry'
				    AND ref.parent = pe.name
			  )
			""",
			{"party": customer, "company": company},
		)[0][0]
	)

	return max(0, flt(unallocated_received - refunded))


def _parse_allocations(raw) -> list[dict]:
	if not raw:
		return []
	if isinstance(raw, str):
		import json

		raw = json.loads(raw)
	if not isinstance(raw, list):
		frappe.throw(_("Allocations must be a list of invoice amounts"))
	out = []
	for row in raw:
		if not isinstance(row, dict):
			continue
		name = (row.get("reference_name") or row.get("invoice") or "").strip()
		amt = _money(row.get("allocated_amount") or row.get("amount") or 0)
		if not name or amt <= 0:
			continue
		out.append({"reference_name": name, "allocated_amount": amt})
	return out


def _parse_payment_modes(data: dict, *, amount_key: str = "paid_amount") -> list[dict]:
	"""Normalize single mode fields or a payment_modes list into [{mode, amount, reference_no}]."""
	raw = data.get("payment_modes")
	if isinstance(raw, str):
		import json

		raw = json.loads(raw) if raw.strip() else None

	modes: list[dict] = []
	if isinstance(raw, list) and raw:
		for row in raw:
			if not isinstance(row, dict):
				continue
			mode = (row.get("mode_of_payment") or row.get("payment_mode") or "").strip()
			amount = _money(row.get("amount") or row.get("paid_amount") or 0)
			if not mode or amount <= 0:
				continue
			modes.append(
				{
					"mode_of_payment": mode,
					"amount": amount,
					"reference_no": (row.get("reference_no") or "").strip() or None,
				}
			)
	else:
		mode = (data.get("mode_of_payment") or data.get("payment_mode") or "").strip()
		amount = _money(data.get(amount_key) or data.get("paid_amount") or data.get("refund_amount") or 0)
		if mode and amount > 0:
			modes.append(
				{
					"mode_of_payment": mode,
					"amount": amount,
					"reference_no": (data.get("reference_no") or "").strip() or None,
				}
			)

	if not modes:
		frappe.throw(_("Add at least one mode of payment with an amount greater than zero"))

	seen = set()
	for row in modes:
		if row["mode_of_payment"] in seen:
			frappe.throw(_("Duplicate mode of payment: {0}").format(row["mode_of_payment"]))
		seen.add(row["mode_of_payment"])

	return modes


def _combine_multi_mode_results(results: list[dict], *, label: str = "Payment") -> dict:
	names = [r.get("name") for r in results if r.get("name")]
	draft = any(r.get("is_draft") for r in results)
	unallocated = sum(flt(r.get("unallocated_amount")) for r in results)
	if len(names) == 1:
		return results[0]
	msg = f"{label} entries created: {', '.join(names)}"
	if unallocated > 0:
		msg += f". Unallocated credit: {unallocated:.2f}"
	return {
		"name": names[0] if names else "",
		"names": names,
		"server_message": msg,
		"unallocated_amount": unallocated,
		"docstatus": 0 if draft else 1,
		"is_draft": draft,
	}


def _split_allocations_across_modes(modes: list[dict], allocations: list[dict]) -> list[dict]:
	"""Greedily assign invoice allocations to each payment mode in order."""
	remaining = [
		{
			"reference_name": row.get("reference_name") or row.get("invoice"),
			"left": _money(row.get("allocated_amount")),
		}
		for row in allocations
		if (row.get("reference_name") or row.get("invoice")) and _money(row.get("allocated_amount")) > 0
	]
	out = []
	for mode in modes:
		mode_left = _money(mode["amount"])
		mode_allocs = []
		for row in remaining:
			if mode_left <= 0:
				break
			take = _money(min(flt(row["left"]), mode_left))
			if take <= 0:
				continue
			mode_allocs.append(
				{"reference_name": row["reference_name"], "allocated_amount": take}
			)
			row["left"] = _money(flt(row["left"]) - take)
			mode_left = _money(mode_left - take)
		out.append({**mode, "amount": _money(mode["amount"]), "allocations": mode_allocs})
	return out


def _new_receive_payment_entry(
	customer: str,
	company: str,
	mode_of_payment: str,
	paid_amount: float,
	remarks: str,
	reference_no: str | None = None,
	reference_date: str | None = None,
) -> "frappe.model.document.Document":
	paid_from, paid_to = _resolve_accounts(company, mode_of_payment)
	currency = frappe.get_cached_value("Company", company, "default_currency") or frappe.defaults.get_global_default(
		"currency"
	)
	pe = frappe.new_doc("Payment Entry")
	pe.payment_type = "Receive"
	pe.company = company
	pe.posting_date = frappe.utils.today()
	pe.mode_of_payment = mode_of_payment
	pe.party_type = "Customer"
	pe.party = customer
	pe.party_name = frappe.db.get_value("Customer", customer, "customer_name") or customer
	pe.paid_from = paid_from
	pe.paid_to = paid_to
	pe.paid_from_account_currency = currency
	pe.paid_to_account_currency = currency
	amount = _money(paid_amount)
	pe.paid_amount = amount
	pe.received_amount = amount
	pe.source_exchange_rate = 1
	pe.target_exchange_rate = 1
	pe.difference_amount = 0
	pe.remarks = remarks
	pe.reference_no = (reference_no or "").strip() or remarks[:140]
	pe.reference_date = reference_date or frappe.utils.today()
	return pe


def _resolve_op_or_ip_doctype(value: str | None) -> str | None:
	"""Map UI OP/IP (or DocType name) to Payment Entry custom_op_or_ip Link value."""
	raw = (value or "").strip()
	if not raw:
		return None
	key = raw.upper()
	if key in ("OP", "PATIENT VISIT"):
		return "Patient Visit"
	if key in ("IP", "INPATIENT ADMISSION"):
		return "Inpatient Admission"
	if raw in ("Patient Visit", "Inpatient Admission"):
		return raw
	return None


def _apply_advance_case_fields(pe, data: dict) -> None:
	"""Optional reporting fields: custom_op_or_ip (DocType) + custom_case_no (Dynamic Link)."""
	if not pe.meta.has_field("custom_op_or_ip"):
		return
	doctype = _resolve_op_or_ip_doctype(data.get("custom_op_or_ip"))
	case_no = (data.get("custom_case_no") or "").strip()
	if doctype:
		pe.custom_op_or_ip = doctype
	if case_no and pe.meta.has_field("custom_case_no") and getattr(pe, "custom_op_or_ip", None):
		pe.custom_case_no = case_no


def _is_reception_portal_user(user: str | None = None) -> bool:
	from healthcare.healthcare.discharge_checklist_permissions import _is_reception_user

	return _is_reception_user(user)


def _save_payment_entry(pe, *, draft: bool = False) -> dict:
	from healthcare.api.receptionist_shift import stamp_receptionist_shift_on_doc

	stamp_receptionist_shift_on_doc(pe)
	pe.insert(ignore_permissions=True)
	if not draft:
		pe.submit()
	frappe.db.commit()

	if draft:
		msg = f"Payment Entry {pe.name} saved as draft"
	else:
		msg = f"Payment Entry {pe.name} created successfully"
		unallocated = flt(getattr(pe, "unallocated_amount", 0))
		if unallocated > 0:
			msg += f". Unallocated credit: {unallocated:.2f}"

	return {
		"name": pe.name,
		"server_message": msg,
		"unallocated_amount": 0 if draft else flt(getattr(pe, "unallocated_amount", 0)),
		"docstatus": pe.docstatus,
		"is_draft": draft,
	}


def _submit_payment_entry(pe) -> dict:
	return _save_payment_entry(pe, draft=False)


@frappe.whitelist()
def get_patient_billing_balance(patient: str, company: str | None = None) -> dict:
	"""Outstanding invoice total and unallocated patient credit for reception refunds."""
	if not patient:
		frappe.throw(_("Patient is required"))
	customer = _patient_customer(patient)
	company = _resolve_company_for_patient(patient, company)

	outstanding_invoices = flt(
		frappe.db.sql(
			"""
			SELECT COALESCE(SUM(outstanding_amount), 0)
			FROM `tabSales Invoice`
			WHERE docstatus = 1 AND patient = %(patient)s AND outstanding_amount > 0
			""",
			{"patient": patient},
		)[0][0]
	)
	credit_balance = _get_patient_credit_balance(customer, company)

	return {
		"patient": patient,
		"customer": customer,
		"company": company,
		"outstanding_invoices": outstanding_invoices,
		"credit_balance": credit_balance,
	}


@frappe.whitelist()
def list_patient_outstanding_invoices(patient: str, limit=50):
	"""All payable invoices for a patient (multi-invoice payment UI)."""
	if not patient:
		frappe.throw(_("Patient is required"))
	limit = min(cint(limit) or 50, 100)
	filters = {
		"docstatus": 1,
		"patient": patient,
		"outstanding_amount": [">", 0],
	}
	if not _payment_search_cost_center_filter(filters):
		return []

	rows = frappe.get_all(
		"Sales Invoice",
		filters=filters,
		fields=[
			"name",
			"patient",
			"customer_name",
			"patient_name",
			"outstanding_amount",
			"grand_total",
			"posting_date",
			"custom_reference_type",
			"custom_reference_name",
		],
		limit=limit,
		order_by="posting_date desc, modified desc",
	)
	return [
		{
			"name": row.name,
			"label": _format_invoice_payment_label(row),
			"outstanding_amount": flt(row.outstanding_amount),
			"grand_total": flt(row.grand_total),
			"posting_date": row.posting_date,
			"patient": row.patient,
			"patient_name": row.patient_name,
		}
		for row in rows
	]


@frappe.whitelist()
def create_patient_advance_payment(data: dict) -> dict:
	"""
	Record a patient payment without an invoice. The full amount is kept as unallocated credit
	for future invoices. Supports payment_modes for multiple Payment Entries.
	"""
	if isinstance(data, str):
		import json

		data = json.loads(data)
	patient = data.get("patient")
	if not patient:
		frappe.throw(_("Patient is required"))

	modes = _parse_payment_modes(data)
	customer = _patient_customer(patient)
	company = _resolve_company_for_patient(patient, data.get("company"))
	remarks_parts = [f"Patient advance payment — {patient}"]
	if data.get("remarks"):
		remarks_parts.append(data["remarks"])
	remarks = " | ".join(remarks_parts)

	group_identity = _new_payment_group_identity() if len(modes) > 1 else None
	results = []
	for mode in modes:
		pe = _new_receive_payment_entry(
			customer,
			company,
			mode["mode_of_payment"],
			mode["amount"],
			remarks,
			mode.get("reference_no") or data.get("reference_no"),
			data.get("reference_date"),
		)
		_apply_advance_case_fields(pe, data)
		_apply_unique_identity(pe, group_identity)
		results.append(_submit_payment_entry(pe))
	return _combine_multi_mode_results(results, label="Advance payment")


@frappe.whitelist()
def create_multi_invoice_payment(data: dict) -> dict:
	"""
	Payment allocated across multiple sales invoices. Supports payment_modes (one PE per mode).
	Any amount above total allocations is kept as unallocated patient credit.
	"""
	if isinstance(data, str):
		import json

		data = json.loads(data)
	patient = data.get("patient")
	if not patient:
		frappe.throw(_("Patient is required"))

	modes = _parse_payment_modes(data)
	paid_amount = _money(sum(_money(m["amount"]) for m in modes))

	allocations = _parse_allocations(data.get("allocations"))
	if not allocations:
		frappe.throw(_("Select at least one invoice to allocate"))

	total_allocated = _money(sum(_money(row.get("allocated_amount")) for row in allocations))
	if total_allocated <= 0:
		frappe.throw(_("Total allocated amount must be greater than zero"))
	if _money_gt(total_allocated, paid_amount):
		frappe.throw(_("Total allocated amount cannot exceed the payment amount"))

	# Validate invoices once before creating any Payment Entries.
	for row in allocations:
		invoice_name = row.get("reference_name") or row.get("invoice")
		allocated = _money(row.get("allocated_amount"))
		if not invoice_name or allocated <= 0:
			continue
		inv = _get_reference_doc("Sales Invoice", invoice_name)
		if inv.get("patient") and inv.patient != patient:
			frappe.throw(_("Invoice {0} does not belong to patient {1}").format(invoice_name, patient))
		outstanding = _money(inv.outstanding_amount)
		if _money_gt(allocated, outstanding):
			frappe.throw(
				_("Allocation for {0} ({1}) exceeds outstanding amount ({2})").format(
					invoice_name, allocated, outstanding
				)
			)

	customer = _patient_customer(patient)
	company = _resolve_company_for_patient(patient, data.get("company"))
	remarks_base = [f"Multi-invoice payment — Patient: {patient}"]
	if data.get("remarks"):
		remarks_base.append(data["remarks"])

	mode_payloads = _split_allocations_across_modes(modes, allocations)
	group_identity = _new_payment_group_identity() if len(mode_payloads) > 1 else None
	results = []
	for mp in mode_payloads:
		invoice_names = []
		remarks = " | ".join(remarks_base)
		pe = _new_receive_payment_entry(
			customer,
			company,
			mp["mode_of_payment"],
			mp["amount"],
			remarks,
			mp.get("reference_no") or data.get("reference_no"),
			data.get("reference_date"),
		)
		for row in mp.get("allocations") or []:
			invoice_name = row.get("reference_name")
			allocated = _money(row.get("allocated_amount"))
			if not invoice_name or allocated <= 0:
				continue
			inv = _get_reference_doc("Sales Invoice", invoice_name)
			outstanding = _money(inv.outstanding_amount)
			take = _money(min(allocated, outstanding) if outstanding > 0 else allocated)
			if take <= 0:
				continue
			pe.append(
				"references",
				{
					"reference_doctype": "Sales Invoice",
					"reference_name": invoice_name,
					"bill_no": inv.get("bill_no") or "",
					"due_date": inv.get("due_date"),
					"total_amount": _money(inv.grand_total),
					"outstanding_amount": outstanding,
					"allocated_amount": take,
				},
			)
			invoice_names.append(invoice_name)

		if invoice_names:
			pe.remarks += f" | Invoices: {', '.join(invoice_names)}"
		_apply_unique_identity(pe, group_identity)
		results.append(_submit_payment_entry(pe))

	return _combine_multi_mode_results(results, label="Multi-invoice payment")


@frappe.whitelist()
def create_patient_refund(data: dict) -> dict:
	"""Refund unallocated patient credit (Pay Payment Entry). Supports payment_modes."""
	if isinstance(data, str):
		import json

		data = json.loads(data)
	patient = data.get("patient")
	if not patient:
		frappe.throw(_("Patient is required"))

	modes = _parse_payment_modes(data, amount_key="refund_amount")
	refund_amount = _money(sum(_money(m["amount"]) for m in modes))

	customer = _patient_customer(patient)
	company = _resolve_company_for_patient(patient, data.get("company"))
	credit_balance = _money(_get_patient_credit_balance(customer, company))
	if _money_gt(refund_amount, credit_balance):
		frappe.throw(
			_("Refund amount ({0}) exceeds available patient credit ({1})").format(refund_amount, credit_balance)
		)

	currency = frappe.get_cached_value("Company", company, "default_currency") or frappe.defaults.get_global_default(
		"currency"
	)
	remarks_parts = [f"Patient credit refund — {patient}"]
	if data.get("remarks"):
		remarks_parts.append(data["remarks"])
	remarks = " | ".join(remarks_parts)
	draft = _is_reception_portal_user()

	group_identity = _new_payment_group_identity() if len(modes) > 1 else None
	results = []
	for mode in modes:
		receivable, bank_or_cash = _resolve_accounts(company, mode["mode_of_payment"])
		pe = frappe.new_doc("Payment Entry")
		pe.payment_type = "Pay"
		pe.company = company
		pe.posting_date = frappe.utils.today()
		pe.mode_of_payment = mode["mode_of_payment"]
		pe.party_type = "Customer"
		pe.party = customer
		pe.party_name = frappe.db.get_value("Customer", customer, "customer_name") or customer
		pe.paid_from = bank_or_cash
		pe.paid_to = receivable
		pe.paid_from_account_currency = currency
		pe.paid_to_account_currency = currency
		pe.paid_amount = mode["amount"]
		pe.received_amount = mode["amount"]
		pe.source_exchange_rate = 1
		pe.target_exchange_rate = 1
		pe.difference_amount = 0
		pe.remarks = remarks
		pe.reference_no = (
			(mode.get("reference_no") or data.get("reference_no") or "").strip()
			or f"REFUND-{patient}"[:140]
		)
		pe.reference_date = data.get("reference_date") or frappe.utils.today()
		_apply_unique_identity(pe, group_identity)
		results.append(_save_payment_entry(pe, draft=draft))

	return _combine_multi_mode_results(results, label="Refund")


