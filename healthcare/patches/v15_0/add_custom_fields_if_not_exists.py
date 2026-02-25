from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

from healthcare.regional.india.abdm.setup import setup as abdm_setup


def execute():
	custom_field = {
		"Sales Invoice": [
			{
				"fieldname": "patient",
				"label": "Patient",
				"fieldtype": "Link",
				"options": "Patient",
				"insert_after": "naming_series",
			},
			{
				"fieldname": "patient_name",
				"label": "Patient Name",
				"fieldtype": "Data",
				"fetch_from": "patient.patient_name",
				"insert_after": "patient",
				"read_only": True,
			},
			{
				"fieldname": "ref_practitioner",
				"label": "Referring Practitioner",
				"fieldtype": "Link",
				"options": "Healthcare Practitioner",
				"insert_after": "customer",
			},
			{
				"fieldname": "service_unit",
				"label": "Service Unit",
				"fieldtype": "Link",
				"options": "Healthcare Service Unit",
				"insert_after": "customer_name",
			},
		],
		"Sales Invoice Item": [
			{
				"fieldname": "reference_dt",
				"label": "Reference DocType",
				"fieldtype": "Link",
				"options": "DocType",
				"insert_after": "edit_references",
			},
			{
				"fieldname": "reference_dn",
				"label": "Reference Name",
				"fieldtype": "Dynamic Link",
				"options": "reference_dt",
				"insert_after": "reference_dt",
			},
			{
				"fieldname": "practitioner",
				"label": "Practitioner",
				"fieldtype": "Link",
				"options": "Healthcare Practitioner",
				"insert_after": "reference_dn",
				"read_only": True,
			},
			{
				"fieldname": "medical_department",
				"label": "Medical Department",
				"fieldtype": "Link",
				"options": "Medical Department",
				"insert_after": "delivered_qty",
				"read_only": True,
			},
			{
				"fieldname": "service_unit",
				"label": "Service Unit",
				"fieldtype": "Link",
				"options": "Healthcare Service Unit",
				"insert_after": "medical_department",
				"read_only": True,
			},
		],
		"Stock Entry": [
			{
				"fieldname": "inpatient_medication_entry",
				"label": "Inpatient Medication Entry",
				"fieldtype": "Link",
				"options": "Inpatient Medication Entry",
				"insert_after": "credit_note",
				"read_only": True,
			}
		],
		"Stock Entry Detail": [
			{
				"fieldname": "patient",
				"label": "Patient",
				"fieldtype": "Link",
				"options": "Patient",
				"insert_after": "po_detail",
				"read_only": True,
			},
			{
				"fieldname": "inpatient_medication_entry_child",
				"label": "Inpatient Medication Entry Child",
				"fieldtype": "Data",
				"insert_after": "patient",
				"read_only": True,
			},
		],
	}

	create_custom_fields(custom_field)

	abdm_setup()
