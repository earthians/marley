from frappe.model.utils.rename_field import rename_field


def execute():
	rename_field("Appointment Type Service Item", "medical_department", "dn")
