# Copyright (c) 2026, Healthcare contributors
# See license.txt
"""Detect and remove Employee links that do not belong on a Customer.

``Customer.custom_employee`` / ``Customer.custom_employee_name`` are the klik_pos
fields that mark the Customer standing in for an *employee* (internal dispensing,
staff billing). By convention that Customer is named after the Employee ID and its
``customer_name`` equals the Employee name.

Patient Customers are sometimes stamped with the Employee of the user who
registered the patient (a receptionist), so a Patient shows up "linked to an
employee" although the two are different people. This module:

* compares the Customer name with the linked Employee name,
* drops the link when the names do not look the same (form button, save-time
  guard and a bulk cleanup for the rows that already exist).
"""

from __future__ import annotations

import re
import unicodedata

import frappe
from frappe import _
from frappe.utils import cint, cstr

EMPLOYEE_FIELD = "custom_employee"
EMPLOYEE_NAME_FIELD = "custom_employee_name"
PATIENT_LINK_FIELD = "customer"

NO_LINK = "no_employee_link"
NAMES_MATCH = "names_match"
EMPLOYEE_MISSING = "employee_missing"
NAME_MISMATCH = "name_mismatch"


def _has_customer_field(fieldname: str) -> bool:
	return frappe.db.has_column("Customer", fieldname)


def normalize_name(value) -> str:
	"""Case, accent, punctuation and whitespace insensitive form of a name."""
	text = unicodedata.normalize("NFKD", cstr(value))
	text = "".join(char for char in text if not unicodedata.combining(char))
	return " ".join(re.findall(r"[^\W_]+", text.casefold(), flags=re.UNICODE))


def names_look_same(customer_name, employee_name) -> bool:
	"""True when the Customer name and the Employee name describe one person.

	Exact names match, and so does a name that only adds/omits extra words
	(``AHMED SALEH`` vs ``AHMED SALEH IBRAHIM AL OBAILANI``), because the
	employee Customer name comes from ``Employee.employee_name``.
	"""
	left = normalize_name(customer_name)
	right = normalize_name(employee_name)
	if not left or not right:
		return False
	if left == right:
		return True
	left_tokens = set(left.split())
	right_tokens = set(right.split())
	return left_tokens <= right_tokens or right_tokens <= left_tokens


def _customer_row(customer: str) -> dict:
	fields = ["name", "customer_name"]
	if _has_customer_field(EMPLOYEE_FIELD):
		fields.append(EMPLOYEE_FIELD)
	if _has_customer_field(EMPLOYEE_NAME_FIELD):
		fields.append(EMPLOYEE_NAME_FIELD)

	row = frappe.db.get_value("Customer", customer, fields, as_dict=True)
	if not row:
		frappe.throw(_("Customer {0} not found").format(frappe.bold(customer)))
	return row



def get_employee_link_status(customer: str) -> dict:
	"""Describe the Customer → Employee link and whether it must be removed."""
	row = _customer_row(customer)
	employee = cstr(row.get(EMPLOYEE_FIELD)).strip()
	employee_name = cstr(row.get(EMPLOYEE_NAME_FIELD)).strip()
	customer_name = cstr(row.get("customer_name")).strip()

	employee_exists = bool(employee) and bool(frappe.db.exists("Employee", employee))
	if employee_exists and not employee_name:
		employee_name = cstr(frappe.db.get_value("Employee", employee, "employee_name")).strip()

	if not employee:
		reason = NO_LINK
	elif not employee_exists:
		reason = EMPLOYEE_MISSING
	elif names_look_same(customer_name, employee_name):
		reason = NAMES_MATCH
	else:
		reason = NAME_MISMATCH

	patient = frappe.db.get_value("Patient", {PATIENT_LINK_FIELD: customer}, "name")

	return {
		"customer": row.get("name"),
		"customer_name": customer_name,
		"employee": employee or None,
		"employee_name": employee_name or None,
		"employee_exists": employee_exists,
		"patient": patient or None,
		"reason": reason,
		"needs_unlink": reason in (EMPLOYEE_MISSING, NAME_MISMATCH),
	}


def _log_unlink(status: dict) -> None:
	message = _(
		"Employee {0} ({1}) was unlinked automatically: the Customer name {2} "
		"does not match the Employee name."
	).format(
		frappe.bold(status.get("employee") or ""),
		status.get("employee_name") or _("name not found"),
		frappe.bold(status.get("customer_name") or ""),
	)
	try:
		frappe.get_doc("Customer", status["customer"]).add_comment("Comment", message)
	except Exception:
		frappe.log_error(
			title=f"Customer employee unlink comment failed: {status['customer']}",
			message=frappe.get_traceback(),
		)


def unlink_employee_link(customer: str, add_comment: bool = True) -> dict:
	"""Remove ``custom_employee`` / ``custom_employee_name`` when the names differ."""
	status = get_employee_link_status(customer)
	status["unlinked"] = False
	if not status["needs_unlink"]:
		return status

	values = {EMPLOYEE_FIELD: None}
	if _has_customer_field(EMPLOYEE_NAME_FIELD):
		values[EMPLOYEE_NAME_FIELD] = None
	frappe.db.set_value("Customer", customer, values, update_modified=False)

	status["unlinked"] = True
	if add_comment:
		_log_unlink(status)
	return status


