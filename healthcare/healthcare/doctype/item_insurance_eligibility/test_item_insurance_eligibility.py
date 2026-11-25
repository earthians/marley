# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.utils import add_to_date, getdate

from healthcare.healthcare.doctype.item_insurance_eligibility.item_insurance_eligibility import (
	CoverageOverlapError,
	get_insurance_eligibility,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestItemInsuranceEligibility(HealthcareTestSuite):
	def test_validate_eligibility_overlap(self):
		frappe.db.delete("Appointment Type", {"name": "_Test Appointment"})
		frappe.db.delete("Item Insurance Eligibility")

		medical_department = "_Test Medical Department"
		args = {
			"medical_department": medical_department,
		}
		appointment_type = "_Test Appointment Type"

		args = frappe._dict(
			{
				"insurance_plan": None,
				"template_dt": "Appointment Type",
				"template_dn": appointment_type,
				"item": None,
				"valid_from": getdate(),
				"valid_till": None,
				"mode_of_approval": "Automatic",
				"coverage": 80,
			}
		)

		# make insurance eligibility without valid till
		item_insurance_eligibility = create_insurance_eligibility(**args).insert()

		self.assertTrue(item_insurance_eligibility)

		# make duplicate eligibility
		with self.assertRaises(CoverageOverlapError):
			create_insurance_eligibility(**args).insert()

		# create eligibility for 1 year period
		args["valid_till"] = add_to_date(getdate(), years=1)
		item_insurance_eligibility = create_insurance_eligibility(**args).insert()
		self.assertTrue(item_insurance_eligibility)

		# create an overlapping eligibility
		args["valid_till"] = add_to_date(getdate(), months=1)

		with self.assertRaises(CoverageOverlapError):
			create_insurance_eligibility(**args).insert()

	def test_item_insurance_eligibility(self):
		frappe.db.delete("Item Insurance Eligibility")

		medical_department = "_Test Medical Department"
		args = {
			"medical_department": medical_department,
		}
		appointment_type = "_Test Appointment Type"

		args = frappe._dict(
			{
				"insurance_plan": None,
				"template_dt": "Appointment Type",
				"template_dn": appointment_type,
				"item": None,
				"valid_from": add_to_date(getdate(), months=-1),
				"valid_till": None,
				"mode_of_approval": "Automatic",
				"coverage": 80,
			}
		)

		# make insurance eligibility without, latest without and with valid till
		eligibility_without_end_date = create_insurance_eligibility(**args).insert()

		args["valid_from"] = add_to_date(getdate(), days=-10)
		latest_eligibility_without_end_date = create_insurance_eligibility(**args).insert()

		args["valid_from"] = getdate()
		args["valid_till"] = add_to_date(getdate(), months=1)
		eligibility_with_end_date = create_insurance_eligibility(**args).insert()

		# get eligibility for day after
		eligibility = get_insurance_eligibility(
			None,
			"Appointment Type",
			appointment_type,
			on_date=add_to_date(getdate(), days=2),
			insurance_plan=None,
		)

		self.assertTrue(eligibility)
		self.assertEqual(eligibility.name, eligibility_with_end_date.name)

		# get eligibility for 5 days back
		eligibility = get_insurance_eligibility(
			None,
			"Appointment Type",
			appointment_type,
			on_date=add_to_date(getdate(), days=-5),
			insurance_plan=None,
		)

		self.assertTrue(eligibility)
		self.assertEqual(eligibility.name, latest_eligibility_without_end_date.name)

		# get eligibility for 15 days back
		eligibility = get_insurance_eligibility(
			None,
			"Appointment Type",
			appointment_type,
			on_date=add_to_date(getdate(), days=-15),
			insurance_plan=None,
		)

		self.assertTrue(eligibility)
		self.assertEqual(eligibility.name, eligibility_without_end_date.name)


def create_insurance_eligibility(**args):
	args = frappe._dict(args)

	item_eligibility = frappe.new_doc("Item Insurance Eligibility")
	item_eligibility.is_active = 1
	item_eligibility.eligibility_for = "Service" if args.template_dt else "Item"
	item_eligibility.insurance_plan = args.insurance_plan
	item_eligibility.template_dt = args.template_dt
	item_eligibility.template_dn = args.template_dn
	item_eligibility.item = args.item
	item_eligibility.mode_of_approval = args.mode_of_approval
	item_eligibility.coverage = args.coverage

	item_eligibility.valid_from = args.valid_from or getdate()
	item_eligibility.valid_till = args.valid_till or None

	return item_eligibility
