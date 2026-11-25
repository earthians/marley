# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt


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
