from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
	custom_field = {
		"Sales Invoice Item": [
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
		"Sales Invoice": [
			{
				"fieldname": "service_unit",
				"label": "Service Unit",
				"fieldtype": "Link",
				"options": "Healthcare Service Unit",
				"insert_after": "customer_name",
			},
		],
	}

	create_custom_fields(custom_field)
