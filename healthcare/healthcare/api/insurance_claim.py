import re

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, nowdate, today

TRICARE = "TRICARE"

# Sales Invoice healthcare references that identify an Inpatient / Outpatient case.
IP_REFERENCE_VALUES = ("Inpatient Admission", "Discharge", "IP Service")
OP_REFERENCE_VALUES = ("Patient Visit",)


def infer_ip_op_source(invoice_names=None, service_types=None) -> str | None:
    """Infer the claim-level IP / OP Source (``IP``, ``OP`` or ``PH``).

    Priority order:
    1. The healthcare reference on the linked Sales Invoice(s) — an
       ``Inpatient Admission`` / ``Discharge`` reference means ``IP`` and a
       ``Patient Visit`` reference means ``OP``.
    2. When every claim line shares one service type, use that type.
    """
    for invoice in invoice_names or []:
        name = (invoice or "").strip()
        if not name:
            continue
        ref_type, base_ref = frappe.db.get_value(
            "Sales Invoice", name, ["custom_reference_type", "custom_base_reference"]
        ) or (None, None)
        if ref_type in IP_REFERENCE_VALUES:
            return "IP"
        if ref_type in OP_REFERENCE_VALUES:
            return "OP"
        # Some billing flows leave custom_reference_type blank but still set the
        # base reference to the case document.
        if base_ref in IP_REFERENCE_VALUES:
            return "IP"
        if base_ref in OP_REFERENCE_VALUES:
            return "OP"

    normalized = {
        (value or "").strip().upper() for value in service_types or [] if (value or "").strip()
    }
    if len(normalized) == 1:
        only = normalized.pop()
        if only == "PHARMACY":
            return "PH"
        if only in ("IP", "OP", "PH"):
            return only
    return None


@frappe.whitelist()
def create_insurance_claim_from_invoice(sales_invoice: str) -> str:
    """
    Create (or fetch existing) Insurance Claim for a submitted Sales Invoice.

    - Requires the Sales Invoice to be submitted.
    - Requires the linked Patient to have `is_insurance` checked and `insurance` set.
    - Populates Insurance Claim header + claim_items from Sales Invoice items.
    """
    if not sales_invoice:
        frappe.throw(_("Sales Invoice is required"))

    inv = frappe.get_doc("Sales Invoice", sales_invoice)
    if inv.docstatus != 1:
        frappe.throw(_("Sales Invoice must be submitted before creating an Insurance Claim"))

    patient = getattr(inv, "patient", None)
    if not patient:
        frappe.throw(_("Sales Invoice must have a Patient to create an Insurance Claim"))

    patient_doc = frappe.get_doc("Patient", patient)
    if not getattr(patient_doc, "is_insurance", 0) or not getattr(patient_doc, "insurance", None):
        frappe.throw(
            _("Patient {0} is not marked as Insurance or missing Health Insurance").format(patient_doc.name)
        )

    insurance_doc = frappe.get_doc("Health Insurance", patient_doc.insurance)

    claim = frappe.new_doc("Insurance Claim")
    claim.trans_no = get_next_insurance_claim_trans_no()
    claim.patient = patient_doc.name
    claim.health_insurance = patient_doc.insurance
    claim.insurance_payor = insurance_doc.insurance_company
    claim.claim_date = today()
    claim.reference_doctype = "Sales Invoice"
    claim.reference_name = inv.name
    claim.sales_invoice = inv.name
    claim.status = "Draft"

    total_claimed = 0.0
    total_patient_liability = 0.0
    total_qty = 0.0

    # Infer OP/IP from the invoice's healthcare case reference (admission vs visit)
    default_service_type = infer_ip_op_source([inv.name])
    claim.ip_op_source = default_service_type

    for si_item in inv.get("items", []):
        if not si_item.item_code:
            continue

        row = claim.append("claim_items", {})

        # Service type
        row.service_type = default_service_type or "Other"

        # Reference back to the originating healthcare document if available
        # (via standard Sales Invoice custom fields, if configured)
        if hasattr(si_item, "reference_dt") and hasattr(si_item, "reference_dn"):
            row.reference_doctype = si_item.reference_dt
            row.reference_name = si_item.reference_dn

        row.sales_invoice = inv.name
        row.sales_invoice_item = si_item.item_code
        row.item_name = si_item.item_name or si_item.item_code

        gross = flt(getattr(si_item, "net_amount", None) or getattr(si_item, "amount", 0))
        row.gross_amount = gross
        row.covered_amount = gross
        row.co_pay_amount = 0
        row.non_covered_amount = 0
        row.patient_liability = 0

        total_claimed += gross
        total_qty += flt(si_item.qty or 0)

    claim.total_claimed = total_claimed
    claim.total_patient_liability = total_patient_liability
    claim.total_quantity = total_qty

    claim.insert(ignore_permissions=True)
    frappe.db.commit()
    return claim.name


