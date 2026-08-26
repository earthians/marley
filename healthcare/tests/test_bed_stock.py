# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe

from healthcare.healthcare.api.bed_stock import BedStock
from healthcare.tests.utils import HealthcareTestSuite


class TestBedStock(HealthcareTestSuite):
	"""What is left at the bed goes back to the pharmacy, or home with the patient."""

	def setUp(self):
		super().setUp()
		from healthcare.healthcare.doctype.inpatient_record.inpatient_record import admit_patient
		from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import (
			create_inpatient,
			get_healthcare_service_unit,
		)

		frappe.db.sql("""delete from `tabInpatient Record`""")
		frappe.db.set_single_value("Healthcare Settings", "manage_inpatient_medication_stock", 1)
		frappe.clear_cache(doctype="Healthcare Settings")

		self.patient = frappe.get_list("Patient", pluck="name")[0]
		self.bed = frappe.get_doc("Healthcare Service Unit", get_healthcare_service_unit())
		self.bed.save()  # the setting is on, so the bed gets a warehouse

		record = create_inpatient(self.patient)
		record.expected_length_of_stay = 0
		record.save()
		record.reload()
		admit_patient(record, self.bed.name, frappe.utils.now_datetime())
		self.admission = record.name
		self.empty_the_bed()

	def empty_the_bed(self):
		"""The bed is reused by every test, so leftovers would otherwise add up."""
		leftovers = BedStock(self.admission).items()
		if not leftovers:
			return

		entry = frappe.new_doc("Stock Entry")
		entry.stock_entry_type = "Material Issue"
		entry.company = "_Test Company"
		entry.from_warehouse = self.bed.warehouse
		for item in leftovers:
			row = entry.append("items")
			row.item_code = item["item_code"]
			row.qty = item["quantity"]
			row.conversion_factor = 1
			row.s_warehouse = self.bed.warehouse
		entry.submit()

	def tearDown(self):
		frappe.db.set_single_value("Healthcare Settings", "manage_inpatient_medication_stock", 0)
		frappe.clear_cache(doctype="Healthcare Settings")
		self.close_the_admission()

	def close_the_admission(self):
		"""Leave no admission behind, and no patient pointing at one that is gone."""
		frappe.db.set_value(
			"Patient",
			self.patient,
			{"inpatient_record": None, "inpatient_status": None},
			update_modified=False,
		)
		frappe.db.delete("Inpatient Record", {"name": self.admission})

	def leave_stock_at_the_bed(self, qty=4):
		from healthcare.healthcare.doctype.inpatient_medication_entry.test_inpatient_medication_entry import (
			make_stock_entry,
		)

		make_stock_entry()
		transfer = frappe.new_doc("Stock Entry")
		transfer.stock_entry_type = "Material Transfer"
		transfer.company = "_Test Company"
		row = transfer.append("items")
		row.item_code = "Dextromethorphan"
		row.qty = qty
		row.conversion_factor = 1
		row.s_warehouse = "Stores - _TC"
		row.t_warehouse = self.bed.warehouse
		transfer.submit()

	def test_an_untouched_bed_holds_nothing(self):
		self.assertEqual(BedStock(self.admission).items(), [])

	def test_leftovers_are_read_from_the_warehouse(self):
		self.leave_stock_at_the_bed(qty=4)

		items = BedStock(self.admission).items()

		self.assertEqual(len(items), 1)
		self.assertEqual(items[0]["item_code"], "Dextromethorphan")
		self.assertEqual(items[0]["quantity"], 4)

	def test_returning_to_pharmacy_drafts_a_transfer_off_the_bed(self):
		self.leave_stock_at_the_bed(qty=4)

		transfer = BedStock(self.admission).return_to_pharmacy("Stores - _TC")

		self.assertEqual(transfer.stock_entry_type, "Material Transfer")
		self.assertEqual(transfer.docstatus, 0)
		self.assertEqual(transfer.items[0].s_warehouse, self.bed.warehouse)
		self.assertEqual(transfer.items[0].t_warehouse, "Stores - _TC")
		self.assertEqual(transfer.items[0].qty, 4)

	def test_selling_to_the_patient_issues_the_stock_and_bills_it(self):
		self.leave_stock_at_the_bed(qty=4)

		stock_entry = BedStock(self.admission).sell_to_patient()

		issued = frappe.get_doc("Stock Entry", stock_entry)
		self.assertEqual(issued.purpose, "Material Issue")
		self.assertEqual(issued.items[0].s_warehouse, self.bed.warehouse)
		self.assertEqual(issued.items[0].qty, 4)

		billable = frappe.get_all(
			"Inpatient Record Item",
			filters={"parent": self.admission, "stock_entry": stock_entry},
			fields=["item_code", "quantity", "invoiced"],
		)
		self.assertEqual(len(billable), 1)
		self.assertEqual(billable[0].quantity, 4)
		self.assertEqual(billable[0].invoiced, 0)

	def test_settling_an_empty_bed_says_so(self):
		self.assertRaises(frappe.ValidationError, BedStock(self.admission).sell_to_patient)
