import frappe


def execute():
	frappe.reload_doctype("Codification Table", force=True)
	frappe.reload_doctype("Medical Code Standard", force=True)

	doctypes = [
		"Lab Test",
		"Clinical Procedure",
		"Therapy Session",
		"Lab Test Template",
		"Clinical Procedure Template",
		"Therapy Type",
	]

	for doctype in doctypes:
		if frappe.db.has_column(doctype, "medical_code"):
			data = frappe.db.get_all(
				doctype,
				filters={"medical_code": ["!=", ""]},
				fields=["name", "medical_code"],
			)
			frappe.reload_doctype(doctype, force=True)
			for d in data:
				frappe.get_doc(
					{
						"doctype": "Codification Table",
						"parent": d["name"],
						"parentfield": "codification_table",
						"parenttype": doctype,
						"medical_code": d["medical_code"],
						"medical_code_standard": frappe.db.get_value(
							"Medical Code", d["medical_code"], "medical_code_standard"
						),
					}
				).insert()
