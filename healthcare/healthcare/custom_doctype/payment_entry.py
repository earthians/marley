import frappe


@frappe.whitelist()
def set_paid_amount_in_treatment_counselling(doc, method):
	if doc.treatment_counselling and doc.paid_amount:
		on_cancel = True if method == "on_cancel" else False
		validate_treatment_counselling(doc, on_cancel)


def validate_treatment_counselling(doc, on_cancel=False):
	treatment_counselling_doc = frappe.get_doc("Treatment Counselling", doc.treatment_counselling)

	paid_amount = treatment_counselling_doc.paid_amount + doc.paid_amount
	if on_cancel:
		paid_amount = treatment_counselling_doc.paid_amount - doc.paid_amount

	treatment_counselling_doc.paid_amount = paid_amount
	treatment_counselling_doc.outstanding_amount = (
		treatment_counselling_doc.amount - treatment_counselling_doc.paid_amount
	)
	treatment_counselling_doc.save()
