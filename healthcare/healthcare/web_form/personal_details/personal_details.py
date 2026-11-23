import frappe
from frappe import _

from healthcare.healthcare.web_form.portal_patient import get_portal_patient, is_portal_patient

no_cache = 1


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.throw(_("You need to be logged in to access this page"), frappe.PermissionError)

	context.show_sidebar = True

	patient = get_portal_patient()
	if patient:
		context.doc = frappe.get_doc("Patient", patient)
		frappe.form_dict.new = 0
		frappe.form_dict.name = patient


def has_website_permission(doc, ptype, user, verbose=False):
	return is_portal_patient(doc.name, user)
