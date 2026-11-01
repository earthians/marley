# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, now_datetime

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
		DoseReferences(self).validate()
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
		"""Who dealt with the dose is the login that closed it - an audit fact
		taken from the session, never from the document, and kept as it was
		stamped from then on."""
		if self.status not in CLOSED_STATUSES:
			return

		before = self.get_doc_before_save()
		if before and before.status in CLOSED_STATUSES:
			self.administered_by = before.administered_by
			return

		if not self.administered_time:
			self.administered_time = now_datetime()
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
		if self.status != "Given" or self.stock_entry or not self.inpatient_record:
			return

		if not self.stock_is_at_the_bed():
			return

		stock_entry = WardIssue(self.inpatient_record, self.ward_warehouse()).record([self.as_issued_item()])
		self.db_set("stock_entry", stock_entry)
		self.complete_order_entry()

	def stock_is_at_the_bed(self):
		"""Once the pharmacy has transferred the drug to the bed it has to be
		issued from there, whatever the setting says now; switching the
		setting off afterwards must not strand it."""
		if self.order_entry:
			return (
				frappe.db.get_value("Inpatient Medication Order Entry", self.order_entry, "status")
				== "Transferred"
			)
		return bool(manages_medication_stock())

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


class DoseReferences:
	"""The admission, order and order entry a dose points at must be this
	patient's and this drug's. Stock is issued to and billed against the
	admission, and the entry is marked Completed, on the strength of these
	links - so they are checked before any of that can happen."""

	def __init__(self, dose):
		self.dose = dose

	def validate(self):
		self.check_admission()
		self.check_order()
		self.check_order_entry()

	def check_admission(self):
		if not self.dose.inpatient_record:
			return
		if self.dose.patient != frappe.db.get_value(
			"Inpatient Record", self.dose.inpatient_record, "patient"
		):
			self.refuse(_("Admission {0} is not {1}'s").format(self.dose.inpatient_record, self.dose.patient))

	def check_order(self):
		if not self.dose.order_name:
			return
		if self.dose.order_doctype != "Inpatient Medication Order":
			self.refuse(_("A dose is scheduled from an Inpatient Medication Order"))

		order = frappe.db.get_value(
			"Inpatient Medication Order", self.dose.order_name, ["patient", "inpatient_record"], as_dict=True
		)
		if not order or order.patient != self.dose.patient:
			self.refuse(_("Order {0} is not {1}'s").format(self.dose.order_name, self.dose.patient))
		if self.dose.inpatient_record and order.inpatient_record != self.dose.inpatient_record:
			self.refuse(
				_("Order {0} is not for admission {1}").format(
					self.dose.order_name, self.dose.inpatient_record
				)
			)

	def check_order_entry(self):
		if not self.dose.order_entry:
			return
		if not self.dose.order_name:
			self.refuse(_("An order entry needs its order"))

		entry = frappe.db.get_value(
			"Inpatient Medication Order Entry",
			self.dose.order_entry,
			["parent", "drug", "dosage"],
			as_dict=True,
		)
		if not entry or entry.parent != self.dose.order_name:
			self.refuse(
				_("Entry {0} is not on order {1}").format(self.dose.order_entry, self.dose.order_name)
			)
		if entry.drug != self.dose.drug_code:
			self.refuse(
				_("Entry {0} is for {1}, not {2}").format(
					self.dose.order_entry, entry.drug, self.dose.drug_code
				)
			)
		if flt(entry.dosage) != flt(self.dose.dosage):
			self.refuse(
				_("Entry {0} prescribes {1}, not {2}").format(
					self.dose.order_entry, entry.dosage, self.dose.dosage
				)
			)

	def refuse(self, message):
		frappe.throw(message, title=_("Dose Does Not Match Its Order"))
