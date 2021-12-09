# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
from __future__ import unicode_literals

import frappe
import unittest
from frappe.utils import today, add_days
from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import create_patient
from healthcare.healthcare.doctype.healthcare_insurance_subscription.healthcare_insurance_subscription import OverlapError

class TestHealthcareInsuranceSubscription(unittest.TestCase):
	def test_subscription(self):
		patient = create_patient()
		insurance_subscription = get_new_insurance_subscription(self, patient)
		insurance_subscription.submit()

		# subscription cannot have equal policy number
		insurance_subscription = get_new_insurance_subscription(self, patient)
		self.assertRaises(OverlapError, insurance_subscription.submit)


def get_new_insurance_subscription(self, patient):
	insurance_subscription = frappe.new_doc('Healthcare Insurance Subscription')
	insurance_subscription.insurance_company = '_Test Insurance Company'
	insurance_subscription.patient = patient
	insurance_subscription.policy_expiry_date = add_days(today(), 5)
	insurance_subscription.policy_number = '123'
	return insurance_subscription
