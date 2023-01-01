import frappe
from frappe import _

no_cache = 1

def get_context(context):
	context.no_cache = 1
	if frappe.session.user=='Guest':
		frappe.throw(_("You need to be logged in to access this page"), frappe.PermissionError)
	department = frappe.local.request.args.get('department')
	context.medical_departments = frappe.get_all("Healthcare Practitioner",
		fields = ["department"], filters={"department": ["!=", ""]}, group_by="department")
