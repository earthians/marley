import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

def setup():
	if not frappe.db.exists('Custom Field', 'Patient-phr_address'):
		make_custom_fields()


def make_custom_fields():
	company = frappe.get_all("Company", filters={"country": "India"})
	if not company:
		return
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
			),
			dict(
				fieldname='abha_card',
				label='ABHA Card',
				fieldtype='Attach',
				insert_after='patient_details',
				hidden=1,
			),
			dict(
				fieldname='consent_for_aadhaar_use',
				label='Consent For Aadhaar Use',
				fieldtype='Attach',
				insert_after='abha_card',
				hidden=1,
			),
		]
	}
	return custom_fields
