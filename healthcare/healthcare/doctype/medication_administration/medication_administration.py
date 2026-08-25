# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime

# Statuses that mean the dose was dealt with, whether or not it was given.
CLOSED_STATUSES = ("Given", "Held", "Refused", "Not Available")


class MedicationAdministration(Document):
	def before_insert(self):
		self.set_dose_key()

	def validate(self):
		self.set_drug_name()
		self.validate_reason()
		self.set_administered()

	def set_dose_key(self):
		"""One dose per patient, drug and slot, whichever order produced it."""
		self.dose_key = f"{self.patient}::{self.drug_code}::{self.scheduled_time}"

	def set_drug_name(self):
		if self.drug_code and not self.drug_name:
			self.drug_name = frappe.db.get_value("Item", self.drug_code, "item_name")

	def validate_reason(self):
		if self.status in ("Held", "Refused", "Not Available") and not self.reason:
			frappe.throw(_("Give a reason for a dose that was not administered"))

	def set_administered(self):
		if self.status not in CLOSED_STATUSES:
			return

		if not self.administered_time:
			self.administered_time = now_datetime()
		if not self.administered_by:
			self.administered_by = frappe.session.user
