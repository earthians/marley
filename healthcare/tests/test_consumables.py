# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe

from healthcare.healthcare.api.consumables import (
	get_consumable_context,
	get_consumables,
	record_consumables,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestConsumables(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		from healthcare.healthcare.doctype.inpatient_record.inpatient_record import admit_patient
		from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import (
			create_inpatient,
			get_healthcare_service_unit,
		)

		frappe.db.sql("""delete from `tabInpatient Record`""")
		self.patient = frappe.get_list("Patient", pluck="name")[0]
		self.item = frappe.get_list("Item", filters={"is_stock_item": 1}, pluck="name")[0]

		record = create_inpatient(self.patient)
		record.expected_length_of_stay = 0
		record.save()
		record.reload()
		self.service_unit = get_healthcare_service_unit()
		admit_patient(record, self.service_unit, frappe.utils.now_datetime())
		self.record = record.name

	def test_context_reports_the_admission_and_its_store(self):
		context = get_consumable_context(self.patient)

		self.assertEqual(context["inpatient_record"], self.record)

	def test_recording_without_items_throws(self):
		self.assertRaises(frappe.ValidationError, record_consumables, self.patient, [])

	def test_an_outpatient_has_nowhere_to_record_consumables(self):
		frappe.db.set_value("Patient", self.patient, "inpatient_record", None)

		self.assertRaises(
			frappe.ValidationError,
			record_consumables,
			self.patient,
			[{"item_code": self.item, "quantity": 1}],
		)

	def test_an_outpatient_has_no_consumable_context(self):
		frappe.db.set_value("Patient", self.patient, "inpatient_record", None)

		self.assertIsNone(get_consumable_context(self.patient)["inpatient_record"])

	def stock_the_ward(self, qty=20):
		receipt = frappe.new_doc("Stock Entry")
		receipt.stock_entry_type = "Material Receipt"
		receipt.company = "_Test Company"
		row = receipt.append("items")
		row.item_code = self.item
		row.qty = qty
		row.t_warehouse = get_consumable_context(self.patient)["warehouse"]
		row.basic_rate = 10
		receipt.save(ignore_permissions=True)
		receipt.submit()

	def test_recording_issues_stock_and_bills_the_patient(self):
		self.stock_the_ward()

		entry = record_consumables(self.patient, [{"item_code": self.item, "quantity": 2}])

		stock_entry = frappe.get_doc("Stock Entry", entry)
		self.assertEqual(stock_entry.stock_entry_type, "Material Issue")
		self.assertEqual(stock_entry.docstatus, 1)

		billed = get_consumables(self.patient)
		self.assertEqual(billed[0]["item_code"], self.item)
		self.assertEqual(billed[0]["quantity"], 2)
		# billing only picks up a row once it carries its stock entry
		self.assertEqual(billed[0]["stock_entry"], entry)

	def test_consumables_are_empty_for_an_outpatient(self):
		frappe.db.set_value("Patient", self.patient, "inpatient_record", None)

		self.assertEqual(get_consumables(self.patient), [])
