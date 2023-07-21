import frappe


def execute():
	docs = frappe.db.get_all("Appointment Type Service Item")
	for doc in docs:
		frappe.get_doc("Appointment Type Service Item", doc.name)
		if doc.dn:
			doc.db_set("dt", "Medical Department")
