import frappe


@frappe.whitelist()
def set_paid_amount_in_treatment_counselling(doc, method):
	if doc.treatment_counselling and doc.paid_amount:
		treatment_counselling_doc = frappe.get_doc("Treatment Counselling", doc.treatment_counselling)
		treatment_counselling_doc.paid_amount = doc.paid_amount
		treatment_counselling_doc.outstanding_amount = (
			treatment_counselling_doc.amount - treatment_counselling_doc.paid_amount
		)
		treatment_counselling_doc.save()
