# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.utils import add_years, nowdate, today

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


class TestPatientInsuranceCoverage(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		self.patient = "_Test Patient"
		self.practitioner = "_Test Healthcare Practitioner 2"
		self.payor = "_Test Insurance Payor"

	def test_insurance_coverage(self):
		frappe.db.delete("Patient Appointment", {"appointment_type": "_Test Appointment"})
		frappe.db.delete("Insurance Payor Contract", {"insurance_payor": "_Test Insurance Payor"})
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 0)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 0)

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
		sales_invoice = invoice_insured_appointments(appointment, appointments_to_invoice)

		invoice_dict = frappe.db.get_value(
			"Sales Invoice",
			sales_invoice,
			["total_insurance_coverage_amount", "patient_payable_amount"],
			as_dict=1,
		)
		self.assertEqual(invoice_dict.total_insurance_coverage_amount, 192)
		self.assertEqual(invoice_dict.patient_payable_amount, 48)
