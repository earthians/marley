from __future__ import unicode_literals
import frappe
from healthcare.setup import setup_healthcare_service_order_masters

def execute():
	frappe.reload_doc('healthcare', 'doctype', 'Patient Care Type')
	frappe.reload_doc('healthcare', 'doctype', 'Healthcare Service Order Intent')
	frappe.reload_doc('healthcare', 'doctype', 'Healthcare Service Order Priority')

	setup_healthcare_service_order_masters()

	frappe.reload_doc('accounts', 'doctype', 'sales_invoice')
	frappe.reload_doc('accounts', 'doctype', 'sales_invoice_item')
