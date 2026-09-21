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
		self.set_completed_orders()
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

	def set_completed_orders(self):
		self.completed_orders = len(
			[entry for entry in self.medication_orders if entry.status == "Completed"]
		)

	def update_completed_orders(self):
		"""Counted from the entries rather than tallied up and down, so cancelling
		or amending an Inpatient Medication Entry cannot drift the total."""
		self.set_completed_orders()
		self.db_set("completed_orders", self.completed_orders)
		self.set_status()

	def set_status(self):
		status = {"0": "Draft", "1": "Submitted", "2": "Cancelled"}[cstr(self.docstatus or 0)]

		if self.docstatus == 1:
			pending_orders = len(
				[entry for entry in self.medication_orders if entry.status in (None, "", "Pending")]
			)
			transferred_orders = len(
				[entry for entry in self.medication_orders if entry.status == "Transferred"]
			)

			if pending_orders == self.total_orders:
				status = "Pending"
			elif pending_orders or transferred_orders:
				status = "In Process"
			else:
				status = "Completed"

		self.db_set("status", status)

	@frappe.whitelist()
	def stop_medication_orders(self, entries: list[str] | str, stop_reason: str) -> None:
		if self.docstatus != 1:
			frappe.throw(_("Only submitted Inpatient Medication Orders can be stopped."))

		entries = frappe.parse_json(entries) if isinstance(entries, str) else entries
		entries = entries or []
		stop_reason = (stop_reason or "").strip()

		if not entries:
			frappe.throw(_("Please select at least one medication order to stop."))

		if not stop_reason:
			frappe.throw(_("Stop Reason is mandatory."))

		selected = set(entries)
		order_entry_statuses = frappe.get_all(
			"Inpatient Medication Order Entry",
			filters={"parent": self.name, "name": ["in", list(selected)]},
			fields=["name", "status"],
		)

		if len(order_entry_statuses) != len(selected):
			frappe.throw(_("Some selected medication rows do not belong to this order."))

		stale_entries = [entry.name for entry in order_entry_statuses if entry.status != "Pending"]
		if stale_entries:
			frappe.throw(
				_(
					"Some selected medication rows are no longer Pending. Please refresh the document and try again."
				)
			)

		order_entry = frappe.qb.DocType("Inpatient Medication Order Entry")
		(
			frappe.qb.update(order_entry)
			.set(order_entry.status, "Stopped")
			.set(order_entry.stop_reason, stop_reason)
			.where(order_entry.name.isin(list(selected)))
			.where(order_entry.parent == self.name)
			.where(order_entry.status == "Pending")
		).run()

		stopped_entries = frappe.get_all(
			"Inpatient Medication Order Entry",
			filters={
				"parent": self.name,
				"name": ["in", list(selected)],
				"status": "Stopped",
				"stop_reason": stop_reason,
			},
			pluck="name",
		)
		if len(stopped_entries) != len(selected):
			frappe.throw(
				_(
					"Some selected medication rows are no longer Pending. Please refresh the document and try again."
				)
			)

		self.reload()
		self.update_completed_orders()

	@frappe.whitelist()
	def add_order_entries(self, order: dict) -> None:
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
	def get_from_encounter(self, encounter: str) -> None:
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
