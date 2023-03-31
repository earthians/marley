from __future__ import unicode_literals

import frappe

from healthcare.setup import setup_service_request_masters


def execute():
	frappe.reload_doc("healthcare", "doctype", "Patient Care Type")
	frappe.reload_doc("healthcare", "doctype", "Service Request Intent")
	frappe.reload_doc("healthcare", "doctype", "Service Request Priority")

	setup_service_request_masters()

	frappe.reload_doc("accounts", "doctype", "sales_invoice")
	frappe.reload_doc("accounts", "doctype", "sales_invoice_item")
