import frappe

from healthcare.healthcare.web_form.portal_patient import get_portal_patient, is_portal_patient


def get_context(context):
	context.read_only = 1


def get_list_context(context):
	context.row_template = "erpnext/templates/includes/healthcare/lab_test_row_template.html"
	context.get_list = get_lab_test_list


def get_lab_test_list(doctype, txt, filters, limit_start, limit_page_length=20, order_by="modified desc"):
	patient = get_portal_patient()
	lab_tests = frappe.db.sql(
		"""select * from `tabLab Test`
		where patient = %s order by result_date""",
		patient,
		as_dict=True,
	)
	return lab_tests


def has_website_permission(doc, ptype, user, verbose=False):
	return is_portal_patient(doc.patient, user)
