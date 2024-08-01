from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
	custom_field = {
		"Payment Entry": [
			{
				"fieldname": "treatment_counselling",
				"label": "Treatment Counselling",
				"fieldtype": "Link",
				"options": "Treatment Counselling",
				"insert_after": "payment_order",
				"read_only": True,
			},
		]
	}

	create_custom_fields(custom_field)
