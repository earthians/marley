# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
from __future__ import unicode_literals

import frappe
import unittest
from frappe.utils import today, add_years, getdate, add_days
from healthcare.healthcare.doctype.insurance_payor_contract.insurance_payor_contract import OverlapError

class TestInsurancePayorContract(unittest.TestCase):

	def test_overlap(self):
		create_insurance_payor()
		frappe.db.sql("""delete from `tabInsurance Payor Contract` where insurance_payor = '_Test Insurance Payor'""")
		start_date = today()
		end_date = add_years(today(), 1)
		contract = get_new_payor_contract_doc(start_date, end_date)
		contract.submit()

		# contract cannot have overlapping with start_date >
		contract = get_new_payor_contract_doc(add_days(start_date, 1), end_date)
		self.assertRaises(OverlapError, contract.save)

		# contract cannot have overlapping with end_date <
		contract = get_new_payor_contract_doc(start_date, add_days(end_date, -1))
		self.assertRaises(OverlapError, contract.save)

		# contract cannot have overlapping with start_date > and end_date <
		contract = get_new_payor_contract_doc(add_days(start_date, 1), add_days(end_date, -1))
		self.assertRaises(OverlapError, contract.save)


def create_insurance_payor():
	if not frappe.db.exists('Insurance Payor', '_Test Insurance Payor'):
		insurance_payor = frappe.get_doc({
				'doctype': 'Insurance Payor',
				'insurance_payor_name': '_Test Insurance Payor',
				'abbr': 'HIC',
				'default_currency': 'IND',
				'country': 'India'
			})
		insurance_payor.append(
			'claims_receivable_accounts', {
					'company': '_Test Company',
					'reference_name': 'Debtors - _TC'
				})
		insurance_payor.append(
			'rejected_claims_expense_accounts', {
					'company': '_Test Company',
					'reference_name': 'Debtors - _TC'
				})
		insurance_payor.insert()


def get_new_payor_contract_doc(start_date, end_date):
	payor_contract = frappe.new_doc('Insurance Payor Contract')
	payor_contract.insurance_payor = '_Test Insurance Payor'
	payor_contract.start_date = start_date
	payor_contract.company = '_Test Company'
	payor_contract.end_date = end_date
	payor_contract.is_active = 1
	return payor_contract