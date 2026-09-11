# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe


def execute():
	"""Every medication that existed before is_orderable was introduced stays orderable"""
	frappe.reload_doc("healthcare", "doctype", "medication")
	frappe.db.set_value("Medication", {"is_orderable": 0}, "is_orderable", 1, update_modified=False)
