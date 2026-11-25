# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt


import frappe
from frappe.utils import add_days, getdate, now_datetime

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import get_account
from healthcare.healthcare.doctype.inpatient_medication_entry.inpatient_medication_entry import (
	get_drug_shortage_map,
	make_difference_stock_entry,
)
from healthcare.healthcare.doctype.inpatient_record.inpatient_record import admit_patient
from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import (
	create_inpatient,
	get_healthcare_service_unit,
)
from healthcare.tests.factories.inpatient import create_ipme, create_ipmo, make_stock_entry
from healthcare.tests.utils import HealthcareTestSuite


class TestInpatientMedicationEntry(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		frappe.db.sql("""delete from `tabInpatient Record`""")
		frappe.db.sql("""delete from `tabInpatient Medication Order`""")
		frappe.db.sql("""delete from `tabInpatient Medication Entry`""")

		self.patient = "_Test IPD Patient"
		# Admit
		ip_record = create_inpatient(self.patient)
		ip_record.expected_length_of_stay = 0
		ip_record.save()
		ip_record.reload()
		service_unit = get_healthcare_service_unit()
		admit_patient(ip_record, service_unit, now_datetime())
		self.ip_record = ip_record

	def test_filters_for_fetching_pending_mo(self):
		ipmo = create_ipmo(self.patient)
		ipmo.submit()
		ipmo.reload()

		date = add_days(getdate(), -1)
		filters = frappe._dict(
			from_date=date,
			to_date=date,
			from_time="",
			to_time="",
			item_code="Dextromethorphan",
			patient=self.patient,
		)

		ipme = create_ipme(filters, update_stock=0)

		# 3 dosages per day
		self.assertEqual(len(ipme.medication_orders), 3)
		self.assertEqual(getdate(ipme.medication_orders[0].datetime), date)

	def test_ipme_with_stock_update(self):
		ipmo = create_ipmo(self.patient)
		ipmo.submit()
		ipmo.reload()

		date = add_days(getdate(), -1)
		filters = frappe._dict(
			from_date=date,
			to_date=date,
			from_time="",
			to_time="",
			item_code="Dextromethorphan",
			patient=self.patient,
		)

		make_stock_entry()
		ipme = create_ipme(filters, update_stock=1)
		ipme.submit()
		ipme.reload()

		# test order completed
		is_order_completed = frappe.db.get_value(
			"Inpatient Medication Order Entry", ipme.medication_orders[0].against_imoe, "is_completed"
		)
		self.assertEqual(is_order_completed, 1)

		# test stock entry
		stock_entry = frappe.db.exists("Stock Entry", {"inpatient_medication_entry": ipme.name})
		self.assertTrue(stock_entry)

		# check references
		stock_entry = frappe.get_doc("Stock Entry", stock_entry)
		self.assertEqual(stock_entry.items[0].patient, self.patient)
		self.assertEqual(
			stock_entry.items[0].inpatient_medication_entry_child, ipme.medication_orders[0].name
		)

	def test_entry_completes_the_order_when_stock_is_not_managed_at_the_bed(self):
		ipme = self.submit_entry_for_yesterday()

		entry = frappe.db.get_value(
			"Inpatient Medication Order Entry",
			ipme.medication_orders[0].against_imoe,
			["status", "is_completed"],
			as_dict=True,
		)
		self.assertEqual(entry.status, "Completed")
		self.assertEqual(entry.is_completed, 1)

	def test_entry_transfers_to_the_bed_when_stock_is_managed_there(self):
		frappe.db.set_single_value("Healthcare Settings", "manage_inpatient_medication_stock", 1)
		bed = frappe.get_doc("Healthcare Service Unit", get_healthcare_service_unit())
		bed.save()  # gives the bed a warehouse, now that the setting is on

		ipme = self.submit_entry_for_yesterday()

		stock_entry = frappe.get_last_doc("Stock Entry", filters={"inpatient_medication_entry": ipme.name})
		self.assertEqual(stock_entry.purpose, "Material Transfer")
		self.assertEqual(stock_entry.items[0].s_warehouse, "Stores - _TC")
		self.assertEqual(stock_entry.items[0].t_warehouse, bed.warehouse)

		entry = frappe.db.get_value(
			"Inpatient Medication Order Entry",
			ipme.medication_orders[0].against_imoe,
			["status", "is_completed"],
			as_dict=True,
		)
		self.assertEqual(entry.status, "Transferred")
		self.assertEqual(entry.is_completed, 0)

	def submit_entry_for_yesterday(self):
		ipmo = create_ipmo(self.patient)
		ipmo.submit()
		ipmo.reload()

		date = add_days(getdate(), -1)
		filters = frappe._dict(
			from_date=date,
			to_date=date,
			from_time="",
			to_time="",
			item_code="Dextromethorphan",
			patient=self.patient,
		)
		make_stock_entry()
		ipme = create_ipme(filters, update_stock=1)
		ipme.save()
		ipme.submit()
		return ipme

	def test_drug_shortage_stock_entry(self):
		ipmo = create_ipmo(self.patient)
		ipmo.submit()
		ipmo.reload()

		date = add_days(getdate(), -1)
		filters = frappe._dict(
			from_date=date,
			to_date=date,
			from_time="",
			to_time="",
			item_code="Dextromethorphan",
			patient=self.patient,
		)

		# check drug shortage
		empty_warehouse("Finished Goods - _TC", "Dextromethorphan")
		ipme = create_ipme(filters, update_stock=1)
		ipme.warehouse = "Finished Goods - _TC"
		ipme.save()
		drug_shortage = get_drug_shortage_map(ipme.medication_orders, ipme.warehouse)
		self.assertEqual(drug_shortage.get("Dextromethorphan"), 3)

		# check material transfer for drug shortage
		make_stock_entry()
		stock_entry = make_difference_stock_entry(ipme.name)
		self.assertEqual(stock_entry.items[0].item_code, "Dextromethorphan")
		self.assertEqual(stock_entry.items[0].qty, 3)
		stock_entry.from_warehouse = "Stores - _TC"
		stock_entry.submit()

		ipme.reload()
		ipme.submit()


def empty_warehouse(warehouse, item_code):
	"""The shortage test needs an empty warehouse. Stock already there is not the test's, so the rollback cannot clear it."""
	from erpnext.stock.utils import get_stock_balance

	balance = get_stock_balance(item_code, warehouse)
	if balance <= 0:
		return

	stock_entry = frappe.new_doc("Stock Entry")
	stock_entry.stock_entry_type = "Material Issue"
	stock_entry.company = "_Test Company"
	stock_entry.from_warehouse = warehouse
	row = stock_entry.append("items")
	row.item_code = item_code
	row.qty = balance
	row.s_warehouse = warehouse
	row.conversion_factor = 1
	row.expense_account = get_account(None, "expense_account", "Healthcare Settings", "_Test Company")
	stock_entry.submit()
