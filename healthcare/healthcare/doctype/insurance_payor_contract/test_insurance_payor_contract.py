# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.utils import add_days, add_years, getdate, today

from healthcare.healthcare.doctype.insurance_payor_contract.insurance_payor_contract import (
	OverlapError,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestInsurancePayorContract(HealthcareTestSuite):
	def test_insurance_payor_contract_overlap(self):
		self.payor = "_Test Insurance Payor"
		frappe.db.sql(
			"""delete from `tabInsurance Payor Contract` where insurance_payor = '_Test Insurance Payor'"""
		)
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


def get_new_payor_contract_doc(start_date, end_date):
	payor_contract = frappe.new_doc("Insurance Payor Contract")
	payor_contract.insurance_payor = "_Test Insurance Payor"
	payor_contract.start_date = start_date
	payor_contract.company = "_Test Company"
	payor_contract.end_date = end_date
	payor_contract.is_active = 1
	return payor_contract
