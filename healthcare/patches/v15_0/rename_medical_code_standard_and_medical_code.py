import frappe
from frappe.model.utils.rename_field import rename_field


def execute():
	doctypes = {
		"Medical Code Standard": "Code System",
		"Medical Code": "Code Value",
	}
	for old, new in doctypes.items():
		if frappe.db.exists("DocType", old) and not frappe.db.exists("DocType", new):
			frappe.rename_doc("DocType", old, new, force=True)
			frappe.reload_doc("healthcare", "doctype", new)

	try:
		rename_field("Code System", "medical_code", "code_system")

		rename_field("Code Value", "medical_code_standard", "code_system")
		rename_field("Code Value", "code", "code_value")
		rename_field("Code Value", "description", "definition")

		frappe.reload_doc("healthcare", "doctype", "Codification Table")
		rename_field("Codification Table", "medical_code_standard", "code_system")
		rename_field("Codification Table", "medical_code", "code_value")
		rename_field("Codification Table", "description", "definition")

		frappe.reload_doc("healthcare", "doctype", "Healthcare Settings")
		rename_field("Healthcare Settings", "default_medical_code_standard", "default_code_system")

	except Exception as e:
		if e.args[0] != 1054:
			raise
