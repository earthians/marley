import frappe


def execute():
	frappe.reload_doc("healthcare", "doctype", "fee_validity_reference")
	frappe.reload_doc("healthcare", "doctype", "fee_validity")

	set_reference_in_fee_validity()
	set_reference_in_fee_validity_reference()


def set_reference_in_fee_validity():
	"""Move the originating appointment into the reference_dt, reference_dn pair"""
	if not frappe.db.has_column("Fee Validity", "patient_appointment"):
		return

	fee_validity = frappe.qb.DocType("Fee Validity")
	(
		frappe.qb.update(fee_validity)
		.set(fee_validity.reference_dt, "Patient Appointment")
		.set(fee_validity.reference_dn, fee_validity.patient_appointment)
		.where(fee_validity.patient_appointment.notnull())
		.where(fee_validity.patient_appointment != "")
	).run()


def set_reference_in_fee_validity_reference():
	"""Move the referred appointments into the reference_dt, reference_dn pair

	The parent field is renamed along with them, as ref_appointments is now reference_visits.
	"""
	if not frappe.db.has_column("Fee Validity Reference", "appointment"):
		return

	reference = frappe.qb.DocType("Fee Validity Reference")
	(
		frappe.qb.update(reference)
		.set(reference.reference_dt, "Patient Appointment")
		.set(reference.reference_dn, reference.appointment)
		.set(reference.parentfield, "reference_visits")
		.where(reference.appointment.notnull())
		.where(reference.appointment != "")
	).run()
