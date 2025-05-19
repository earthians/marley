import frappe

from healthcare.healthcare.doctype.insurance_claim.insurance_claim import update_claim_paid_amount


@frappe.whitelist()
def manage_payment_entry_submit_cancel(doc, method):
	if doc.treatment_counselling and doc.paid_amount:
		on_cancel = True if method == "on_cancel" else False
		validate_treatment_counselling(doc, on_cancel)

	update_claim_paid_amount(doc, method)


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
