# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
import json

import frappe

from healthcare.healthcare.doctype.healthcare_service_unit.healthcare_service_unit import (
	add_multiple_service_units,
	get_bed_warehouse_group,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestHealthcareServiceUnit(HealthcareTestSuite):
	def tearDown(self):
		frappe.db.set_single_value("Healthcare Settings", "manage_inpatient_medication_stock", 0)

	def test_create_company_should_create_root_service_unit(self):
		company = frappe.get_doc(
			{
				"doctype": "Company",
				"company_name": "Test Hospital",
				"country": "India",
				"default_currency": "INR",
			}
		)
		try:
			company = company.insert()
		except frappe.exceptions.DuplicateEntryError:
			pass
		filters = {"company": company.name, "parent_healthcare_service_unit": None}
		root_service_unit = frappe.db.exists("Healthcare Service Unit", filters)
		self.assertTrue(root_service_unit)

	def test_beds_created_in_bulk_get_a_warehouse_each(self):
		frappe.db.set_single_value("Healthcare Settings", "manage_inpatient_medication_stock", 1)
		beds = create_beds("_Test Ward A", count=2)

		self.assertEqual(len(beds), 2)
		for bed in beds:
			self.assertTrue(bed.warehouse)
			warehouse = frappe.get_doc("Warehouse", bed.warehouse)
			self.assertFalse(warehouse.is_group)
			self.assertEqual(warehouse.parent_warehouse, get_bed_warehouse_group(bed.company))

	def test_no_warehouse_while_the_setting_is_off(self):
		frappe.db.set_single_value("Healthcare Settings", "manage_inpatient_medication_stock", 0)
		beds = create_beds("_Test Ward B")

		self.assertFalse(beds[0].warehouse)

	def test_beds_never_share_a_warehouse(self):
		"""A warehouse picked once in the bulk creation dialog would otherwise
		land on every bed it creates."""
		frappe.db.set_single_value("Healthcare Settings", "manage_inpatient_medication_stock", 1)
		beds = create_beds("_Test Ward C", count=3, warehouse="Stores - _TC")

		warehouses = [bed.warehouse for bed in beds]
		self.assertNotIn("Stores - _TC", warehouses)
		self.assertEqual(len(set(warehouses)), 3)

	def test_units_that_are_not_beds_go_on_sharing_one_warehouse(self):
		"""Only beds need a warehouse each. Everything else keeps the one it
		was given, however many units are sharing it."""
		frappe.db.set_single_value("Healthcare Settings", "manage_inpatient_medication_stock", 1)
		units = create_beds(
			"_Test Clinic",
			count=3,
			warehouse="Stores - _TC",
			service_unit_type="_Test Service Unit Type - Appointments",
		)

		self.assertEqual([unit.warehouse for unit in units], ["Stores - _TC"] * 3)

	def test_switching_the_setting_on_fills_in_beds_that_predate_it(self):
		frappe.db.set_single_value("Healthcare Settings", "manage_inpatient_medication_stock", 0)
		bed = create_beds("_Test Ward D")[0]
		self.assertFalse(bed.warehouse)

		settings = frappe.get_doc("Healthcare Settings")
		settings.manage_inpatient_medication_stock = 1
		settings.save()

		bed.reload()
		self.assertTrue(bed.warehouse)


def create_beds(ward_name, count=1, warehouse=None, service_unit_type="_Test Service Unit Type - Occupancy"):
	"""Beds are created in bulk in practice, so create them that way here too."""
	before = set(frappe.get_all("Healthcare Service Unit", pluck="name"))

	add_multiple_service_units(
		"_Test Company",
		json.dumps(
			{
				"company": "_Test Company",
				"healthcare_service_unit_name": ward_name,
				"count": count,
				"service_unit_type": service_unit_type,
				"warehouse": warehouse,
			}
		),
	)

	created = set(frappe.get_all("Healthcare Service Unit", pluck="name")) - before
	return [frappe.get_doc("Healthcare Service Unit", name) for name in sorted(created)]
