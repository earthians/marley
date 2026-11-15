import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
	"""Keep Quotation Additional Services below Items (not under Include Observation).

	The fixture previously used insert_after=custom_package (same as Include Lab Tests),
	so every migrate put the table next to the package checkboxes. Re-assert insert_after=items.
	"""
	create_custom_fields(
		{
			"Quotation": [
				{
					"fieldname": "custom_additional_services",
					"label": "Additional Services",
					"fieldtype": "Table",
					"options": "Quotation Other Service",
					"insert_after": "items",
					"description": (
						"Additional Healthcare Service Templates selected for this "
						"inpatient admission. These do not create quotation items."
					),
				},
			],
		},
		update=True,
	)
	frappe.clear_cache(doctype="Quotation")
