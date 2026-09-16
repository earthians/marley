# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, getdate


class CommissionPayslip(Document):
	def validate(self):
		if self.from_date and self.to_date and getdate(self.from_date) > getdate(self.to_date):
			frappe.throw(_("From Date cannot be after To Date"))
		self._recalc_totals()

	def _recalc_totals(self):
		"""Service amount, commission and distinct cases across the payslip lines.

		Each service line is split into one row per mode of payment, so a case is
		counted once per (branch, case #) — not once per payment mode row.
		"""
		total_service = 0.0
		total_commission = 0.0
		cases = set()
		for row in self.items or []:
			total_service += flt(row.service_amount)
			total_commission += flt(row.commission_amount)
			cases.add((row.cost_center or "", cint(row.case_index)))
		self.total_service_amount = total_service
		self.total_commission = total_commission
		self.total_cases = len(cases)
