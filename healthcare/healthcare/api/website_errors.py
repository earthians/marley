# Copyright (c) 2026, Abu Zahra Physical Therapy Center and contributors
# For license information, please see license.txt

import frappe
from frappe import _


def throw_validation(message):
	frappe.throw(_(message), title="validation")


def throw_server_error(message):
	frappe.local.response["http_status_code"] = 500
	frappe.throw(_(message), title="server_error")