def _mode_of_payment_needs_bank_reference(mode_of_payment: str) -> bool:
	"""Bank-type modes (and Cheque) require Payment Entry reference no/date."""
	if not mode_of_payment:
		return False
	mop_type = frappe.get_cached_value("Mode of Payment", mode_of_payment, "type")
	if mop_type == "Bank":
		return True
	name_lower = mode_of_payment.lower()
	return "cheque" in name_lower or "check" in name_lower


@frappe.whitelist()
def update_insurance_claim_payment(
	name: str,
	paid_amount: float,
	mode_of_payment: str,
	reference_no: str | None = None,
	reference_date: str | None = None,
) -> dict:
	"""
	Update Insurance Claim payment information and create a Payment Entry.

	- `paid_amount` is the NEW total approved/paid amount for the claim.
	- We compute the delta from the existing `total_approved` and
	  create a Payment Entry only for the difference (if positive).
	- Status rules:
		- if total_paid >= total_claimed -> Paid
		- elif total_paid > 0          -> Partially Paid
	"""
	if not name:
		frappe.throw(_("Insurance Claim name is required"))
	if not mode_of_payment:
		frappe.throw(_("Mode of Payment is required"))

	claim = frappe.get_doc("Insurance Claim", name)

	# Prefer per-line invoices (multi-invoice claims); fall back to header link.
	invoice_shares = {}
	for row in claim.claim_items or []:
		inv = (getattr(row, "sales_invoice", None) or "").strip() or (claim.sales_invoice or "")
		if not inv:
			continue
		invoice_shares[inv] = flt(invoice_shares.get(inv)) + flt(
			getattr(row, "covered_amount", None) or getattr(row, "gross_amount", None) or 0
		)
	if not invoice_shares and claim.sales_invoice:
		invoice_shares[claim.sales_invoice] = flt(claim.total_claimed or 0)
	if not invoice_shares:
		frappe.throw(_("Insurance Claim {0} is not linked to a Sales Invoice").format(claim.name))

	new_total_paid = flt(paid_amount)
	if new_total_paid < 0:
		frappe.throw(_("Paid amount cannot be negative"))

	current_paid = flt(claim.total_approved or 0)
	delta = new_total_paid - current_paid

	if _mode_of_payment_needs_bank_reference(mode_of_payment):
		if not (reference_no or "").strip() or not reference_date:
			frappe.throw(_("Reference No and Reference Date are required for bank/cheque payments"))

	pe_name = None
	pe_names = []
	if delta > 0:
		from healthcare.api.payment_entry import create_payment_entry

		share_total = sum(flt(v) for v in invoice_shares.values()) or flt(delta)
		allocated = 0.0
		invoice_names = list(invoice_shares.keys())
		for idx, inv_name in enumerate(invoice_names):
			if idx == len(invoice_names) - 1:
				portion = flt(delta) - allocated
			else:
				portion = flt(delta) * (flt(invoice_shares[inv_name]) / share_total)
				portion = flt(portion)
				allocated += portion
			if portion <= 0:
				continue
			pe_payload = {
				"reference_doctype": "Sales Invoice",
				"reference_name": inv_name,
				"paid_amount": portion,
				"mode_of_payment": mode_of_payment,
				"patient": claim.patient,
				"custom_insurance_claim": claim.name,
				"remarks": _("Insurance Claim {0} payment update").format(claim.name),
			}
			if claim.health_insurance:
				pe_payload["custom_insurance_company"] = claim.health_insurance
			if reference_no:
				pe_payload["reference_no"] = reference_no.strip()
			if reference_date:
				pe_payload["reference_date"] = reference_date

			pe_info = create_payment_entry(pe_payload)
			if pe_info.get("name"):
				pe_names.append(pe_info["name"])
		pe_name = pe_names[0] if pe_names else None
	elif delta < 0:
		frappe.throw(
			_("Reducing approved amount is not supported from payment update. Current approved: {0}").format(
				current_paid
			)
		)

	# Absolute new total (do not add delta again).
	claim.total_approved = new_total_paid

	total_claimed = flt(claim.total_claimed or 0)
	if total_claimed and claim.total_approved >= total_claimed:
		claim.status = "Paid"
	elif claim.total_approved > 0:
		claim.status = "Partially Paid"
	else:
		claim.status = "Submitted"

	claim.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"insurance_claim": claim.name,
		"payment_entry": pe_name,
		"payment_entries": pe_names,
		"total_approved": flt(claim.total_approved),
		"status": claim.status,
	}


