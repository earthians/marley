import frappe


def execute():
	observations = frappe.db.get_all("Observation", filters={"status": "Disapproved"}, pluck="name")
	for obs in observations:
		frappe.db.set_value("Observation", obs, "status", "Rejected", update_modified=False)

	diagnostic_reports = frappe.db.get_all(
		"Diagnostic Report", filters={"status": "Disapproved"}, pluck="name"
	)
	for d in diagnostic_reports:
		frappe.db.set_value("Diagnostic Report", d, "status", "Rejected", update_modified=False)
