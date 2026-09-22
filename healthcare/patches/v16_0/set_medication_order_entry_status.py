import frappe


def execute():
	"""Completion used to be a checkbox. Give every existing entry the status
	that checkbox stood for, so pending orders keep being picked up."""
	frappe.reload_doc("healthcare", "doctype", "inpatient_medication_order_entry")

	order_entry = frappe.qb.DocType("Inpatient Medication Order Entry")

	for is_completed, status in ((1, "Completed"), (0, "Pending")):
		(
			frappe.qb.update(order_entry)
			.set(order_entry.status, status)
			.where(order_entry.is_completed == is_completed)
		).run()
