import dateutil

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, month_diff


class ServiceRequestController(Document):
	def validate(self):
		self.set_medication_qty()
		self.calculate_total_dispensable_quantity()
		self.set_patient_age()
		self.set_order_details()
		self.set_title()

	def before_submit(self):
		if self.doctype == "Service Request":
			if self.status not in [
				"active-Request Status",
				"on-hold-Request Status",
				"unknown-Request Status",
			]:
				self.status = "active-Request Status"
		elif self.doctype == "Medication Request":
			if self.status not in [
				"active-Medication Request Status",
				"on-hold-Medication Request Status",
				"unknown-Medication Request Status",
			]:
				self.status = "active-Medication Request Status"

	def before_cancel(self):
		not_allowed = ["completed-Medication Request Status", "on-hold-Medication Request Status"]
		if self.status in not_allowed:
			frappe.throw(
				_("You cannot Cancel Service Request in {} status").format(", ".join(not_allowed)),
				title=_("Not Allowed"),
			)

	def on_cancel(self):
		if self.doctype == "Service Request":
			if self.status == "active-Request Status":
				self.db_set("status", "revoked-Request Status")
		elif self.doctype == "Medication Request":
			if self.status == "active-Medication Request Status":
				self.db_set("status", "cancelled-Medication Request Status")

	def set_patient_age(self):
		patient = frappe.get_doc("Patient", self.patient)
		self.patient_age_data = patient.get_age()
		if patient.dob:
			self.patient_age = int(month_diff(getdate(), getdate(patient.dob)) / 12)

	def set_medication_qty(self):
		if not self.doctype == "Medication Request":
			return

		quantity = 0

		if self.dosage:
			try:
				dosage = frappe.get_doc("Prescription Dosage", self.dosage)
			except frappe.DoesNotExistError:
				frappe.throw(_(f"Prescription Dosage {self.dosage} does not exist"))

			for item in dosage.dosage_strength:
				if item.strength and isinstance(item.strength, (int, float)):
					quantity += item.strength
			if self.period:
				try:
					period = frappe.get_doc("Prescription Duration", self.period)
				except frappe.DoesNotExistError:
					frappe.throw(_(f"Prescription Duration {self.period} does not exist"))

				days = period.get_days()
				if days and days > 0:
					quantity = quantity * days

			self.quantity = quantity or 1

	def calculate_total_dispensable_quantity(self):
		if not self.doctype == "Medication Request":
			return

		if self.number_of_repeats_allowed:
			self.total_dispensable_quantity = self.quantity + (self.number_of_repeats_allowed * self.quantity)
		else:
			self.total_dispensable_quantity = self.quantity


@frappe.whitelist()
def set_request_status(doctype, request, status):
	frappe.db.set_value(doctype, request, "status", status)
