# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils.nestedset import rebuild_tree


def execute():
	"""Medication Class became a tree. Existing classes stay as roots with valid lft and rgt."""
	frappe.reload_doc("healthcare", "doctype", "medication_class")
	rebuild_tree("Medication Class")
