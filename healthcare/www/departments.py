import frappe
from frappe import _

no_cache = 1


class EmployeeUserDisabledError(frappe.ValidationError):
	pass


def get_context(context):
	context.no_cache = 1
	departments = []
	booking_allowed = frappe.get_cached_value(
		"Healthcare Settings", "None", "enable_appointment_booking_through_portal"
	)
	if not booking_allowed:
		frappe.throw(
			_("Portal appointment booking is not allowed"), frappe.PermissionError
		)

	if frappe.session.user == "Guest":
		frappe.throw(
			_("You need to be logged in to access this page"), frappe.PermissionError
		)

	practitioner = frappe.qb.DocType("Healthcare Practitioner")
	department = frappe.qb.DocType("Medical Department")
	schedule = frappe.qb.DocType("Practitioner Service Unit Schedule")

	departments = (
		frappe.qb.select(
			department.name.as_("department"),
			department.image,
			department.description,
			practitioner.name
		)
		.from_(practitioner)
		.left_join(department)
		.on(practitioner.department == department.name)
		.left_join(schedule)
		.on(practitioner.name == schedule.parent)
		.where(
			(department.show_in_website == 1)
			& (practitioner.status == "Active")
			& (schedule.schedule != "")
			& (schedule.service_unit != "")
		)
		.groupby(department.name)
	).run(as_dict=True)

	context.medical_departments = departments
