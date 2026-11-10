# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""What a refused change said, for a check or a step that reports it instead of raising it. A
refusal may hold several messages, such as a holiday and a blocked surgeon, which its error's
text does not show; they are in the messages it added."""

import frappe


def refusal_text(error, since):
	"""The refusal's own messages, from those added after the first `since` ones, which are then dropped"""
	texts = []
	for entry in frappe.local.message_log[since:]:
		message = entry.get("message") if isinstance(entry, dict) else entry
		texts.extend(message if isinstance(message, list | tuple) else [message])
	frappe.local.message_log = frappe.local.message_log[:since]
	return "; ".join(str(text) for text in texts if text) or str(error)
