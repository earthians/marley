import frappe
from frappe import _

no_cache = 1

def get_context(context):
	context.no_cache = 1
	if frappe.session.user=='Guest':
		frappe.throw(_("You need to be logged in to access this page"), frappe.PermissionError)
	context.practitioner = frappe.local.request.args.get('practitioner')

@frappe.whitelist()
def book_appointment(practitioner, date, time):
	patient = frappe.db.get_value("Patient", {"user_id":frappe.session.user}, "name")
	if patient:
		appointment = frappe.get_doc({
			'doctype': 'Patient Appointment',
			'patient': patient,
			'practitioner': practitioner,
			'appointment_date': date,
			'appointment_time': time
		}).insert(ignore_permissions=True)
		return appointment
	else:
		frappe.msgprint(_("No patient found for {0}").format(frappe.session.user))
