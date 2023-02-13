import frappe
import json
from frappe import _

no_cache = 1

def get_context(context):
	context.no_cache = 1
	if frappe.session.user=='Guest':
		frappe.throw(_("You need to be logged in to access this page"), frappe.PermissionError)
	selected_department = frappe.local.request.args.get('department')
	query = """
		select
			h_pract.name,
			h_pract.image,
			h_pract.practitioner_name,
			h_pract.department,
			h_pract.designation
		from
			`tabHealthcare Practitioner` as h_pract left join
			`tabPractitioner Service Unit Schedule` as sch on h_pract.name = sch.parent
		where
			sch.schedule!='' and h_pract.status='Active' and sch.service_unit!=''
			and h_pract.show_in_website=1
	"""
	if selected_department:
		context.department = selected_department
		query += f" and h_pract.department = '{selected_department}'"
	query += "group by h_pract.name"
	data = frappe.db.sql(query, as_dict=True)
	context.practitioner = data
