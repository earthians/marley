import frappe


def execute():
	appointment_types = frappe.db.get_all("Appointment Type")
	for at in appointment_types:
		frappe.db.set_value(
			"Appointment Type", at.name, "allow_booking_for", "Practitioner"
		)

	appointment_type_items = frappe.db.get_all("Appointment Type Service Item")
	for ati in appointment_type_items:
		frappe.db.set_value(
			"Appointment Type Service Item", ati.name, "dt", "Medical Department"
		)
