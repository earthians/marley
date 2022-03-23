import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

def setup():
	make_custom_fields()


def make_custom_fields():
	custom_fields = get_custom_fields()
	create_custom_fields(custom_fields)


def get_custom_fields():
	custom_fields = {
	'Patient': [
			dict(
				fieldname='phr_address',
				label='PHR Address',
				fieldtype='Data',
				insert_after='status',
				read_only=1,
			),
			dict(
				fieldname='abha_number',
				label='ABHA Number',
				fieldtype='Data',
				insert_after='phr_address',
				read_only=1,
			)
		]
	}
	return custom_fields
