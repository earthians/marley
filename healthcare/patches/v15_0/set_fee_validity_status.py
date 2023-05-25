import frappe


def execute():
	validities = frappe.db.get_all("Fee Validity", {"status": "Pending"}, as_list=0)

	for fee_validity in validities:
		frappe.db.set_value("Fee Validity", fee_validity, "status", "Active")
