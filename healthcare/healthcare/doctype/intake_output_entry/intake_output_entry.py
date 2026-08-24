# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class IntakeOutputEntry(Document):
	def validate(self):
		self.validate_volume()
		self.set_recorded_by()

	def validate_volume(self):
		if self.volume is None or self.volume <= 0:
			frappe.throw(_("Volume must be greater than zero"))

	def set_recorded_by(self):
		if not self.user:
			self.user = frappe.session.user
