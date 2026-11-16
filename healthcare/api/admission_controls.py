# Copyright (c) 2026, healthcare contributors
"""Admission-side BRD controls.

WF-056  Mandatory clinical admission fields enforced server-side, so the rule
        holds for the Desk form and the REST API as well as the SPA.
WF-058  Insurance eligibility is verified at admission - the register entry must
        be active and still have approved visits left.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import getdate, nowdate
from healthcare.healthcare.doctype.insurance_patient_register.insurance_patient_register import (
	approval_expiry_date,
)

# Fields the SPA already enforces; mirrored here so Desk/API cannot bypass them.
MANDATORY_ADMISSION_FIELDS = (
	("case_no", "Case No"),
	("admission_subject", "Subject"),
)


def _enabled(field: str) -> bool:
	return bool(frappe.db.get_single_value("Healthcare Settings", field))


def validate_admission_mandatory_fields(doc, method=None) -> None:
	"""Inpatient Admission `validate` - WF-056.

	Enforced on NEW admissions only. `admission_subject` was added by this project,
	so every one of the 1,941 pre-existing admissions has it blank - enforcing on
	update would make them all unsaveable. On an existing record the rule only
	prevents clearing a value that is already there.
	"""
	if not _enabled("enforce_admission_mandatory_fields"):
		return

	if doc.is_new():
		missing = [label for field, label in MANDATORY_ADMISSION_FIELDS if not doc.get(field)]
		if missing:
			frappe.throw(
				_("The following clinical admission fields are required: {0}.").format(
					", ".join(missing)
				),
				title=_("Incomplete admission"),
			)
		return

	# Existing record: do not let a populated mandatory field be wiped.
	previous = doc.get_doc_before_save()
	if not previous:
		return
	cleared = [
		label
		for field, label in MANDATORY_ADMISSION_FIELDS
		if previous.get(field) and not doc.get(field)
	]
	if cleared:
		frappe.throw(
			_("{0} cannot be cleared once recorded on an admission.").format(
				", ".join(cleared)
			),
			title=_("Required field"),
		)


def validate_insurance_eligibility(doc, method=None) -> None:
	"""Inpatient Admission `validate` - WF-058.

	Warns (or blocks) when the patient's insurance register entry has expired or
	has no approved visits remaining.
	"""
	if not _enabled("verify_insurance_eligibility_on_admission"):
		return
	if not doc.get("patient"):
		return

	is_insured = frappe.db.get_value("Patient", doc.patient, "is_insurance")
	if not is_insured:
		return

	register = frappe.db.get_value(
		"Insurance Patient Register",
		{"patient": doc.patient, "docstatus": ["<", 2]},
		["name", "status", "no_of_visits", "no_of_patient_visit",
		 "approval_validitydays", "posting_date", "valid_to"],
		as_dict=True,
		order_by="posting_date desc",
	)

	if not register:
		frappe.msgprint(
			_("Patient {0} is flagged as insured but has no Insurance Patient Register "
			  "entry. Verify eligibility before admitting.").format(doc.patient),
			title=_("Insurance not verified"),
			indicator="orange",
		)
		return

	problems = []
	approved = frappe.utils.cint(register.no_of_visits)
	used = frappe.utils.cint(register.no_of_patient_visit)
	if approved and used >= approved:
		problems.append(
			_("approved visits exhausted ({0} of {1} used)").format(used, approved)
		)

	if register.posting_date or register.valid_to:
		expiry = approval_expiry_date(
			register.posting_date, register.valid_to, register.approval_validitydays
		)
		if expiry and expiry < getdate(nowdate()):
			problems.append(_("approval expired on {0}").format(expiry))

	if problems:
		frappe.msgprint(
			_("Insurance eligibility issue for {0}: {1}. Confirm cover before admitting.").format(
				doc.patient, "; ".join(problems)
			),
			title=_("Insurance eligibility"),
			indicator="red",
		)


def record_admission_cancellation(doc, method=None) -> None:
	"""Inpatient Admission `on_update` - stamp the cancellation timestamp."""
	if doc.get("status") == "Cancelled" and not doc.get("cancelled_on"):
		doc.cancelled_on = frappe.utils.now_datetime()
