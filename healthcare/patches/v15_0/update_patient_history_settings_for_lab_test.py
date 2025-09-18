import json

import frappe


def execute():
	settings = frappe.get_single("Patient History Settings")
	selected_fields = [
		{"label": "Test Template", "fieldname": "template", "fieldtype": "Link"},
		{"label": "Requesting Practitioner", "fieldname": "practitioner", "fieldtype": "Link"},
		{"label": "Test Name", "fieldname": "lab_test_name", "fieldtype": "Data"},
		{"label": "Lab Technician Name", "fieldname": "employee_name", "fieldtype": "Data"},
		{"label": "Sample ID", "fieldname": "sample", "fieldtype": "Link"},
		{"label": "Normal Test Result", "fieldname": "normal_test_items", "fieldtype": "Table"},
		{
			"label": "Descriptive Test Result",
			"fieldname": "descriptive_test_items",
			"fieldtype": "Table",
		},
		{"label": "Organism Test Result", "fieldname": "organism_test_items", "fieldtype": "Table"},
		{
			"label": "Sensitivity Test Result",
			"fieldname": "sensitivity_test_items",
			"fieldtype": "Table",
		},
		{"label": "Comments", "fieldname": "lab_test_comment", "fieldtype": "Text"},
	]

	for item in settings.standard_doctypes:
		if item.document_type == "Lab Test":
			item.selected_fields = json.dumps(selected_fields)

	settings.save()
