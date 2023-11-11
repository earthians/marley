import frappe
from frappe.model.utils.rename_field import rename_field


def execute():
	frappe.reload_doc("healthcare", "doctype", frappe.scrub("Healthcare Settings"))

	try:
		rename_field("Healthcare Settings", "automate_appointment_invoicing", "show_payment_popup")
	except Exception as e:
		if e.args and e.args[0]:
			raise
