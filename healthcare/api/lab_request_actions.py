"""Lab Service Request lifecycle actions: delete, cancel, refund/credit, sample handling."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt, nowdate

LAB_TEMPLATE_DT = "Lab Test Template"

POST_SAMPLE_LAB_STATUSES = frozenset(
	{
		"Partial Result Enter",
		"Testing in Progress",
		"Completed",
		"Pending Review",
		"Reviewed",
		"Approved",
		"Rejected",
	}
)

SAMPLE_COLLECTED_LAB_STATUSES = frozenset(
	{
		"Sample Collected",
		"Sample Collection in Progress",
		"Sample collection in progress",
	}
)


def _require_lab_roles() -> None:
	frappe.only_for(
		(
			"System Manager",
			"Healthcare Administrator",
			"Receptionist",
			"Doctor",
			"Laboratory User",
			"LabTest Approver",
		)
	)


def _get_lab_service_request(name: str):
	sr = frappe.get_doc("Service Request", name)
	if sr.template_dt != LAB_TEMPLATE_DT:
		frappe.throw(_("This action is only available for lab test service requests."))
	if sr.docstatus == 2:
		frappe.throw(_("This lab request is already cancelled."))
	return sr


def _linked_lab_tests(service_request_name: str) -> list[dict]:
	return frappe.get_all(
		"Lab Test",
		filters={"service_request": service_request_name, "docstatus": ["!=", 2]},
		fields=["name", "status", "docstatus"],
		order_by="creation asc",
	)


def _lab_test_has_sample_collected(lab_test_name: str) -> bool:
	if cint(frappe.db.get_value("Lab Test", lab_test_name, "sample_collected")):
		return True
	if frappe.db.exists(
		"Lab Test Sample Instance",
		{"parent": lab_test_name, "parenttype": "Lab Test", "sample_collection": ["is", "set"]},
	):
		return True
	status = (frappe.db.get_value("Lab Test", lab_test_name, "status") or "").strip()
	return status in SAMPLE_COLLECTED_LAB_STATUSES


def _lab_test_past_sample_collection(lab_test: dict) -> bool:
	if cint(lab_test.get("docstatus")) == 1:
		return True
	status = (lab_test.get("status") or "").strip()
	return status in POST_SAMPLE_LAB_STATUSES


def _lab_request_phase(sr, lab_tests: list[dict]) -> str:
	if (sr.status or "").strip() == "revoked-Request Status":
		return "cancelled"

	if any(_lab_test_past_sample_collection(lt) for lt in lab_tests):
		return "post_sample"

	if any(_lab_test_has_sample_collected(lt["name"]) for lt in lab_tests):
		return "sample_collected"

	if cint(sr.booked):
		return "booked_pre_sample"

	if cint(sr.patient_accepted_cost):
		return "paid_not_booked"

	return "draft_unpaid"


def _can_delete_requested_lab_test(lab_test: dict | str) -> bool:
	if isinstance(lab_test, str):
		lab_test = frappe.db.get_value(
			"Lab Test",
			lab_test,
			["name", "status", "docstatus"],
			as_dict=True,
		) or {}
	if not lab_test:
		return False
	if cint(lab_test.get("docstatus")) != 0:
		return False
	if (lab_test.get("status") or "").strip() != "Requested":
		return False
	return not _lab_test_has_sample_collected(lab_test["name"])


def _can_edit_lab_request(phase: str, lab_tests: list[dict]) -> bool:
	"""Edit is allowed only before any linked lab test has sample collection."""
	if phase in ("sample_collected", "post_sample", "cancelled"):
		return False
	for lt in lab_tests or []:
		name = lt.get("name")
		if not name:
			continue
		if _lab_test_has_sample_collected(name) or _lab_test_past_sample_collection(lt):
			return False
	return True


def _lab_request_action_flags(phase: str, lab_tests: list[dict], requires_settlement: bool = False) -> dict:
	cancellable = phase in ("booked_pre_sample", "paid_not_booked")
	return {
		"can_delete": phase == "draft_unpaid",
		# Settlement choices only when SO → paid Sales Invoice.
		"can_cancel_with_settlement": cancellable and requires_settlement,
		"can_cancel_simple": cancellable and not requires_settlement,
		"requires_settlement": requires_settlement,
		"can_cancel_sample_handling": phase == "sample_collected",
		"can_delete_lab_tests": any(_can_delete_requested_lab_test(lt) for lt in lab_tests),
		"can_delete_lab_request": phase in ("draft_unpaid", "booked_pre_sample"),
		"can_edit_lab_request": _can_edit_lab_request(phase, lab_tests),
	}


def _sync_lab_test_sample_status(lab_test_doc) -> None:
	"""Align Lab Test status + sample_collected check with linked Sample Collections."""
	rows = lab_test_doc.get("sample_instances") or []
	if not rows:
		lab_test_doc.status = "Awaiting sample collection"
		if hasattr(lab_test_doc, "sample_collected"):
			lab_test_doc.sample_collected = 0
		return
	linked = sum(1 for row in rows if (getattr(row, "sample_collection", None) or "").strip())
	if linked <= 0:
		lab_test_doc.status = "Awaiting sample collection"
		if hasattr(lab_test_doc, "sample_collected"):
			lab_test_doc.sample_collected = 0
	elif linked < len(rows):
		lab_test_doc.status = "Sample Collection in Progress"
		if hasattr(lab_test_doc, "sample_collected"):
			lab_test_doc.sample_collected = 1
			_ensure_sample_collected_meta(lab_test_doc)
	else:
		lab_test_doc.status = "Sample Collected"
		if hasattr(lab_test_doc, "sample_collected"):
			lab_test_doc.sample_collected = 1
			_ensure_sample_collected_meta(lab_test_doc)


def _ensure_sample_collected_meta(lab_test_doc) -> None:
	"""Stamp collected date (and id from first linked Sample Collection) for notifications."""
	from frappe.utils import nowdate

	if hasattr(lab_test_doc, "sample_collected_date") and not lab_test_doc.get("sample_collected_date"):
		lab_test_doc.sample_collected_date = nowdate()
	if hasattr(lab_test_doc, "sample_collected_id") and not (lab_test_doc.get("sample_collected_id") or "").strip():
		for row in lab_test_doc.get("sample_instances") or []:
			sc = (getattr(row, "sample_collection", None) or "").strip()
			if sc:
				lab_test_doc.sample_collected_id = sc
				break


def _remove_lab_tests_from_visit(visit_name: str | None, lab_test_names: list[str]) -> None:
	if not visit_name or not lab_test_names:
		return
	if not frappe.db.exists("Patient Visit", visit_name):
		return
	visit = frappe.get_doc("Patient Visit", visit_name)
	keep = [row for row in (visit.get("lab_tests_charges") or []) if row.test_code not in lab_test_names]
	visit.set("lab_tests_charges", keep)
	visit.save(ignore_permissions=True)


def _delete_patient_medical_records_for_reference(reference_doctype: str, reference_name: str) -> list[str]:
	deleted: list[str] = []
	for name in frappe.get_all(
		"Patient Medical Record",
		filters={"reference_doctype": reference_doctype, "reference_name": reference_name},
		pluck="name",
	):
		frappe.delete_doc("Patient Medical Record", name, force=1, ignore_permissions=True)
		deleted.append(name)
	return deleted


def _cancel_or_delete_nursing_tasks_for_reference(reference_doctype: str, reference_name: str) -> list[str]:
	removed: list[str] = []
	for task in frappe.get_all(
		"Nursing Task",
		filters={"reference_doctype": reference_doctype, "reference_name": reference_name},
		fields=["name", "docstatus", "status"],
	):
		if not frappe.db.exists("Nursing Task", task.name):
			continue
		doc = frappe.get_doc("Nursing Task", task.name)
		if doc.docstatus == 1 and doc.status not in ("Cancelled", "Completed"):
			try:
				doc.cancel()
			except Exception:
				pass
		if frappe.db.exists("Nursing Task", task.name):
			frappe.delete_doc("Nursing Task", task.name, force=1, ignore_permissions=True)
		removed.append(task.name)
	return removed


def _delete_lab_test_dependencies(lab_test_name: str) -> dict:
	"""Remove linked records that block Lab Test deletion."""
	return {
		"patient_medical_records": _delete_patient_medical_records_for_reference("Lab Test", lab_test_name),
		"nursing_tasks": _cancel_or_delete_nursing_tasks_for_reference("Lab Test", lab_test_name),
	}


def _sales_order_name_for_sr(sr) -> str | None:
	if (getattr(sr, "reference_document_type", None) or "") != "Sales Order":
		return None
	so_name = (getattr(sr, "reference_document_name", None) or "").strip()
	return so_name or None


def _submitted_sales_invoices_for_sales_order(so_name: str) -> list[dict]:
	"""Submitted Sales Invoices created from this Sales Order."""
	so_name = (so_name or "").strip()
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
		names.append(parent)
	if not names:
		return []
	return frappe.get_all(
		"Sales Invoice",
		filters={"name": ["in", names], "docstatus": 1},
		fields=["name", "grand_total", "outstanding_amount", "status"],
	)


def _lab_request_requires_settlement(sr) -> bool:
	"""
	Settlement (patient credit / refund) is only needed when the Sales Order was
	converted to a Sales Invoice and that invoice is fully paid.
	"""
	so_name = _sales_order_name_for_sr(sr)
	if not so_name:
		return False
	for si in _submitted_sales_invoices_for_sales_order(so_name):
		grand = flt(si.get("grand_total"))
		outstanding = flt(si.get("outstanding_amount"))
		status = (si.get("status") or "").strip()
		if status == "Paid" or (grand > 0 and outstanding <= 0):
			return True
	return False


def _get_service_request_paid_amount(sr) -> float:
	"""Return cash already received against this lab request's SO / paid SI."""
	so_name = _sales_order_name_for_sr(sr)
	if not so_name or not frappe.db.exists("Sales Order", so_name):
		return 0

	# Prefer paid amount on submitted Sales Invoices from this SO.
	si_paid = 0.0
	for si in _submitted_sales_invoices_for_sales_order(so_name):
		grand = flt(si.get("grand_total"))
		outstanding = flt(si.get("outstanding_amount"))
		paid = max(grand - outstanding, 0)
		si_paid += paid
	if si_paid > 0:
		return si_paid

	advance_paid = flt(frappe.db.get_value("Sales Order", so_name, "advance_paid"))
	if advance_paid > 0:
		return advance_paid

	paid_rows = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(per.allocated_amount), 0)
		FROM `tabPayment Entry Reference` per
		INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
		WHERE per.reference_doctype = 'Sales Order'
		  AND per.reference_name = %s
		  AND pe.docstatus = 1
		  AND pe.payment_type = 'Receive'
		""",
		(so_name,),
	)
	return flt(paid_rows[0][0]) if paid_rows else 0


def _cancel_billing_for_service_request(sr) -> dict:
	"""Cancel/delete linked Sales Invoice(s) and Sales Order for this lab request."""
	from healthcare.api.service_request import _retire_lab_request_sales_order

	return _retire_lab_request_sales_order(sr)


def _cleanup_service_request_if_empty(
	sr_name: str,
	settlement_mode: str = "patient_credit",
) -> dict:
	"""Remove the lab request when no active lab tests remain."""
	remaining = _linked_lab_tests(sr_name)
	if remaining:
		return {"deleted_service_request": False, "service_request": sr_name}

	sr = _get_lab_service_request(sr_name)
	paid_amount = _get_service_request_paid_amount(sr)
	requires_settlement = _lab_request_requires_settlement(sr)
	billing = _cancel_billing_for_service_request(sr)
	so_name = billing.get("previous_sales_order")

	payment_entry = None
	# Auto patient-credit only when a paid invoice existed (same rule as cancel UI).
	if (
		settlement_mode == "patient_credit"
		and requires_settlement
		and paid_amount > 0
	):
		payment_entry = _apply_patient_credit(
			sr,
			paid_amount,
			f"Patient credit for deleted lab request {sr.name}",
		)

	deleted_sr = False
	if sr.docstatus == 0:
		_delete_patient_medical_records_for_reference("Service Request", sr_name)
		frappe.delete_doc("Service Request", sr_name, ignore_permissions=True)
		deleted_sr = True
	else:
		_delete_patient_medical_records_for_reference("Service Request", sr_name)
		_reset_service_request_after_cancel(sr)

	return {
		"deleted_service_request": deleted_sr,
		"service_request": sr_name,
		"sales_order": so_name,
		"payment_entry": payment_entry,
	}


def _delete_or_cancel_lab_test(lab_test_name: str) -> None:
	doc = frappe.get_doc("Lab Test", lab_test_name)
	if doc.docstatus == 1:
		frappe.throw(
			_("Lab Test {0} is submitted and cannot be removed.").format(frappe.bold(lab_test_name))
		)
	if doc.docstatus == 2:
		return
	if _lab_test_has_sample_collected(lab_test_name):
		frappe.throw(
			_("Lab Test {0} has sample collection recorded and cannot be deleted.").format(
				frappe.bold(lab_test_name)
			)
		)
	if (doc.status or "").strip() in POST_SAMPLE_LAB_STATUSES:
		frappe.throw(
			_("Lab Test {0} is in review/results and cannot be deleted.").format(
				frappe.bold(lab_test_name)
			)
		)
	_delete_lab_test_dependencies(lab_test_name)
	frappe.delete_doc("Lab Test", lab_test_name, ignore_permissions=True, force=True)


def _cancel_sales_order_for_service_request(sr) -> str | None:
	"""Back-compat wrapper — prefer `_cancel_billing_for_service_request`."""
	result = _cancel_billing_for_service_request(sr)
	return result.get("previous_sales_order")


def _patient_customer(patient: str) -> str:
	customer = frappe.db.get_value("Patient", patient, "customer")
	if not customer:
		frappe.throw(_("Patient {0} is not linked to a Customer for billing.").format(frappe.bold(patient)))
	return customer


def _default_mode_of_payment() -> str:
	mode = frappe.db.get_single_value("Healthcare Settings", "default_mode_of_payment")
	if mode and frappe.db.exists("Mode of Payment", mode):
		return mode
	return "Cash"


def _apply_patient_credit(sr, amount: float, remark: str) -> str | None:
	amount = flt(amount)
	if amount <= 0:
		return None
	customer = _patient_customer(sr.patient)
	company = sr.company or frappe.defaults.get_user_default("Company")
	if not company:
		frappe.throw(_("Company is required to create patient credit."))

	from healthcare.api.payment_entry import _resolve_accounts

	mode_of_payment = _default_mode_of_payment()
	paid_from, paid_to = _resolve_accounts(company, mode_of_payment)
	currency = frappe.get_cached_value("Company", company, "default_currency") or frappe.defaults.get_global_default(
		"currency"
	)

	pe = frappe.new_doc("Payment Entry")
	pe.payment_type = "Receive"
	pe.party_type = "Customer"
	pe.party = customer
	pe.party_name = frappe.db.get_value("Customer", customer, "customer_name") or customer
	pe.company = company
	pe.posting_date = nowdate()
	pe.mode_of_payment = mode_of_payment
	pe.paid_from = paid_from
	pe.paid_to = paid_to
	pe.paid_from_account_currency = currency
	pe.paid_to_account_currency = currency
	pe.paid_amount = amount
	pe.received_amount = amount
	pe.source_exchange_rate = 1
	pe.target_exchange_rate = 1
	pe.difference_amount = 0
	pe.remarks = remark
	pe.reference_no = remark[:140]
	pe.reference_date = nowdate()
	pe.insert(ignore_permissions=True)
	pe.submit()
	return pe.name


def _reset_service_request_after_cancel(sr) -> None:
	sr.db_set(
		{
			"booked": 0,
			"patient_accepted_cost": 0,
			"reference_document_type": None,
			"reference_document_name": None,
			"status": "revoked-Request Status",
		}
	)


@frappe.whitelist()
def get_lab_request_actions(service_request_name: str) -> dict:
	"""Return allowed actions for a lab service request based on workflow phase."""
	_require_lab_roles()
	sr = _get_lab_service_request(service_request_name)
	lab_tests = _linked_lab_tests(sr.name)
	phase = _lab_request_phase(sr, lab_tests)
	requires_settlement = _lab_request_requires_settlement(sr)
	flags = _lab_request_action_flags(phase, lab_tests, requires_settlement=requires_settlement)
	return {
		"service_request": sr.name,
		"phase": phase,
		**flags,
		"lab_tests": [
			{
				"name": lt["name"],
				"status": lt.get("status"),
				"has_sample_collected": _lab_test_has_sample_collected(lt["name"]),
				"past_sample_collection": _lab_test_past_sample_collection(lt),
				"can_cancel_sample_handling": phase == "sample_collected"
				and not _lab_test_past_sample_collection(lt),
				"can_delete": _can_delete_requested_lab_test(lt),
			}
			for lt in lab_tests
		],
	}


@frappe.whitelist()
def delete_requested_lab_test(lab_test_name: str) -> dict:
	"""Delete a lab test in Requested status; remove the lab request when it was the last test."""
	_require_lab_roles()
	if not lab_test_name:
		frappe.throw(_("Lab Test name is required."))

	lab_test = frappe.db.get_value(
		"Lab Test",
		lab_test_name,
		["name", "status", "docstatus", "service_request"],
		as_dict=True,
	)
	if not lab_test:
		frappe.throw(_("Lab Test {0} was not found.").format(frappe.bold(lab_test_name)))
	if not _can_delete_requested_lab_test(lab_test):
		frappe.throw(
			_("Only draft lab tests in Requested status with no sample collection can be deleted.")
		)

	sr_name = (lab_test.service_request or "").strip()
	if not sr_name:
		frappe.throw(_("Lab Test is not linked to a Service Request."))

	sr = _get_lab_service_request(sr_name)
	linked_before = _linked_lab_tests(sr_name)
	visit_name = getattr(sr, "order_group", None) or getattr(sr, "patient_visit", None)

	# Keep lab_request_items JSON in sync when a child/single is removed.
	from healthcare.healthcare.lab_request_items import (
		parse_lab_request_items,
		remove_template_from_lab_request_items,
	)

	template = (frappe.db.get_value("Lab Test", lab_test_name, "template") or "").strip()
	if template and getattr(sr, "lab_request_items", None):
		items = remove_template_from_lab_request_items(parse_lab_request_items(sr), template)
		sr.lab_request_items = frappe.as_json(items) if items else None
		# Keep legacy selected_group_templates aligned for single-group requests.
		if hasattr(sr, "selected_group_templates"):
			if len(items) == 1 and (items[0].get("kind") or "").strip().lower() == "group":
				sr.selected_group_templates = frappe.as_json(items[0].get("children") or [])
			elif not items:
				sr.selected_group_templates = None
		sr.save(ignore_permissions=True)

	_delete_or_cancel_lab_test(lab_test_name)
	_remove_lab_tests_from_visit(visit_name, [lab_test_name])

	sr_cleanup = {"deleted_service_request": False, "service_request": sr_name}
	if len(linked_before) <= 1:
		sr_cleanup = _cleanup_service_request_if_empty(sr_name)

	frappe.db.commit()
	return {
		"deleted": True,
		"lab_test": lab_test_name,
		**sr_cleanup,
	}


@frappe.whitelist()
def delete_draft_lab_request(service_request_name: str) -> dict:
	"""Delete an unpaid draft lab request that has not been booked."""
	_require_lab_roles()
	sr = _get_lab_service_request(service_request_name)
	lab_tests = _linked_lab_tests(sr.name)
	phase = _lab_request_phase(sr, lab_tests)
	if phase != "draft_unpaid":
		frappe.throw(_("Only draft lab requests awaiting payment can be deleted."))
	if lab_tests:
		frappe.throw(_("This lab request already has linked lab tests and cannot be deleted."))

	frappe.delete_doc("Service Request", sr.name, ignore_permissions=True)
	frappe.db.commit()
	return {"deleted": True, "service_request": service_request_name}


@frappe.whitelist()
def cancel_booked_lab_request(service_request_name: str, settlement_mode: str | None = None) -> dict:
	"""Cancel a booked (or paid-not-booked) lab request.

	Settlement choices (patient credit / refund) are required only when the linked
	Sales Order has a fully paid Sales Invoice. Otherwise the request is cancelled
	and billing docs are retired without a settlement prompt.
	"""
	_require_lab_roles()
	sr = _get_lab_service_request(service_request_name)
	lab_tests = _linked_lab_tests(sr.name)
	phase = _lab_request_phase(sr, lab_tests)
	if phase not in ("booked_pre_sample", "paid_not_booked"):
		frappe.throw(_("This lab request cannot be cancelled at its current stage."))

	requires_settlement = _lab_request_requires_settlement(sr)
	settlement_mode = (settlement_mode or "").strip().lower() or None
	if requires_settlement:
		if settlement_mode not in ("refund", "patient_credit"):
			frappe.throw(_("Choose Patient Credit or Refund to settle the paid invoice."))
	else:
		# No paid invoice — skip settlement UI path.
		settlement_mode = None

	for lt in lab_tests:
		if _lab_test_has_sample_collected(lt["name"]) or _lab_test_past_sample_collection(lt):
			frappe.throw(
				_("Lab Test {0} already has sample collection or results and cannot be cancelled.").format(
					frappe.bold(lt["name"])
				)
			)

	lab_test_names = [lt["name"] for lt in lab_tests]
	for name in lab_test_names:
		_delete_or_cancel_lab_test(name)

	visit_name = getattr(sr, "order_group", None) or getattr(sr, "patient_visit", None)
	_remove_lab_tests_from_visit(visit_name, lab_test_names)

	credit_amount = flt(sr.grand_total) or flt(sr.cost) or 0
	paid_amount = _get_service_request_paid_amount(sr)
	billing = _cancel_billing_for_service_request(sr)
	so_name = billing.get("previous_sales_order")

	payment_entry = None
	if settlement_mode == "patient_credit" and paid_amount > 0:
		payment_entry = _apply_patient_credit(
			sr,
			min(paid_amount, credit_amount) if credit_amount > 0 else paid_amount,
			f"Patient credit for cancelled lab request {sr.name}",
		)

	_reset_service_request_after_cancel(sr)

	if sr.docstatus == 0:
		_delete_patient_medical_records_for_reference("Service Request", sr.name)
		frappe.delete_doc("Service Request", sr.name, ignore_permissions=True)
		deleted_sr = True
	else:
		_delete_patient_medical_records_for_reference("Service Request", sr.name)
		deleted_sr = False

	frappe.db.commit()
	return {
		"ok": True,
		"service_request": service_request_name,
		"deleted_service_request": deleted_sr,
		"settlement_mode": settlement_mode,
		"requires_settlement": requires_settlement,
		"sales_order": so_name,
		"cancelled_sales_invoices": billing.get("cancelled_sales_invoices") or [],
		"payment_entry": payment_entry,
		"lab_tests_removed": lab_test_names,
	}


def _unlink_lab_test_sample_collections(lab_test_doc) -> list[str]:
	"""Remove Sample Collection links from a Lab Test before deleting those documents."""
	unlinked: list[str] = []
	for row in lab_test_doc.get("sample_instances") or []:
		sc_name = (getattr(row, "sample_collection", None) or "").strip()
		if sc_name:
			row.sample_collection = None
			unlinked.append(sc_name)

	main_sample = (getattr(lab_test_doc, "sample", None) or "").strip()
	if main_sample:
		lab_test_doc.sample = None
		if main_sample not in unlinked:
			unlinked.append(main_sample)

	return list(dict.fromkeys(unlinked))


def _cancel_sample_collection_doc(sample_collection_name: str) -> None:
	if not sample_collection_name or not frappe.db.exists("Sample Collection", sample_collection_name):
		return
	doc = frappe.get_doc("Sample Collection", sample_collection_name)
	if doc.docstatus == 1:
		doc.cancel()
	elif doc.docstatus == 0:
		frappe.delete_doc(
			"Sample Collection",
			sample_collection_name,
			ignore_permissions=True,
			force=True,
		)


@frappe.whitelist()
def cancel_lab_sample_handling(service_request_name: str | None = None, lab_test_name: str | None = None) -> dict:
	"""Undo sample collection for sample-handling phase only (not after review/results)."""
	_require_lab_roles()

	if not service_request_name and not lab_test_name:
		frappe.throw(_("Service Request or Lab Test is required."))

	lab_test_names: list[str]
	if lab_test_name:
		sr_name = frappe.db.get_value("Lab Test", lab_test_name, "service_request")
		if not sr_name:
			frappe.throw(_("Lab Test is not linked to a Service Request."))
		lab_test_names = [lab_test_name]
		service_request_name = sr_name
	else:
		sr = _get_lab_service_request(service_request_name)
		lab_test_names = [lt["name"] for lt in _linked_lab_tests(sr.name)]

	sr = _get_lab_service_request(service_request_name)
	lab_tests = _linked_lab_tests(sr.name)
	phase = _lab_request_phase(sr, lab_tests)
	if phase != "sample_collected":
		frappe.throw(_("Sample handling can only be cancelled while samples are collected and before review/results."))

	cancelled_samples: list[str] = []
	for name in lab_test_names:
		lt = next((row for row in lab_tests if row["name"] == name), None)
		if not lt:
			continue
		if _lab_test_past_sample_collection(lt):
			frappe.throw(
				_("Lab Test {0} is in review/results and sample handling cannot be cancelled.").format(
					frappe.bold(name)
				)
			)

		doc = frappe.get_doc("Lab Test", name)
		sample_names = _unlink_lab_test_sample_collections(doc)
		_sync_lab_test_sample_status(doc)
		doc.save(ignore_permissions=True)

		for sc_name in sample_names:
			_cancel_sample_collection_doc(sc_name)
			cancelled_samples.append(sc_name)

	frappe.db.commit()
	return {
		"ok": True,
		"service_request": service_request_name,
		"lab_tests": lab_test_names,
		"sample_collections_cancelled": cancelled_samples,
	}
