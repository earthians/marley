# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime


class ShiftHandover(Document):
	def before_insert(self):
		if not self.handed_over_by:
			self.handed_over_by = frappe.session.user

	def validate(self):
		self.validate_recipient()
		self.stamp_acceptance()

	def validate_recipient(self):
		"""A handover is to someone else; handing over to yourself records nothing."""
		if self.handed_over_to and self.handed_over_to == self.handed_over_by:
			frappe.throw(_("Hand over to the nurse taking the next shift"))

	def stamp_acceptance(self):
		if self.status != "Accepted":
			return

		if not self.accepted_by:
			self.accepted_by = frappe.session.user
		if not self.accepted_at:
			self.accepted_at = now_datetime()
