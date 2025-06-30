import frappe


def execute():
	# Update appointments with procedure_template
	update_template_links(
		doctype="Patient Appointment",
		source_field="procedure_template",
		template_dt="Clinical Procedure Template",
	)

	# Update appointments with therapy_type
	update_template_links(
		doctype="Patient Appointment", source_field="therapy_type", template_dt="Therapy Type"
	)


def update_template_links(doctype, source_field, template_dt):
	records = frappe.db.get_all(
		doctype, filters={source_field: ["is", "set"]}, fields=["name", source_field]
	)

	for record in records:
		frappe.db.set_value(
			doctype,
			record.name,
			{"template_dt": template_dt, "template_dn": record[source_field]},
			update_modified=False,
		)