# ─── Trans No generation ───────────────────────────────────────────────────────


def get_next_insurance_claim_trans_no(year: int | None = None) -> str:
    """Generate the next Insurance Claim trans_no in the legacy ``INS/YYYY/#####`` format."""
    if not year:
        year = getdate(today()).year
    prefix = f"INS/{year}/"
    existing = frappe.db.get_all(
        "Insurance Claim",
        filters={"trans_no": ["like", f"{prefix}%"]},
        pluck="trans_no",
    )
    max_n = 0
    for value in existing:
        match = re.search(r"/(\d+)$", str(value or ""))
        if match:
            max_n = max(max_n, int(match.group(1)))
    return f"{prefix}{str(max_n + 1).zfill(5)}"


@frappe.whitelist()
def get_next_insurance_claim_number() -> dict:
    """Preview the next Insurance Claim trans_no (for the create UI)."""
    return {"trans_no": get_next_insurance_claim_trans_no()}


def ensure_claim_insurance(doc) -> None:
    """Make sure a claim carries a Health Insurance + Insurance Company.

    Falls back to the patient's linked insurance, then to TRICARE.
    """
    if not getattr(doc, "patient", None):
        return
    if not doc.health_insurance and getattr(doc, "patient_insurance_coverage", None):
        doc.health_insurance = frappe.db.get_value(
            "Patient Insurance Cover", doc.patient_insurance_coverage, "health_insurance"
        ) or None
    if not doc.health_insurance:
        doc.health_insurance = frappe.db.get_value("Patient", doc.patient, "insurance") or None
    if not doc.health_insurance and frappe.db.exists("Health Insurance", TRICARE):
        doc.health_insurance = TRICARE
    if doc.health_insurance and not doc.insurance_payor:
        doc.insurance_payor = (
            frappe.db.get_value("Health Insurance", doc.health_insurance, "insurance_company")
            or doc.health_insurance
        )


# ─── Legacy import (INSURANCE_00_01 master + INSURANCE_00_02 services) ──────────


def _ensure_tricare() -> str:
    """Ensure the TRICARE Insurance Company + Health Insurance records exist."""
    if not frappe.db.exists("Insurance Company", TRICARE):
        try:
            frappe.get_doc({"doctype": "Insurance Company", "name1": TRICARE}).insert(
                ignore_permissions=True
            )
        except Exception:
            frappe.get_doc({"doctype": "Insurance Company", "name": TRICARE}).insert(
                ignore_permissions=True
            )
    if not frappe.db.exists("Health Insurance", TRICARE):
        frappe.get_doc(
            {"doctype": "Health Insurance", "insurance_company": TRICARE}
        ).insert(ignore_permissions=True)
    return TRICARE


def _legacy_num(value) -> str:
    from healthcare.api.patient_info_import import _clean_oracle_num

    return _clean_oracle_num(value)


def _legacy_text(value) -> str:
    from healthcare.api.patient_info_import import _cell_text

    return _cell_text(value)


def _legacy_date(value):
    if value in (None, ""):
        return None
    try:
        return getdate(value)
    except Exception:
        return None


def _legacy_datetime_str(value) -> str | None:
    from datetime import date, datetime

    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    return _legacy_text(value)


