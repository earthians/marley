import frappe
from frappe.utils import add_days, getdate

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import get_account

DRUG = "_Test Batched Drug"
PHARMACY = "Stores - _TC"


def make_stock_entry(warehouse=None):
	frappe.db.set_value(
		"Company",
		"_Test Company",
		{
			"stock_adjustment_account": "Stock Adjustment - _TC",
			"default_inventory_account": "Stock In Hand - _TC",
		},
	)
	stock_entry = frappe.new_doc("Stock Entry")
	stock_entry.stock_entry_type = "Material Receipt"
	stock_entry.company = "_Test Company"
	stock_entry.to_warehouse = warehouse or "Stores - _TC"
	expense_account = get_account(None, "expense_account", "Healthcare Settings", "_Test Company")
	se_child = stock_entry.append("items")
	se_child.item_code = "Dextromethorphan"
	se_child.item_name = "Dextromethorphan"
	se_child.uom = "Nos"
	se_child.stock_uom = "Nos"
	se_child.qty = 6
	se_child.t_warehouse = "Stores - _TC"
	# in stock uom
	se_child.conversion_factor = 1.0
	se_child.expense_account = expense_account
	stock_entry.submit()


def create_ipmo(patient):
	orders = get_orders()
	ipmo = frappe.new_doc("Inpatient Medication Order")
	ipmo.patient = patient
	ipmo.company = "_Test Company"
	ipmo.start_date = add_days(getdate(), -1)
	ipmo.add_order_entries(orders)

	return ipmo


def create_ipme(filters, update_stock=0):
	ipme = frappe.new_doc("Inpatient Medication Entry")
	ipme.company = "_Test Company"
	ipme.posting_date = getdate()
	ipme.update_stock = update_stock
	if update_stock:
		ipme.warehouse = "Stores - _TC"
	for key, value in filters.items():
		ipme.set(key, value)
	ipme = ipme.get_medication_orders()

	return ipme


def mark_invoiced_inpatient_occupancy(ip_record):
	if ip_record.inpatient_occupancies:
		for inpatient_occupancy in ip_record.inpatient_occupancies:
			inpatient_occupancy.invoiced = 1
		ip_record.save(ignore_permissions=True)


def receive_batch(batch_id, expiry, qty, warehouse=PHARMACY):
	"""Take the batch into the warehouse, and return the name it is linked by.

	A Batch is named by hash, so the batch number a pharmacist reads off the
	strip is only its batch_id, and stock rows link to the name."""
	batch_no = batch_with_expiry(batch_id, expiry)
	entry = frappe.new_doc("Stock Entry")
	entry.stock_entry_type = "Material Receipt"
	entry.company = "_Test Company"
	entry.to_warehouse = warehouse
	row = entry.append("items")
	row.item_code = DRUG
	row.qty = qty
	row.t_warehouse = warehouse
	row.basic_rate = 10
	row.conversion_factor = 1
	row.use_serial_batch_fields = 1
	row.batch_no = batch_no
	entry.submit()
	return batch_no


def get_orders():
	create_dosage_form()
	create_drug()
	return {
		"drug_code": "Dextromethorphan",
		"drug_name": "Dextromethorphan",
		"dosage": "1-1-1",
		"dosage_form": "Tablet",
		"period": "2 Day",
	}


def batch_with_expiry(batch_id, expiry):
	"""A batch that outlived an earlier run still carries that run's expiry, and
	expiry is what these tests order stock by, so say it again."""
	batch_no = frappe.db.get_value("Batch", {"item": DRUG, "batch_id": batch_id}, "name")
	if not batch_no:
		return (
			frappe.get_doc({"doctype": "Batch", "batch_id": batch_id, "item": DRUG, "expiry_date": expiry})
			.insert(ignore_permissions=True)
			.name
		)

	frappe.db.set_value("Batch", batch_no, "expiry_date", expiry)
	return batch_no


def create_dosage_form():
	if not frappe.db.exists("Dosage Form", "Tablet"):
		frappe.get_doc({"doctype": "Dosage Form", "dosage_form": "Tablet"}).insert()


def create_drug(item=None):
	if not item:
		item = "Dextromethorphan"
	drug = frappe.db.exists("Item", {"item_code": "Dextromethorphan"})
	if not drug:
		drug = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": "Dextromethorphan",
				"item_name": "Dextromethorphan",
				"item_group": "Products",
				"stock_uom": "Nos",
				"is_stock_item": 1,
				"valuation_rate": 50,
				"opening_stock": 20,
			}
		).insert()
