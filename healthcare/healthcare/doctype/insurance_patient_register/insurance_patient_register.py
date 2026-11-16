# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_days, getdate, nowdate


class InsurancePatientRegister(Document):
	#: Fields that make up the approval window (owned by the Insurance team).
	VALIDITY_FIELDS = ("valid_from", "valid_to", "approval_validitydays")

	def validate(self):
		self.ensure_validity_window_owner()
		self.set_approval_validity_days()

	def ensure_validity_window_owner(self):
		"""Only the Insurance team may change the approval window — even in desk.

		Portal saves go through healthcare.api.common, which enforces the same
		rule; this guard covers direct desk edits by Reception and other roles
		that can update the register but should not touch its dates.
		"""
		if self.is_new():
			validity_touched = any(self.get(field) for field in self.VALIDITY_FIELDS)
		else:
			validity_touched = any(
				self.has_value_changed(field) for field in self.VALIDITY_FIELDS
			)
		if not validity_touched:
			return

		from healthcare.api.common import user_can_set_insurance_register_validity

		if not user_can_set_insurance_register_validity():
			frappe.throw(
				_(
					"Only users with access to the Insurance page can change Valid From, "
					"Valid To or Approval Validity (Days)."
				),
				frappe.PermissionError,
			)

	def set_approval_validity_days(self):
		"""Keep Approval Validity (Days) in step with Valid From / Valid To.

		Days are counted inclusively (1 Nov → 30 Nov = 30 days). Leaving either
		date empty keeps the manually entered day count untouched.
		"""
		if not (self.valid_from and self.valid_to):
			return
		try:
			valid_from = getdate(self.valid_from)
			valid_to = getdate(self.valid_to)
		except Exception:
			frappe.throw(_("Valid From and Valid To must be valid dates"))
		if valid_to < valid_from:
			frappe.throw(_("Valid To cannot be before Valid From"))
		self.approval_validitydays = (valid_to - valid_from).days + 1


def approval_expiry_date(posting_date=None, valid_to=None, approval_validitydays=0):
	"""Expiry date of an approval.

	Valid To wins when set (it is the source of truth once a validity window is
	recorded); otherwise fall back to Posting Date + Approval Validity (Days).
	"""
	if valid_to:
		try:
			return getdate(valid_to)
		except Exception:
			return None
	if posting_date and frappe.utils.cint(approval_validitydays):
		return add_days(getdate(posting_date), frappe.utils.cint(approval_validitydays))
	return None


def expire_unused_registers():
	"""Daily scheduler: mark Unused IPRs as Expired when approval validity has lapsed."""
	today = getdate(nowdate())
	registers = frappe.get_all(
		"Insurance Patient Register",
		filters={"status": "Unused", "docstatus": ["<", 2]},
		fields=["name", "posting_date", "valid_to", "approval_validitydays"],
	)
	for reg in registers:
		try:
			expiry_date = approval_expiry_date(
				reg.posting_date, reg.valid_to, reg.approval_validitydays
			)
			if expiry_date and expiry_date < today:
				frappe.db.set_value("Insurance Patient Register", reg.name, "status", "Expired")
		except Exception:
			frappe.log_error(
				title="IPR expiry error",
				message=frappe.get_traceback(),
			)
