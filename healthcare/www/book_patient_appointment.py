import frappe
from frappe import _
from frappe.utils import today, add_days
from healthcare.healthcare.doctype.patient.patient import get_patients_from_user

no_cache = 1

def get_context(context):
	patients = []
	context.no_cache = 1
	if frappe.session.user=='Guest':
		frappe.throw(_("You need to be logged in to access this page"), frappe.PermissionError)
	else:
		patients = get_patients_from_user(frappe.session.user)
	context.patients = patients
	context.practitioner = frappe.local.request.args.get('practitioner')
	context.pract_details = frappe.db.get_value(
		"Healthcare Practitioner", context.practitioner,
		["image", "practitioner_name", "department"], as_dict=1)

	context.min_day = today()
	hcare_max_days = frappe.get_cached_value(
		"Healthcare Settings", "None",
		"number_of_days_appointments_can_be_booked_in_advance"
	)

	if not hcare_max_days:
		hcare_max_days = 30

	context.max_day = add_days(today(), hcare_max_days)


@frappe.whitelist()
def book_appointment(practitioner, patient, date, time, service_unit):
	if patient:
		appointment = frappe.get_doc({
			'doctype': 'Patient Appointment',
			'patient': patient,
			'practitioner': practitioner,
			'appointment_date': date,
			'appointment_time': time,
			'service_unit': service_unit,
		}).insert(ignore_permissions=True)
		if appointment:
			return appointment.name
	else:
		frappe.msgprint(_("No patient found for {0}").format(frappe.session.user))
