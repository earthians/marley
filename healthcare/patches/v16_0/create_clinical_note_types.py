# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from healthcare.setup import create_clinical_note_types


def execute():
	frappe.reload_doc("healthcare", "doctype", "clinical_note_type")
	frappe.reload_doc("healthcare", "doctype", "clinical_note")
	create_clinical_note_types()
