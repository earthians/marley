# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
from __future__ import unicode_literals

import frappe
import unittest
from frappe.utils import today, add_years, getdate, add_days
from healthcare.healthcare.doctype.healthcare_insurance_contract.healthcare_insurance_contract import OverlapError

class TestHealthcareInsuranceContract(unittest.TestCase):
	def setup(self):
		create_insurance_company()

	def test_overlap(self):
		start_date = today()
		end_date = add_years(today(), 1)
		contract = get_new_insurance_contract_doc(start_date, end_date)
		contract.submit()

		# contract cannot have overlapping with start_date >
		contract = get_new_insurance_contract_doc(add_days(start_date, 1), end_date)
		self.assertRaises(OverlapError, contract.save)

		# contract cannot have overlapping with end_date <
		contract = get_new_insurance_contract_doc(start_date, add_days(end_date, -1))
		self.assertRaises(OverlapError, contract.save)

		# contract cannot have overlapping with start_date > and end_date <
		contract = get_new_insurance_contract_doc(add_days(start_date, 1), add_days(end_date, -1))
		self.assertRaises(OverlapError, contract.save)


def create_insurance_company():
	if not frappe.db.exists('Healthcare Insurance Company', '_Test Insurance Company'):
		insurance_company = frappe.get_doc({
				'doctype': 'Healthcare Insurance Company',
				'insurance_company_name': '_Test Insurance Company',
				'abbr': 'HIC',
				'default_currency': 'IND',
				'country': 'India'
			})
		insurance_company.append(
			'claims_receivable_accounts', {
					'company': '_Test Company',
					'reference_name': 'Debtors - _TC'
				})
		insurance_company.append(
			'rejected_claims_expense_accounts', {
					'company': '_Test Company',
					'reference_name': 'Debtors - _TC'
				})
		insurance_company.insert()


def get_new_insurance_contract_doc(start_date, end_date):
	insurance_contract = frappe.new_doc('Healthcare Insurance Contract')
	insurance_contract.insurance_company = '_Test Insurance Company'
	insurance_contract.start_date = start_date
	insurance_contract.end_date = end_date
	insurance_contract.is_active = 1
	return insurance_contract