def _read_sheet_dicts(file_url: str) -> list[dict]:
    """Read an uploaded Excel file into a list of dicts keyed by UPPERCASE headers."""
    from healthcare.api.patient_info_import import _iter_excel_sheet_rows

    rows_iter = _iter_excel_sheet_rows(file_url)
    header = None
    out: list[dict] = []
    for values, _datemode in rows_iter:
        if header is None:
            header = [
                (str(cell).strip().upper() if cell is not None else "") for cell in values
            ]
            continue
        row = {}
        for idx, key in enumerate(header):
            if not key:
                continue
            row[key] = values[idx] if idx < len(values) else None
        out.append(row)
    return out


def _resolve_patient_for_import(patient_num: str) -> str | None:
    """Resolve (or create a minimal) Patient for a legacy PATIENT_NUM (== file_no == name)."""
    pn = _legacy_num(patient_num)
    if not pn:
        return None
    if frappe.db.exists("Patient", pn):
        return pn
    from healthcare.api.patient_visit_import import _default_gender

    doc = frappe.new_doc("Patient")
    doc.file_no = pn
    doc.patient_name = _("Patient {0}").format(pn)
    doc.first_name = _("Patient {0}").format(pn)
    try:
        doc.sex = _default_gender()
    except Exception:
        pass
    doc.flags.ignore_mandatory = True
    doc.insert(ignore_permissions=True)
    return doc.name


def _mark_patient_insured(patient: str) -> None:
    frappe.db.set_value(
        "Patient",
        patient,
        {"is_insurance": 1, "insurance": TRICARE},
        update_modified=False,
    )


def _ensure_patient_register(patient: str) -> tuple[str, bool]:
    """Ensure an Insurance Patient Register exists for the patient (linked, TRICARE)."""
    existing = frappe.db.get_value(
        "Insurance Patient Register", {"patient": patient}, "name"
    )
    if existing:
        return existing, False

    full_name = frappe.db.get_value("Patient", patient, "patient_name") or patient
    cpr = frappe.db.get_value("Patient", patient, "id_number") or None
    doc = frappe.get_doc(
        {
            "doctype": "Insurance Patient Register",
            "full_name": full_name,
            "national_id_cpr_no": cpr,
            "insurance_provider": TRICARE,
            "patient": patient,
            "status": "Active",
            "posting_date": nowdate(),
            # Created by the legacy TRICARE import/reconcile — the portal keeps
            # these out of the "add validity days" reminder.
            "legacy": 1,
        }
    )
    doc.flags.ignore_mandatory = True
    doc.insert(ignore_permissions=True)
    frappe.db.set_value(
        "Patient",
        patient,
        {"insurance_register": doc.name},
        update_modified=False,
    )
    return doc.name, True


def _legacy_claim_status(due, paid, balance, approved=0) -> str:
    """Map legacy master amounts to a claim status.

    For legacy claims the insurer's approved amount is treated as the paid
    amount (there is no separate payment workflow in the source system).

    - Settled in full (approved/paid covers the due, or no balance remains) -> Paid
    - Some approved/paid but a balance remains                              -> Partially Paid
    - Nothing approved or paid                                              -> Submitted
    """
    due = flt(due)
    paid = flt(paid)
    balance = flt(balance)
    approved = flt(approved)
    # Legacy: approved amount counts as paid by the insurer.
    settled = max(paid, approved)
    if due > 0 and balance <= 0:
        return "Paid"
    if settled > 0 and (due <= 0 or settled + 0.001 >= due):
        return "Paid"
    if settled > 0:
        return "Partially Paid"
    return "Submitted"


def _service_type_from_source(source: str) -> str:
    source = (source or "").strip().upper()
    if source in ("OP", "IP"):
        return source
    if source == "PH":
        return "Pharmacy"
    return "Other"


