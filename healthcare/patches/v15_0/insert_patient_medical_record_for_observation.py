import frappe
from healthcare.healthcare.doctype.observation.observation import (get_observation_details, set_observation_html, create_medical_record)
from healthcare.healthcare.page.patient_history.patient_history import get_patient_history_doctypes

def execute():
	dianost_list = frappe.db.get_all("Diagnostic Report", pluck="name")
	for diagnostic_report in dianost_list:
		daig_doc = frappe.get_doc("Diagnostic Report", diagnostic_report)
		if daig_doc.doctype not in get_patient_history_doctypes():
			return
		if diagnostic_report:
			daig_data = get_observation_details(diagnostic_report, observation_status="Approved")
			if daig_data:
				obs_html = set_observation_html(daig_data)
				if obs_html:
					exist = frappe.db.exists("Patient Medical Record", {"reference_name": diagnostic_report})
					if exist:
						frappe.db.set_value("Patient Medical Record", exist, "subject", obs_html)
					else:
						create_medical_record(daig_doc, obs_html)