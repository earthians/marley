import frappe

def get_context(context):
	context.selected_practitioner = frappe.local.request.args.get('practitioner')

@frappe.whitelist()
def book_appointment(practitioner, date, time):
	patient = frappe.db.get_value("Patient", {"user_id":frappe.session.user}, "name")
	frappe.get_doc({
		'doctype': 'Patient Appointment',
		'patient': patient,
		'practitioner': practitioner,
		'appointment_date': date,
		'appointment_time': time
	}).insert(ignore_permissions=True)
