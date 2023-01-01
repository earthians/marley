import frappe
import json

no_cache = 1

def get_context(context):
	context.no_cache = 1
	selected_department = frappe.local.request.args.get('selected_department')
	if selected_department:
		selected_department = selected_department.replace('"', '')
	query = """
		select
			h_pract.name,
			h_pract.image,
			h_pract.practitioner_name,
			h_pract.department
		from
			`tabHealthcare Practitioner` as h_pract left join
			`tabPractitioner Service Unit Schedule` as sch on h_pract.name = sch.parent
		where
			sch.schedule!='' and h_pract.status='Active'
	"""
	if selected_department:
		context.department = selected_department
		query += f" and h_pract.department = '{selected_department}'"
	query += "group by h_pract.name"
	data = frappe.db.sql(query, as_dict=True)
	context.practitioner = data
