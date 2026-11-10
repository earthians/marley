# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""An OT Booking's priority is a Code Value of the Priority code system, as on a Service Request
and a Clinical Procedure: STAT, ASAP, Urgent or Routine. Only STAT is an emergency."""

import frappe
from frappe import _

PRIORITY_CODE_SYSTEM = "Priority"


def priority_code(priority):
	"""The priority's code as written, such as STAT, or an empty string"""
	if not priority:
		return ""
	return frappe.db.get_value("Code Value", priority, "code_value", cache=True) or ""


def is_emergency(priority):
	return priority_code(priority).upper() == "STAT"


def priority_named(code):
	"""The Priority Code Value whose code is `code`, such as STAT or Routine"""
	return frappe.db.get_value("Code Value", {"code_system": PRIORITY_CODE_SYSTEM, "code_value": code})


def set_priority(booking):
	"""Routine unless given. The form's filter to the Priority code system works in the browser
	only, so the server refuses any other code."""
	if not booking.priority:
		booking.priority = priority_named("Routine")
	elif frappe.db.get_value("Code Value", booking.priority, "code_system") != PRIORITY_CODE_SYSTEM:
		frappe.throw(
			_("Priority {0} is not a code of the {1} code system").format(
				frappe.bold(booking.priority), PRIORITY_CODE_SYSTEM
			)
		)
