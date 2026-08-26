# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime

from healthcare.healthcare.doctype.healthcare_service_unit.healthcare_service_unit import (
	manages_medication_stock,
)
from healthcare.healthcare.ward_stock import WardIssue, WardStore

# Statuses that mean the dose was dealt with, whether or not it was given.
CLOSED_STATUSES = ("Given", "Held", "Refused", "Not Available")


class MedicationAdministration(Document):
	def before_insert(self):
		self.set_dose_key()

	def validate(self):
		self.set_drug_name()
		self.validate_reason()
		self.validate_not_already_issued()
		self.set_administered()

	def on_update(self):
		self.issue_from_the_ward()

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

	def validate_not_already_issued(self):
		"""Stock has left the ward and the patient has been billed for it, so the
		dose stands. Correct a mistake with a Stock Entry, not by editing this."""
		before = self.get_doc_before_save()
		if not before or not before.stock_entry:
			return

		if before.status != self.status:
			frappe.throw(
				_("{0} was given and issued from the ward, so it cannot be changed to {1}").format(
					frappe.bold(self.drug_name or self.drug_code), frappe.bold(_(self.status))
				),
				title=_("Dose Already Given"),
			)

	def issue_from_the_ward(self):
		"""A dose is billed when it reaches the patient, not when the drug was
		moved to the bed, so the stock leaves here rather than at transfer."""
		if self.status != "Given" or self.stock_entry:
			return

		if not manages_medication_stock() or not self.inpatient_record:
			return

		stock_entry = WardIssue(self.inpatient_record, self.ward_warehouse()).record([self.as_issued_item()])
		self.db_set("stock_entry", stock_entry)
		self.complete_order_entry()

	def ward_warehouse(self):
		warehouse = WardStore(self.inpatient_record).warehouse()
		if not warehouse:
			frappe.throw(
				_("The bed this patient occupies has no warehouse to issue medication from"),
				title=_("Nowhere to Issue From"),
			)

		return warehouse

	def as_issued_item(self):
		return {"item_code": self.drug_code, "quantity": self.dosage}

	def complete_order_entry(self):
		"""The order entry was left Transferred when the drug reached the bed."""
		if not self.order_entry:
			return

		frappe.db.set_value(
			"Inpatient Medication Order Entry",
			self.order_entry,
			{"status": "Completed", "is_completed": 1},
			update_modified=False,
		)

		if self.order_doctype == "Inpatient Medication Order" and self.order_name:
			frappe.get_doc("Inpatient Medication Order", self.order_name).update_completed_orders()
