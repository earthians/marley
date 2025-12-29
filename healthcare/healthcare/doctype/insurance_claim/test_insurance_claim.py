# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_years, today

from erpnext.accounts.party import get_dashboard_info
from erpnext.accounts.utils import get_balance_on

from healthcare.healthcare.doctype.insurance_claim.insurance_claim import create_payment_entry
from healthcare.healthcare.doctype.insurance_payor_contract.test_insurance_payor_contract import (
	create_insurance_payor,
)
from healthcare.healthcare.doctype.patient_insurance_coverage.test_patient_insurance_coverage import (
	create_insurance_test_docs,
)


class TestInsuranceClaim(IntegrationTestCase):
	def test_insurance_claim(self):
		frappe.db.sql("""delete from `tabAppointment Type` where name = '_Test Appointment'""")
		frappe.db.sql("""delete from `tabPatient Appointment` where appointment_type = '_Test Appointment'""")
		frappe.db.sql(
			"""delete from `tabInsurance Payor Contract` where insurance_payor = '_Test Insurance Payor'"""
		)
		test_docs = create_insurance_test_docs()

		# Patient balance should be 20% of 400
		info = get_dashboard_info("Customer", test_docs["customer"], None)
		balance = next(item["total_unpaid"] for item in info if item["company"] == "_Test Company")

		self.assertEqual(balance, 80)

		# Create Insurance Claim
		claim_name, claim_doc = create_insurance_claim(test_docs["Patient"], test_docs["Insurance Policy"])

		self.assertEqual(claim_doc.insurance_claim_amount, 320)
		self.assertEqual(claim_doc.approved_amount, 320)
		self.assertEqual(claim_doc.outstanding_amount, 320)
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
		self.assertEqual(claim_dict.approved_amount, 320)
		self.assertEqual(claim_dict.outstanding_amount, 0)
		self.assertEqual(claim_dict.paid_amount, 320)


def create_insurance_claim(patient, insurance_policy):
	create_insurance_payor()
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
