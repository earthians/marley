# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt


import frappe

from healthcare.tests.utils import HealthcareTestSuite


class TestHealthcareServiceUnitType(HealthcareTestSuite):
	def test_item_creation(self):
		unit_type = frappe.get_doc(
			"Healthcare Service Unit Type", {"service_unit_type": "_Test Inpatient Rooms"}
		)
		self.assertTrue(frappe.db.exists("Item", unit_type.item))

		# check item disabled
		unit_type.disabled = 1
		unit_type.save()
		self.assertEqual(frappe.db.get_value("Item", unit_type.item, "disabled"), 1)

	def test_billable_item_cannot_be_shared_between_types(self):
		existing = frappe.get_doc(
			"Healthcare Service Unit Type", {"service_unit_type": "_Test Inpatient Rooms"}
		)
		duplicate = frappe.get_doc(
			{
				"doctype": "Healthcare Service Unit Type",
				"service_unit_type": "_Test Shared Item Rooms",
				"inpatient_occupancy": 1,
				"is_billable": 1,
				"item": existing.item,
			}
		)
		self.assertRaises(frappe.ValidationError, duplicate.insert)


def create_theatre_type(name, is_ot=1):
	# reloaded: a freshly inserted doc holds None where the database has 0, which on_update reads as a change
	if not frappe.db.exists("Healthcare Service Unit Type", name):
		frappe.get_doc(
			{
				"doctype": "Healthcare Service Unit Type",
				"service_unit_type": name,
				"inpatient_occupancy": 1,
				"is_ot": is_ot,
			}
		).insert()
	return frappe.get_doc("Healthcare Service Unit Type", name)
