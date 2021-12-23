# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
from __future__ import unicode_literals

import frappe
import unittest
from frappe.utils import today, add_days
from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import create_patient
from healthcare.healthcare.doctype.patient_insurance_policy.patient_insurance_policy import OverlapError

class TestPatientInsurancePolicy(unittest.TestCase):
	def test_policy(self):
		patient = create_patient()
		insurance_policy = get_new_insurance_policy(self, patient)
		insurance_policy.submit()

		# policy number should be unique?
		insurance_policy = get_new_insurance_policy(self, patient)
		self.assertRaises(OverlapError, insurance_policy.submit)


def get_new_insurance_policy(self, patient):
	insurance_policy = frappe.new_doc('Patient Insurance Policy')
	insurance_policy.insurance_payor = '_Test Insurance Payor'
	insurance_policy.patient = patient
	insurance_policy.policy_expiry_date = add_days(today(), 5)
	insurance_policy.policy_number = '123'
	return insurance_policy

