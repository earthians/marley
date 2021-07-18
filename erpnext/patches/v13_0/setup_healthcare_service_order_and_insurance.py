
from __future__ import unicode_literals
import frappe
from erpnext.healthcare.setup import setup_healthcare_service_order_masters, create_customer_groups
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from erpnext.domains.healthcare import data

def execute():
	if "Healthcare" not in frappe.get_active_domains():
		return

	frappe.reload_doc('healthcare', 'doctype', 'Patient Care Type')
	frappe.reload_doc('healthcare', 'doctype', 'Healthcare Service Order Intent')
	frappe.reload_doc('healthcare', 'doctype', 'Healthcare Service Order Priority')

	setup_healthcare_service_order_masters()
	create_customer_groups()

	frappe.reload_doc('accounts', 'doctype', 'sales_invoice')
	frappe.reload_doc('accounts', 'doctype', 'sales_invoice_item')

	if data['custom_fields']:
		create_custom_fields(data['custom_fields'])
