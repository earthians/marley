# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_link_to_form


class DischargeSummary(Document):
	@frappe.whitelist()
	def get_encounter_details(self):
		encounters = frappe.get_all(
			"Patient Encounter", {"inpatient_record": self.inpatient_record}, ["name"], pluck="name"
		)
		all_medication_requests = []
		all_service_requests = []
		for encounter in encounters:
			medication_requests = []
			service_requests = []
			filters = {"patient": self.patient, "docstatus": 1}
			if encounter:
				filters["order_group"] = encounter
			medication_requests = frappe.get_all("Medication Request", filters, ["*"])
			if medication_requests:
				all_medication_requests += medication_requests
			service_requests = frappe.get_all("Service Request", filters, ["*"])
			if service_requests:
				all_service_requests += service_requests
			for service_request in service_requests:
				if service_request.template_dt == "Lab Test Template":
					lab_test = frappe.db.get_value("Lab Test", {"service_request": service_request.name}, "name")
					if lab_test:
						subject = frappe.db.get_value(
							"Patient Medical Record", {"reference_name": lab_test}, "subject"
						)
						if subject:
							service_request["lab_details"] = subject

		return all_medication_requests, all_service_requests

	def validate(self):
		self.validate_encounter_impression()

	def on_submit(self):
		self.db_set("status", "Approved")

	def on_cancel(self):
		self.db_set("status", "Cancelled")

	def validate_encounter_impression(self):
		if frappe.db.exists("Patient Encounter", {"inpatient_record": self.inpatient_record}):
			encounter = frappe.get_last_doc(
				"Patient Encounter", filters={"inpatient_record": self.inpatient_record}
			)
			if encounter:
				if encounter.diagnosis:
					self.diagnosis = []
					for d in encounter.diagnosis:
						self.append("diagnosis", (frappe.copy_doc(d)).as_dict())
				if encounter.symptoms:
					self.chief_complaint = []
					for symptom in encounter.symptoms:
						self.append("chief_complaint", (frappe.copy_doc(symptom)).as_dict())


@frappe.whitelist()
def has_discharge_summary(inpatient_record):
	if frappe.db.exists("Discharge Summary", {"docstatus": 1, "inpatient_record": inpatient_record}):
		return True

	draft_summary = frappe.db.exists(
		"Discharge Summary", {"docstatus": 0, "inpatient_record": inpatient_record}
	)
	message = (
		_(
			f"A draft Discharge Summary exists. To proceed, please submit: {get_link_to_form('Discharge Summary', draft_summary)}"
		)
		if draft_summary
		else _("Please submit a Discharge Summary to proceed with discharging the patient.")
	)

	frappe.throw(message)
