import frappe

def get_context(context):
	selected_department = frappe.local.request.args.get('selected_department')
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
