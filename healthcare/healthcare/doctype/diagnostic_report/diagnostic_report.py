# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.model.workflow import get_workflow_name, get_workflow_state_field

from healthcare.healthcare.doctype.observation.observation import get_observation_details


class DiagnosticReport(Document):
	def validate(self):
		self.set_reference_details()
		self.set_age()
		self.set_title()
		# set_diagnostic_status(self)

	def before_insert(self):
		if self.ref_doctype == "Sales Invoice" and self.docname:
			self.practitioner = frappe.db.get_value(self.ref_doctype, self.docname, "ref_practitioner")

	def set_age(self):
		if not self.age:
			patient_doc = frappe.get_doc("Patient", self.patient)
			if patient_doc.dob:
				self.age = patient_doc.calculate_age(self.reference_posting_date).get("age_in_string")

	def set_title(self):
		self.title = f"{self.patient_name} - {self.age or ''} {self.gender}"

	def set_reference_details(self):
		if self.ref_doctype == "Sales Invoice" and self.docname:
			self.sales_invoice_status, self.reference_posting_date = frappe.db.get_value(
				"Sales Invoice", self.docname, ["status", "posting_date"]
			)


def diagnostic_report_print(diagnostic_report):
	return get_observation_details(diagnostic_report)


def validate_observations_has_result(doc):
	if doc.ref_doctype == "Sales Invoice":
		submittable = True
		observations = frappe.db.get_all(
			"Observation",
			{
				"sales_invoice": doc.docname,
				"docstatus": ["!=", 2],
				"has_component": False,
				"status": ["!=", "Cancelled"],
			},
			pluck="name",
		)
		for obs in observations:
			if not frappe.get_doc("Observation", obs).has_result():
				submittable = False
		return submittable


def set_diagnostic_status(doc):
	if doc.get("__islocal"):
		return
	observations = frappe.db.get_all(
		"Observation",
		{"sales_invoice": doc.docname, "docstatus": 0, "status": ["!=", "Approved"], "has_component": 0},
	)
	workflow_name = get_workflow_name("Diagnostic Report")
	workflow_state_field = get_workflow_state_field(workflow_name)
	if observations and len(observations) > 0:
		set_status = "Partially Approved"
	else:
		set_status = "Approved"
	doc.status = set_status
	doc.set(workflow_state_field, set_status)


@frappe.whitelist()
def set_observation_status(docname):
	doc = frappe.get_doc("Diagnostic Report", docname)
	if doc.ref_doctype == "Sales Invoice":
		observations = frappe.db.get_all(
			"Observation",
			{
				"sales_invoice": doc.docname,
				"docstatus": ["!=", 2],
				"has_component": False,
				"status": ["not in", ["Cancelled", "Approved", "Disapproved"]],
			},
			pluck="name",
		)
		if observations:
			for obs in observations:
				if doc.status in ["Approved", "Disapproved"]:
					observation_doc = frappe.get_doc("Observation", obs)
					if observation_doc.has_result():
						if doc.status == "Approved" and not observation_doc.status in ["Approved", "Disapproved"]:
							observation_doc.status = doc.status
							observation_doc.save().submit()
						if doc.status == "Disapproved" and observation_doc.status == "Approved":
							new_doc = frappe.copy_doc(observation_doc)
							new_doc.status = ""
							new_doc.insert()
							observation_doc.cancel()
