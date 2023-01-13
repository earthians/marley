import frappe
from frappe import _

no_cache = 1

class EmployeeUserDisabledError(frappe.ValidationError):
	pass

def get_context(context):
	context.no_cache = 1
	booking_allowed = frappe.get_cached_value(
		"Healthcare Settings", "None",
		"enable_appointment_booking_through_portal"
	)
	if not booking_allowed:
		frappe.throw(_("Portal appointment booking is not allowed"), frappe.PermissionError)

	if frappe.session.user=='Guest':
		frappe.throw(_("You need to be logged in to access this page"), frappe.PermissionError)
	# department = frappe.local.request.args.get('department')
	# context.medical_departments = frappe.get_all("Healthcare Practitioner",
	# 	fields = ["department"], filters={"department": ["!=", ""]}, group_by="department")
	query = """
		select
			md.name as department,
			md.image,
			md.description
		from
			`tabHealthcare Practitioner` as h_pract left join
			`tabMedical Department` as md on h_pract.department = md.name left join
			`tabPractitioner Service Unit Schedule` as sch on h_pract.name = sch.parent
		where
			md.show_in_website=1 and h_pract.status='Active' and sch.schedule!='' and  sch.service_unit!=''
		group by 
			md.name
	"""
	context.medical_departments = frappe.db.sql(query, as_dict=True)
