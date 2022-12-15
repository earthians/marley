import frappe

def get_context(context):
	department = frappe.local.request.args.get('department')
	context.medical_departments = frappe.get_all("Healthcare Practitioner",
		fields = ["department"], filters={"department": ["!=", ""]}, group_by="department")
