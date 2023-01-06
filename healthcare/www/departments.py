import frappe
from frappe import _

no_cache = 1

def get_context(context):
	context.no_cache = 1
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
			`tabMedical Department` as md on h_pract.department = md.name
		where
			md.show_in_website=1 and h_pract.status='Active'
		group by 
			md.name
	"""
	print('\n\n', frappe.db.sql(query, as_dict=True))
	context.medical_departments = frappe.db.sql(query, as_dict=True)
