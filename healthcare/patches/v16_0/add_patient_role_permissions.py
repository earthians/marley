import frappe


def execute():
	custom_permissions = [
		{
			"parent": "Sales Invoice",
			"role": "Patient",
			"print": 1,
			"read": 0,
			"export": 0,
		},
		{
			"parent": "Customer",
			"role": "Patient",
			"read": 1,
			"export": 0,
		},
		{
			"parent": "Observation",
			"role": "Patient",
			"read": 1,
			"export": 0,
		},
		{
			"parent": "Diagnostic Report",
			"role": "Patient",
			"print": 1,
			"read": 0,
			"export": 0,
		},
	]

	for perm in custom_permissions:
		if not frappe.db.exists("Custom DocPerm", perm):
			doc = frappe.new_doc("Custom DocPerm")
			doc.update(perm)
			doc.insert(ignore_permissions=True)
