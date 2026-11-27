import frappe


def sync_email_to_patients(doc, method=None):
	if not doc.has_value_changed("email"):
		return
	patients = frappe.get_all(
		"Patient", filters={"user_id": doc.name, "email": ["!=", doc.email]}, pluck="name"
	)
	for patient in patients:
		update_patient_email(patient, doc.email)


def update_patient_email(patient_name: str, email: str):
	patient = frappe.get_doc("Patient", patient_name)
	patient.email = email
	# system-side sync: a portal user changing their own login email has no write access to Patient
	patient.save(ignore_permissions=True)