def _build_claim_items(doc, lines: list[dict]) -> None:
    for line in sorted(lines, key=lambda x: flt(x.get("SR_NUM"))):
        bill = flt(line.get("BILL_AMOUNT"))
        insured = flt(line.get("ALREADY_INSURANCE"))
        balance = flt(line.get("BALANCE"))
        reff = _legacy_text(line.get("REFF_TRANS_NUM"))
        inv_type = _legacy_text(line.get("INVOICE_TYPE"))
        doc.append(
            "claim_items",
            {
                "service_type": _service_type_from_source(line.get("INVOICE_SOURCE")),
                "item_name": reff or inv_type or _("Legacy service"),
                "description": " ".join(x for x in [inv_type, reff] if x),
                "gross_amount": bill,
                "covered_amount": insured or bill,
                "co_pay_amount": 0,
                "non_covered_amount": flt(line.get("NOW_PAID")),
                "patient_liability": balance,
                "paid_amount": flt(line.get("ALREADY_PAID")) + flt(line.get("NOW_PAID")),
                # legacy line fields
                "sr_num": cint(flt(line.get("SR_NUM"))),
                "reff_trans_num": reff or None,
                "reff_trans_date": _legacy_date(line.get("REFF_TRANS_DATE")),
                "invoice_type": inv_type or None,
                "invoice_source": _legacy_text(line.get("INVOICE_SOURCE")) or None,
                "visit_num_det": _legacy_num(line.get("VISIT_NUM_DET")) or None,
                "bill_amount": bill,
                "already_paid": flt(line.get("ALREADY_PAID")),
                "already_discount": flt(line.get("ALREADY_DISCOUNT")),
                "already_adjusted": flt(line.get("ALREADY_ADJUSTED")),
                "already_sales_return": flt(line.get("ALREADY_SALES_RETURN")),
                "already_insurance": insured,
                "already_jv": flt(line.get("ALREADY_JV")),
                "already_abc": flt(line.get("ALREADY_ABC")),
                "already_def": flt(line.get("ALREADY_DEF")),
                "balance": balance,
                "now_discount": flt(line.get("NOW_DISCOUNT")),
                "now_paid": flt(line.get("NOW_PAID")),
            },
        )


def _apply_master_to_claim(doc, row: dict, patient: str | None, child_map: dict) -> None:
    """Populate an Insurance Claim doc (new or existing draft) from a master row."""
    trans_no = _legacy_text(row.get("TRANS_NUM"))
    due = flt(row.get("DUE_AMT"))
    paid = flt(row.get("PAID_AMT"))
    balance = flt(row.get("BALANCE_AMT"))
    approved_bhd = flt(row.get("APPROVED_AMT_BHD"))

    doc.trans_no = trans_no
    doc.legacy = 1
    doc.patient = patient
    doc.health_insurance = TRICARE
    doc.insurance_payor = TRICARE
    doc.claim_date = _legacy_date(row.get("TRANS_DATE"))
    doc.status = _legacy_claim_status(due, paid, balance, approved_bhd)
    doc.authorization_no = _legacy_text(row.get("AUTORIZATION_NUM")) or None
    doc.remark = _legacy_text(row.get("REMARKS_MASTER")) or None

    doc.trans_date = _legacy_date(row.get("TRANS_DATE"))
    doc.ip_op_source = (_legacy_text(row.get("IP_OP_SOURCE")) or "").upper() or None
    doc.patient_num = _legacy_num(row.get("PATIENT_NUM")) or None
    doc.admission_num = _legacy_num(row.get("ADMISSION_NUM")) or None
    doc.claim_no = _legacy_num(row.get("CLAIM_NUM")) or None
    doc.claim_days = cint(flt(row.get("CLAIM_DAYS")))
    doc.claim_accept_days = cint(flt(row.get("CLAIM_ACCEPT_DAYS")))
    doc.due_amount = due
    doc.paid_amount = paid
    doc.discount_amount = flt(row.get("DISCOUNT_AMT"))
    doc.balance_amount = balance
    doc.approved_amount_usd = flt(row.get("APPROVED_AMT_USD"))
    doc.approved_amount_bhd = approved_bhd
    doc.exchange_diff_amount = flt(row.get("EXCHANGE_DIFF_AMT"))
    doc.vch_status = _legacy_text(row.get("VCH_STATUS")) or None
    doc.branch_num = _legacy_num(row.get("BRANCH_NUM")) or None
    doc.comp_gl_code = _legacy_text(row.get("COMP_GL_CODE")) or None
    doc.pharmacy_sale_trans_num = _legacy_text(row.get("PHARMACY_SALE_TRANS_NUM")) or None
    doc.legacy_cr_id = _legacy_num(row.get("CR_ID")) or None
    doc.legacy_cr_date = _legacy_datetime_str(row.get("CR_DATE"))
    doc.legacy_up_id = _legacy_num(row.get("UP_ID")) or None
    doc.legacy_up_date = _legacy_datetime_str(row.get("UP_DATE"))
    doc.legacy_ap_id = _legacy_num(row.get("AP_ID")) or None
    doc.legacy_ap_date = _legacy_datetime_str(row.get("AP_DATE"))

    doc.set("claim_items", [])
    _build_claim_items(doc, child_map.get(trans_no, []))
    doc.total_approved = approved_bhd


