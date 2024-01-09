from __future__ import unicode_literals

import dateutil

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate


class ServiceRequestController(Document):
	def validate(self):
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
		self.patient_age = dateutil.relativedelta.relativedelta(getdate(), getdate(patient.dob))


@frappe.whitelist()
def set_request_status(doctype, request, status):
	frappe.db.set_value(doctype, request, "status", status)
