import frappe


def execute():
	inpatient_records = frappe.get_all(
		"Inpatient Record", {"status": ("in", ["Admitted", "Discharge Scheduled"])}
	)

	for inpatient_record in inpatient_records:
		frappe.get_doc(
			"Inpatient Record", inpatient_record.name
		).add_service_unit_rent_to_billable_items()
