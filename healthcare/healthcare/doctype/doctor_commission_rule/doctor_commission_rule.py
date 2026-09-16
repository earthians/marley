# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, getdate


class DoctorCommissionRule(Document):
	def validate(self):
		if self.valid_from and self.valid_to and getdate(self.valid_from) > getdate(self.valid_to):
			frappe.throw(_("Valid From cannot be after Valid To"))

		calc = self.calculation_type or "Percent of Amount"
		if calc == "Percent of Amount" and flt(self.commission_percent) <= 0:
			frappe.throw(_("Commission % is required for Percent of Amount rules"))
		if calc == "Fixed Per Case" and flt(self.fixed_amount) <= 0:
			frappe.throw(_("Fixed Amount Per Case is required for Fixed Per Case rules"))
		if calc == "Tiered by Cases":
			if flt(self.commission_percent) < 0:
				frappe.throw(_("Commission % cannot be negative"))
			if cint(self.tier_after_cases) <= 0:
				frappe.throw(_("Tier After Cases is required for Tiered by Cases rules"))
			if flt(self.tier_commission_percent) <= 0:
				frappe.throw(_("Tier Commission % is required for Tiered by Cases rules"))

		self._validate_payment_modes()

	def _validate_payment_modes(self):
		"""Payment mode shares must be unique with a positive weight each.

		Percentages are relative weights, not forced to total 100 — the shares are
		normalised by their own total when splitting a service line.
		"""
		rows = self.get("payment_modes") or []
		if not rows:
			return

		seen = set()
		for row in rows:
			mode = (row.mode_of_payment or "").strip()
			if not mode:
				frappe.throw(_("Mode of Payment is required on every Payment Modes row."))
			key = mode.casefold()
			if key in seen:
				frappe.throw(
					_("Mode of Payment {0} is listed more than once in Payment Modes.").format(mode)
				)
			seen.add(key)

			if flt(row.percent) <= 0:
				frappe.throw(
					_("Percent must be greater than zero for Mode of Payment {0}.").format(mode)
				)