@frappe.whitelist()
def import_insurance_claims(master_file_url: str, child_file_url: str | None = None) -> dict:
    """Import legacy insurance claims (master + service lines) as TRICARE Insurance Claims.

    - ``master_file_url``: uploaded INSURANCE_00_01 Excel (one row per claim).
    - ``child_file_url``: uploaded INSURANCE_00_02 Excel (service lines, linked by TRANS_NUM).
    """
    from healthcare.api.patient_info_import import _require_admin

    _require_admin()
    if not master_file_url:
        frappe.throw(_("Master file is required"))

    _ensure_tricare()

    master_rows = _read_sheet_dicts(master_file_url)
    child_map: dict[str, list[dict]] = {}
    if child_file_url:
        for line in _read_sheet_dicts(child_file_url):
            key = _legacy_text(line.get("TRANS_NUM"))
            if key:
                child_map.setdefault(key, []).append(line)

    created = 0
    updated = 0
    submitted = 0
    skipped = 0
    patients_created = 0
    patients_insured = set()
    registers_created = 0
    errors: list[dict] = []

    processed = 0
    for row in master_rows:
        trans_no = _legacy_text(row.get("TRANS_NUM"))
        if not trans_no:
            skipped += 1
            continue

        existing = frappe.db.get_value(
            "Insurance Claim", {"trans_no": trans_no}, ["name", "docstatus"], as_dict=True
        )
        # Already-submitted claims are left untouched.
        if existing and existing.docstatus == 1:
            skipped += 1
            continue

        frappe.db.savepoint("ins_claim_row")
        try:
            patient_num = _legacy_num(row.get("PATIENT_NUM"))
            patient_existed = bool(patient_num) and frappe.db.exists("Patient", patient_num)
            patient = _resolve_patient_for_import(patient_num)

            if patient:
                if not patient_existed:
                    patients_created += 1
                _mark_patient_insured(patient)
                patients_insured.add(patient)
                _register_name, reg_created = _ensure_patient_register(patient)
                if reg_created:
                    registers_created += 1

            if existing:
                # Existing draft (e.g. from an earlier import): refresh + submit it.
                doc = frappe.get_doc("Insurance Claim", existing.name)
                _apply_master_to_claim(doc, row, patient, child_map)
                doc.flags.ignore_mandatory = True
                doc.save(ignore_permissions=True)
                doc.submit()
                updated += 1
                submitted += 1
            else:
                doc = frappe.new_doc("Insurance Claim")
                _apply_master_to_claim(doc, row, patient, child_map)
                doc.flags.ignore_mandatory = True
                doc.insert(ignore_permissions=True)
                # on_submit keeps the computed Paid / Partially Paid status.
                doc.submit()
                created += 1
                submitted += 1
        except Exception as exc:
            frappe.db.rollback(save_point="ins_claim_row")
            errors.append({"trans_no": trans_no, "error": str(exc)})
            frappe.log_error(
                title="Insurance Claim import failed",
                message=f"{trans_no}: {frappe.get_traceback()}",
            )
        else:
            processed += 1
            if processed % 50 == 0:
                frappe.db.commit()

    frappe.db.commit()

    return {
        "total_master_rows": len(master_rows),
        "created": created,
        "updated": updated,
        "submitted": submitted,
        "skipped": skipped,
        "patients_created": patients_created,
        "patients_insured": len(patients_insured),
        "registers_created": registers_created,
        "errors": errors[:50],
        "error_count": len(errors),
    }

