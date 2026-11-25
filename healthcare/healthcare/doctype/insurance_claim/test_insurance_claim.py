# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.utils import add_years, nowdate, today

from healthcare.healthcare.doctype.insurance_claim.insurance_claim import create_payment_entry
from healthcare.healthcare.utils import get_appointments_to_invoice
from healthcare.tests.factories.billing import (
	create_insured_appointment,
	create_item_insurance_eligibility,
	create_payor_insurance_eligibility_plan,
	get_new_insurance_policy,
	get_new_payor_contract_doc,
	invoice_insured_appointments,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestInsuranceClaim(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		self.patient = "_Test Patient"
		self.practitioner = "_Test Healthcare Practitioner 2"

	def test_insurance_claim_and_payment(self):
		frappe.db.delete("Appointment Type", {"name": "_Test Appointment"})
		frappe.db.delete("Patient Appointment", {"appointment_type": "_Test Appointment"})
		frappe.db.delete("Insurance Payor Contract", {"insurance_payor": "_Test Insurance Payor"})

		eligibility_plan = create_payor_insurance_eligibility_plan()
		contract = get_new_payor_contract_doc(today(), add_years(today(), 1))
		contract.submit()

		insurance_policy = get_new_insurance_policy(self.patient, eligibility_plan)
		insurance_policy.submit()

		appointment_type = "_Test Appointment Type"
		create_item_insurance_eligibility("Service", "Appointment Type", appointment_type, eligibility_plan)

		# Book Appointment and Invoice
		# invoice total 400 (after 20% discount) coverage 80%
		appointment = create_insured_appointment(
			self.patient, self.practitioner, nowdate(), appointment_type, insurance_policy.name
		)
		appointments_to_invoice = get_appointments_to_invoice(
			frappe.get_doc("Patient", self.patient), "_Test Company"
		)
		invoice_insured_appointments(appointment, appointments_to_invoice)

		# Create Insurance Claim
		claim_name, claim_doc = create_insurance_claim(self.patient, insurance_policy.name)

		self.assertEqual(claim_doc.insurance_claim_amount, 192)
		self.assertEqual(claim_doc.approved_amount, 192)
		self.assertEqual(claim_doc.outstanding_amount, 192)
		self.assertEqual(claim_doc.paid_amount, 0)

		# Create Payment Entry of the Insurance Claim
		payment_entry_dict = create_payment_entry(claim_doc)
		payment_entry_doc = frappe.get_doc(payment_entry_dict).insert()
		payment_entry_doc.submit()
		claim_dict = frappe.db.get_value(
			"Insurance Claim",
			claim_name,
			["approved_amount", "outstanding_amount", "paid_amount"],
			as_dict=1,
		)
		self.assertEqual(claim_dict.approved_amount, 192)
		self.assertEqual(claim_dict.outstanding_amount, 0)
		self.assertEqual(claim_dict.paid_amount, 192)


def create_insurance_claim(patient, insurance_policy):
	claim = frappe.new_doc("Insurance Claim")
	claim.insurance_payor = "_Test Insurance Payor"
	claim.mode_of_payment = "Cash"
	claim.company = "_Test Company"
	claim.due_date = today()
	claim.patient = patient
	claim.insurance_policy = insurance_policy
	claim.valid_till = add_years(today(), 1)
	claim.get_coverages()
	claim.save()
	claim.submit()
	claim.reload()
	claim.coverages[0].status = "Approved"
	claim.save()

	return claim.name, claim
