# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime


class NursingCarePlan(Document):
	def before_insert(self):
		self.started_by = frappe.session.user
		self.started_on = now_datetime()

	def validate(self):
		self.validate_single_active_plan()
		self.stamp_closure()

	def validate_single_active_plan(self):
		"""One live plan per admission; a second would split the goals."""
		if self.status != "Active" or not self.inpatient_record:
			return

		existing = frappe.db.exists(
			"Nursing Care Plan",
			{
				"inpatient_record": self.inpatient_record,
				"status": "Active",
				"name": ["!=", self.name or ""],
				"docstatus": ["<", 2],
			},
		)
		if existing:
			frappe.throw(_("This admission already has an active care plan: {0}").format(existing))

	def stamp_closure(self):
		if self.status == "Closed" and not self.closed_on:
			self.closed_on = now_datetime()
