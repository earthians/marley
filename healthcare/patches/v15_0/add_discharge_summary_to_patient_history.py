import json

import frappe


def execute():
	if not frappe.db.exists("Patient History Standard Document Type", {"document_type": "Discharge Summary"}):
		settings = frappe.get_single("Patient History Settings")
		selected_fields = [
			{
				"label": "Chief Complaint",
				"fieldname": "chief_complaint",
				"fieldtype": "Table MultiSelect",
			},
			{"label": "Current Issues", "fieldname": "current_issues", "fieldtype": "Text Editor"},
			{"label": "Diagnosis", "fieldname": "diagnosis", "fieldtype": "Table MultiSelect"},
			{"label": "Diet Adviced", "fieldname": "diet_adviced", "fieldtype": "Text Editor"},
			{"label": "Instructions", "fieldname": "instructions", "fieldtype": "Text Editor"},
			{
				"label": "Healthcare Practitioner (Primary)",
				"fieldname": "primary_practitioner",
				"fieldtype": "Link",
			},
			{
				"label": "Healthcare Practitioner (Secondary)",
				"fieldname": "secondary_practitioner",
				"fieldtype": "Link",
			},
			{
				"label": "Advice on Discharge",
				"fieldname": "advice_on_discharge",
				"fieldtype": "Text Editor",
			},
			{
				"label": "Physical Examination",
				"fieldname": "physical_examination",
				"fieldtype": "Text Editor",
			},
			{"label": "Review Date", "fieldname": "review_date", "fieldtype": "Date"},
			{
				"label": "Discharging Practitioner",
				"fieldname": "discharge_practitioner",
				"fieldtype": "Link",
			},
			{"label": "Followup Date", "fieldname": "followup_date", "fieldtype": "Date"},
		]

		settings.append(
			"standard_doctypes",
			{
				"document_type": "Discharge Summary",
				"date_fieldname": "posting_date",
				"selected_fields": json.dumps(selected_fields),
			},
		)
		settings.save()
