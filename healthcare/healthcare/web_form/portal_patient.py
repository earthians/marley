import frappe


def get_portal_patient(user: str | None = None) -> str | None:
	return frappe.db.get_value("Patient", {"user_id": user or frappe.session.user}, "name")


def is_portal_patient(patient: str | None, user: str | None = None) -> bool:
	return bool(patient) and patient == get_portal_patient(user)
