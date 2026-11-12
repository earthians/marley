# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe


def refusal_text(error, since):
	"""The messages a refused change logged since `since`, taken off the log so they do not pop up"""
	texts = []
	for entry in frappe.local.message_log[since:]:
		message = entry.get("message") if isinstance(entry, dict) else entry
		texts.extend(message if isinstance(message, list | tuple) else [message])
	frappe.local.message_log = frappe.local.message_log[:since]
	return "; ".join(str(text) for text in texts if text) or str(error)
