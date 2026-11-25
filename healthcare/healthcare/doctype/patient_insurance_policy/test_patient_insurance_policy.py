# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.utils import add_days, today

from healthcare.healthcare.doctype.patient_insurance_policy.patient_insurance_policy import (
	OverlapError,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestPatientInsurancePolicy(HealthcareTestSuite):
	def test_insurance_policy_overlap(self):
		patient = "_Test Patient"
		insurance_policy = get_new_insurance_policy(patient)
		insurance_policy.submit()

		# policy number should be unique?
		insurance_policy = get_new_insurance_policy(patient)
		self.assertRaises(OverlapError, insurance_policy.submit)


def get_new_insurance_policy(patient, eligibility_plan=None):
	insurance_policy = frappe.new_doc("Patient Insurance Policy")
	insurance_policy.insurance_payor = "_Test Insurance Payor"
	insurance_policy.patient = patient
	insurance_policy.policy_expiry_date = add_days(today(), 5)
	insurance_policy.policy_number = "123"
	insurance_policy.insurance_plan = eligibility_plan
	return insurance_policy
