import frappe


def execute():
	therapy_plans = frappe.db.get_all("Therapy Plan", pluck="name")

	for plan in therapy_plans:
		encounter = frappe.db.exists("Patient Encounter", {"therapy_plan": plan}, "name")
		if encounter:
			frappe.db.set_value(
				"Therapy Plan",
				plan,
				{"source_doc": "Patient Encounter", "order_group": encounter},
				update_modified=False,
			)