def unlink_mismatched_employee_on_validate(doc, method=None) -> None:
	"""``Customer.validate`` hook: never keep an Employee link that points elsewhere.

	The values are cleared on the in-memory document so the save writes NULL; a
	mere ``frappe.db.set_value`` would be overwritten by the same save.
	"""
	if not doc.meta.has_field(EMPLOYEE_FIELD):
		return

	employee = cstr(doc.get(EMPLOYEE_FIELD)).strip()
	if not employee:
		return

	employee_name = cstr(doc.get(EMPLOYEE_NAME_FIELD)).strip()
	if not employee_name:
		employee_name = cstr(frappe.db.get_value("Employee", employee, "employee_name")).strip()

	if names_look_same(doc.get("customer_name"), employee_name):
		return

	doc.set(EMPLOYEE_FIELD, None)
	if doc.meta.has_field(EMPLOYEE_NAME_FIELD):
		doc.set(EMPLOYEE_NAME_FIELD, None)

	if not (
		doc.flags.get("in_import") or doc.flags.get("in_patch") or doc.flags.get("in_migrate")
	):
		frappe.msgprint(
			_(
				"Employee {0} ({1}) was unlinked because the Customer name {2} does not "
				"match the Employee name."
			).format(
				frappe.bold(employee),
				employee_name or _("name not found"),
				frappe.bold(cstr(doc.get("customer_name"))),
			),
			title=_("Employee link removed"),
			indicator="orange",
			alert=True,
		)


@frappe.whitelist()
def get_customer_employee_status(customer: str) -> dict:
	"""Read-only status used by the Customer form button/indicator."""
	frappe.has_permission("Customer", "read", doc=customer, throw=True)
	return get_employee_link_status(customer)


@frappe.whitelist()
def unlink_mismatched_employee(customer: str) -> dict:
	"""Form button: unlink the Employee when the Customer name does not match."""
	frappe.has_permission("Customer", "write", doc=customer, throw=True)
	status = unlink_employee_link(customer)
	if status["unlinked"]:
		status["message"] = _("Employee {0} was unlinked from Customer {1}.").format(
			frappe.bold(status.get("employee") or ""), frappe.bold(status["customer"])
		)
	elif status["reason"] == NAMES_MATCH:
		status["message"] = _("Employee {0} matches the Customer name, so the link was kept.").format(
			frappe.bold(status.get("employee") or "")
		)
	else:
		status["message"] = _("This Customer has no Employee link to remove.")
	return status



def _require_cleanup_role() -> None:
	roles = set(frappe.get_roles())
	if not roles.intersection({"System Manager", "Healthcare Administrator"}):
		frappe.throw(
			_("Only System Manager or Healthcare Administrator can run this cleanup."),
			frappe.PermissionError,
		)


@frappe.whitelist()
def preview_cleanup_mismatched_customer_employees(only_patients=0) -> dict:
	"""Dry-run for Healthcare Settings → Update → Unlink mismatched Customer Employees."""
	return cleanup_mismatched_customer_employees(dry_run=1, only_patients=only_patients)


@frappe.whitelist()
def cleanup_mismatched_customer_employees(dry_run=1, only_patients=0) -> dict:
	"""Bulk pass over every Customer that still carries an Employee link.

	``dry_run=1`` (default) only reports what would be unlinked. ``only_patients=1``
	restricts the pass to Customers that a Patient is linked to. Run it from the
	bench with::

		bench --site <site> execute healthcare.api.customer_employee_cleanup.cleanup_mismatched_customer_employees --kwargs '{"dry_run": 0}'
	"""
	_require_cleanup_role()

	if not _has_customer_field(EMPLOYEE_FIELD):
		return {
			"dry_run": bool(cint(dry_run)),
			"scanned": 0,
			"unlinked": 0,
			"kept": 0,
			"errors": 0,
			"rows": [],
			"error_rows": [],
			"message": _("Customer has no Employee field (custom_employee). Nothing to clean."),
		}

	dry_run = cint(dry_run)
	only_patients = cint(only_patients)
	rows = frappe.get_all(
		"Customer",
		filters={EMPLOYEE_FIELD: ["is", "set"]},
		fields=["name"],
		order_by="name",
	)
	patient_customers = set()
	if only_patients:
		patient_customers = set(
			frappe.get_all(
				"Patient",
				filters={PATIENT_LINK_FIELD: ["in", [row.name for row in rows]]},
				pluck=PATIENT_LINK_FIELD,
			)
		)

	unlinked = []
	kept = []
	errors = []
	scanned = 0
	for row in rows:
		if only_patients and row.name not in patient_customers:
			continue
		scanned += 1
		try:
			status = get_employee_link_status(row.name) if dry_run else unlink_employee_link(row.name)
		except Exception:
			errors.append({"customer": row.name, "error": frappe.get_traceback()})
			continue
		if status["needs_unlink"]:
			unlinked.append(
				{
					"customer": status["customer"],
					"customer_name": status["customer_name"],
					"employee": status["employee"],
					"employee_name": status["employee_name"],
					"patient": status["patient"],
					"reason": status["reason"],
				}
			)
		else:
			kept.append(status["customer"])

	if not dry_run and unlinked:
		frappe.db.commit()

	return {
		"dry_run": bool(dry_run),
		"scanned": scanned,
		"unlinked": len(unlinked),
		"kept": len(kept),
		"errors": len(errors),
		"rows": unlinked[:100],
		"error_rows": errors[:20],
	}

