# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cstr, getdate

from healthcare.healthcare.doctype.patient_encounter.patient_encounter import (
	get_prescription_dates,
)


class InpatientMedicationOrder(Document):
	def validate(self):
		self.validate_inpatient()
		self.validate_duplicate()
		self.set_total_orders()
		self.set_status()

	def on_submit(self):
		self.validate_inpatient()
		self.set_status()

	def on_cancel(self):
		self.set_status()

	def validate_inpatient(self):
		if not self.inpatient_record:
			frappe.throw(_("No Inpatient Record found against patient {0}").format(self.patient))

	def validate_duplicate(self):
		if not self.patient_encounter:
			return

		existing_mo = frappe.db.exists(
			"Inpatient Medication Order",
			{
				"patient_encounter": self.patient_encounter,
				"docstatus": ("!=", 2),
				"name": ("!=", self.name),
			},
		)
		if existing_mo:
			frappe.throw(
				_("An Inpatient Medication Order {0} against Patient Encounter {1} already exists.").format(
					existing_mo, self.patient_encounter
				),
				frappe.DuplicateEntryError,
			)

	def set_total_orders(self):
		self.db_set("total_orders", len(self.medication_orders))

	def update_completed_orders(self):
		"""Counted from the entries rather than tallied up and down, so cancelling
		or amending an Inpatient Medication Entry cannot drift the total."""
		completed = [entry for entry in self.medication_orders if entry.status == "Completed"]
		self.db_set("completed_orders", len(completed))
		self.set_status()

	def set_status(self):
		status = {"0": "Draft", "1": "Submitted", "2": "Cancelled"}[cstr(self.docstatus or 0)]

		if self.docstatus == 1:
			if not self.completed_orders:
				status = "Pending"
			elif self.completed_orders < self.total_orders:
				status = "In Process"
			else:
				status = "Completed"

		self.db_set("status", status)

	@frappe.whitelist()
	def add_order_entries(self, order):
		if not order.get("drug_code"):
			return

		dosage = frappe.get_doc("Prescription Dosage", order.get("dosage"))
		dates = get_prescription_dates(order.get("period"), self.start_date)
		drug_name = frappe.db.get_value("Item", order.get("drug_code"), "item_name")

		for date in dates:
			for dose in dosage.dosage_strength:
				if self.has_entry(order.get("drug_code"), date, dose.strength_time):
					continue

				entry = self.append("medication_orders")
				entry.drug = order.get("drug_code")
				entry.drug_name = drug_name
				entry.dosage = dose.strength
				entry.dosage_form = order.get("dosage_form")
				entry.date = date
				entry.time = dose.strength_time
				entry.medication_request = order.get("medication_request")

		self.end_date = dates[-1]

	def has_entry(self, drug, date, time):
		"""One dose per drug per slot, however many times the orders are pulled in."""
		return any(
			entry.drug == drug and getdate(entry.date) == getdate(date) and entry.time == time
			for entry in self.medication_orders
		)

	@frappe.whitelist()
	def get_from_encounter(self, encounter):
		"""Medication Requests are the order of record, so the schedule is built
		from them rather than from the encounter's prescription lines."""
		for request in get_medication_requests(encounter):
			self.add_order_entries(request)


def get_medication_requests(encounter):
	"""Active Medication Requests raised by an encounter, as order dictionaries."""
	requests = frappe.get_all(
		"Medication Request",
		filters={"order_group": encounter, "docstatus": ["<", 2]},
		fields=["name", "medication_item", "dosage", "dosage_form", "period"],
		order_by="creation asc",
	)

	return [
		{
			"drug_code": request.medication_item,
			"dosage": request.dosage,
			"dosage_form": request.dosage_form,
			"period": request.period,
			"medication_request": request.name,
		}
		for request in requests
		if request.medication_item and request.dosage and request.period
	]
