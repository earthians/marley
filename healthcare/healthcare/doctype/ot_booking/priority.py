# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _

PRIORITY_CODE_SYSTEM = "Priority"


def priority_code(priority):
	if not priority:
		return ""
	return frappe.db.get_value("Code Value", priority, "code_value", cache=True) or ""


def is_emergency(priority):
	return priority_code(priority).upper() == "STAT"


def add_priority(rows):
	for row in rows:
		row.priority_label = priority_code(row.priority)
		row.is_emergency = is_emergency(row.priority)


def priority_named(code):
	return frappe.db.get_value("Code Value", {"code_system": PRIORITY_CODE_SYSTEM, "code_value": code})


def set_priority(booking):
	if not booking.priority:
		booking.priority = priority_named("Routine")
	elif frappe.db.get_value("Code Value", booking.priority, "code_system") != PRIORITY_CODE_SYSTEM:
		frappe.throw(
			_("Priority {0} is not a code of the {1} code system").format(
				frappe.bold(booking.priority), PRIORITY_CODE_SYSTEM
			)
		)
