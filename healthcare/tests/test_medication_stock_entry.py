# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe
from frappe.utils import add_days, nowdate

from healthcare.healthcare.doctype.inpatient_medication_entry.medication_stock_entry import (
	ServiceUnitTransfer,
)
from healthcare.tests.utils import HealthcareTestSuite

DRUG = "_Test Batched Drug"
PHARMACY = "Stores - _TC"


class TestBatchedMedicationTransfer(HealthcareTestSuite):
	"""Short dated stock has to move before it lapses, so batches are picked
	by expiry rather than left to chance."""

	def setUp(self):
		super().setUp()
		make_batched_drug()
		empty_drug_stock()

	def transfer_for(self, dosage, service_unit=None):
		"""The builder on its own, without an admission behind it."""
		entry = frappe._dict(
			name=None,  # no Inpatient Medication Entry behind it, so nothing to link to
			company="_Test Company",
			warehouse=PHARMACY,
			posting_date=nowdate(),
			medication_orders=[frappe._dict(drug_code=DRUG, dosage=dosage, service_unit=service_unit)],
		)
		return ServiceUnitTransfer(entry)

	def test_the_batch_that_expires_first_is_taken_first(self):
		receive_batch("_TEST-BATCH-LATE", add_days(nowdate(), 300), qty=10)
		receive_batch("_TEST-BATCH-SOON", add_days(nowdate(), 30), qty=10)

		allocations = self.transfer_for(4).allocate(frappe._dict(drug_code=DRUG, dosage=4))

		self.assertEqual(len(allocations), 1)
		self.assertEqual(allocations[0].batch_no, "_TEST-BATCH-SOON")
		self.assertEqual(allocations[0].qty, 4)

	def test_a_dose_larger_than_one_batch_spills_into_the_next(self):
		receive_batch("_TEST-BATCH-LATE", add_days(nowdate(), 300), qty=10)
		receive_batch("_TEST-BATCH-SOON", add_days(nowdate(), 30), qty=3)

		allocations = self.transfer_for(8).allocate(frappe._dict(drug_code=DRUG, dosage=8))

		self.assertEqual(
			[(row.batch_no, row.qty) for row in allocations],
			[("_TEST-BATCH-SOON", 3), ("_TEST-BATCH-LATE", 5)],
		)

	def test_what_the_batches_cannot_cover_is_left_on_the_last_of_them(self):
		receive_batch("_TEST-BATCH-SOON", add_days(nowdate(), 30), qty=2)

		allocations = self.transfer_for(5).allocate(frappe._dict(drug_code=DRUG, dosage=5))

		self.assertEqual(len(allocations), 1)
		self.assertEqual(allocations[0].batch_no, "_TEST-BATCH-SOON")
		self.assertEqual(allocations[0].qty, 5, "the shortfall rides on the last batch")

	def test_a_drug_with_no_stock_at_all_falls_back_to_one_plain_row(self):
		allocations = self.transfer_for(5).allocate(frappe._dict(drug_code=DRUG, dosage=5))

		self.assertEqual(len(allocations), 1)
		self.assertIsNone(allocations[0].get("batch_no"))
		self.assertEqual(allocations[0].qty, 5)

	def test_an_unbatched_drug_is_left_to_erpnext(self):
		allocations = self.transfer_for(3).allocate(frappe._dict(drug_code="Dextromethorphan", dosage=3))

		self.assertEqual(len(allocations), 1)
		self.assertIsNone(allocations[0].get("batch_no"))

	def test_a_bed_with_no_warehouse_stops_the_transfer(self):
		transfer = self.transfer_for(1, service_unit=None)

		self.assertRaises(frappe.ValidationError, transfer.validate)

	def test_each_batch_becomes_its_own_row_on_the_stock_entry(self):
		receive_batch("_TEST-BATCH-LATE", add_days(nowdate(), 300), qty=10)
		receive_batch("_TEST-BATCH-SOON", add_days(nowdate(), 30), qty=3)

		bed = bed_with_warehouse()
		transfer = self.transfer_for(8, service_unit=bed.name)
		stock_entry = frappe.get_doc("Stock Entry", transfer.create())

		self.assertEqual(stock_entry.purpose, "Material Transfer")
		self.assertEqual(len(stock_entry.items), 2)
		self.assertEqual(
			[(row.batch_no, row.qty) for row in stock_entry.items],
			[("_TEST-BATCH-SOON", 3), ("_TEST-BATCH-LATE", 5)],
		)
		for row in stock_entry.items:
			self.assertEqual(row.s_warehouse, PHARMACY)
			self.assertEqual(row.t_warehouse, bed.warehouse)


def make_batched_drug():
	if frappe.db.exists("Item", DRUG):
		return

	frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": DRUG,
			"item_name": DRUG,
			"item_group": "Products",
			"stock_uom": "Nos",
			"is_stock_item": 1,
			"has_batch_no": 1,
			"create_new_batch": 1,
			"batch_number_series": "_TEST-BATCH-.####",
			"valuation_rate": 10,
		}
	).insert(ignore_permissions=True)


def available_batches():
	from erpnext.stock.doctype.serial_and_batch_bundle.serial_and_batch_bundle import get_auto_batch_nos

	return get_auto_batch_nos(frappe._dict(item_code=DRUG, warehouse=PHARMACY, based_on="Expiry"))


def empty_drug_stock():
	"""Batches left by an earlier run would decide the order of this one."""
	batches = available_batches()
	if not batches:
		return

	entry = frappe.new_doc("Stock Entry")
	entry.stock_entry_type = "Material Issue"
	entry.company = "_Test Company"
	entry.from_warehouse = PHARMACY
	for batch in batches:
		row = entry.append("items")
		row.item_code = DRUG
		row.qty = batch.qty
		row.s_warehouse = PHARMACY
		row.conversion_factor = 1
		row.use_serial_batch_fields = 1
		row.batch_no = batch.batch_no
	entry.submit()


def receive_batch(batch_id, expiry, qty):
	if not frappe.db.exists("Batch", batch_id):
		frappe.get_doc(
			{"doctype": "Batch", "batch_id": batch_id, "item": DRUG, "expiry_date": expiry}
		).insert(ignore_permissions=True)

	entry = frappe.new_doc("Stock Entry")
	entry.stock_entry_type = "Material Receipt"
	entry.company = "_Test Company"
	entry.to_warehouse = PHARMACY
	row = entry.append("items")
	row.item_code = DRUG
	row.qty = qty
	row.t_warehouse = PHARMACY
	row.basic_rate = 10
	row.conversion_factor = 1
	row.use_serial_batch_fields = 1
	row.batch_no = batch_id
	entry.submit()
	return entry


def bed_with_warehouse():
	from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import (
		get_healthcare_service_unit,
	)

	frappe.db.set_single_value("Healthcare Settings", "manage_inpatient_medication_stock", 1)
	bed = frappe.get_doc("Healthcare Service Unit", get_healthcare_service_unit())
	bed.save()
	frappe.db.set_single_value("Healthcare Settings", "manage_inpatient_medication_stock", 0)
	return bed
