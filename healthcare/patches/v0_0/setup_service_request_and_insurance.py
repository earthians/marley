from __future__ import unicode_literals
import frappe
from healthcare.healthcare.setup import setup_service_request_masters, create_customer_groups
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from healthcare.healthcare.healthcare import data

def execute():
	frappe.reload_doc('healthcare', 'doctype', 'Patient Care Type')
	frappe.reload_doc('healthcare', 'doctype', 'Service Request Intent')
	frappe.reload_doc('healthcare', 'doctype', 'Service Request Priority')

	setup_service_request_masters()
	create_customer_groups()

	frappe.reload_doc('accounts', 'doctype', 'sales_invoice')
	frappe.reload_doc('accounts', 'doctype', 'sales_invoice_item')

	if data['custom_fields']:
		create_custom_fields(data['custom_fields'])
