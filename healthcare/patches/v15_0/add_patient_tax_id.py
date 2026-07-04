import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


PATIENT_TAX_ID_FIELD = {
	"fieldname": "tax_id",
	"label": "TIN Number",
	"fieldtype": "Data",
	"insert_after": "patient_name",
	"unique": True,
	"description": "Patient taxpayer identification number used on billing documents.",
}


def execute():
	if frappe.db.exists("DocField", {"parent": "Patient", "fieldname": "tax_id"}):
		return
	if frappe.db.exists("Custom Field", {"dt": "Patient", "fieldname": "tax_id"}):
		return
	create_custom_fields({"Patient": [PATIENT_TAX_ID_FIELD]}, update=True)
