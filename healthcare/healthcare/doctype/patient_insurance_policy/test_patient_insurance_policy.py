# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt


import frappe
from frappe.utils import add_days, today

from healthcare.healthcare.doctype.patient_insurance_policy.patient_insurance_policy import (
	OverlapError,
)
from healthcare.tests.factories.billing import get_new_insurance_policy
from healthcare.tests.utils import HealthcareTestSuite


class TestPatientInsurancePolicy(HealthcareTestSuite):
	def test_insurance_policy_overlap(self):
		patient = "_Test Patient"
		insurance_policy = get_new_insurance_policy(patient)
		insurance_policy.submit()

		# policy number should be unique?
		insurance_policy = get_new_insurance_policy(patient)
		self.assertRaises(OverlapError, insurance_policy.submit)

	def test_a_policy_may_expire_today(self):
		insurance_policy = get_new_insurance_policy("_Test Patient")
		insurance_policy.policy_expiry_date = today()

		insurance_policy.validate_expiry_date()

	def test_a_policy_cannot_have_expired_already(self):
		insurance_policy = get_new_insurance_policy("_Test Patient")
		insurance_policy.policy_expiry_date = add_days(today(), -1)

		self.assertRaises(frappe.ValidationError, insurance_policy.validate_expiry_date)
