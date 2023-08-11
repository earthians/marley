import frappe
from frappe.model.utils.rename_field import rename_field


def execute():
	frappe.reload_doc("healthcare", "doctype", frappe.scrub("Healthcare Settings"))

	try:
		# Rename the field
		rename_field("Healthcare Settings", "automate_appointment_invoicing", "show_payment_popup")

		# Copy the value
		old_value = frappe.db.get_single_value("Healthcare Settings", "show_payment_popup")
		frappe.db.set_single_value(
			"Healthcare Settings", "show_payment_popup", 1 if old_value == 1 else 0
		)

	except Exception as e:
		if e.args and e.args[0]:
			raise
