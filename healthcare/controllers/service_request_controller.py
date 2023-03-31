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
		if self.status not in ["Active", "On Hold", "Unknown"]:
			self.status = "Active"

	def before_cancel(self):
		not_allowed = ["Scheduled", "In Progress", "Completed", "On Hold"]
		if self.status in not_allowed:
			frappe.throw(
				_("You cannot Cancel Service Request in {} status").format(", ".join(not_allowed)),
				title=_("Not Allowed"),
			)

	def on_cancel(self):
		if self.status == "Active":
			self.db_set("status", "Cancelled")

	def set_patient_age(self):
		patient = frappe.get_doc("Patient", self.patient)
		self.patient_age_data = patient.get_age()
		self.patient_age = dateutil.relativedelta.relativedelta(getdate(), getdate(patient.dob))


@frappe.whitelist()
def set_request_status(doctype, request, status):
	frappe.db.set_value(doctype, request, "status", status)
