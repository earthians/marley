# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _
from frappe.utils import flt

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import get_account

# Consumables bill through Inpatient Record Item, so they need an admission.
RECENT_ROWS = 20


class WardStore:
	"""Where a patient's consumables are drawn from."""

	def __init__(self, inpatient_record):
		self.admission = frappe.get_doc("Inpatient Record", inpatient_record)

	def warehouse(self):
		return self.service_unit_warehouse() or self.company_warehouse()

	def service_unit_warehouse(self):
		occupancy = [row for row in self.admission.inpatient_occupancies if not row.left]
		if not occupancy:
			return None

		return frappe.db.get_value("Healthcare Service Unit", occupancy[-1].service_unit, "warehouse")

	def company_warehouse(self):
		return frappe.db.get_value("Company", self.admission.company, "default_warehouse")


class ConsumableRecorder:
	"""Issues stock from the ward and adds the items to the patient's billables."""

	def __init__(self, inpatient_record):
		self.admission = frappe.get_doc("Inpatient Record", inpatient_record)
		self.store = WardStore(inpatient_record)

	def record(self, items):
		warehouse = self.store.warehouse()
		if not warehouse:
			frappe.throw(_("No warehouse found for this patient's service unit"))

		stock_entry = self.issue_stock(items, warehouse)
		self.add_to_billables(items, stock_entry)
		return stock_entry

	def issue_stock(self, items, warehouse):
		stock_entry = frappe.new_doc("Stock Entry")
		stock_entry.stock_entry_type = "Material Issue"
		stock_entry.from_warehouse = warehouse
		stock_entry.company = self.admission.company

		cost_center = frappe.get_cached_value("Company", self.admission.company, "cost_center")
		expense_account = get_account(None, "expense_account", "Healthcare Settings", self.admission.company)

		for item in items:
			row = stock_entry.append("items")
			row.item_code = item.get("item_code")
			row.qty = flt(item.get("quantity"))
			row.s_warehouse = warehouse
			row.cost_center = cost_center
			row.expense_account = expense_account
			if item.get("batch_no"):
				self.set_batch(row, item.get("batch_no"))
			row.patient = self.admission.patient

		stock_entry.save(ignore_permissions=True)
		stock_entry.submit()
		return stock_entry.name

	def set_batch(self, row, batch_no):
		"""ERPNext reads batch_no only when the row opts out of batch bundles.
		Where a site uses bundles instead, say so rather than quietly dropping
		the batch the nurse picked."""
		if not frappe.db.get_single_value("Stock Settings", "use_serial_batch_fields"):
			frappe.throw(
				_("Enable {0} in Stock Settings to record a batch against a consumable").format(
					frappe.bold(_("Use Serial / Batch fields"))
				)
			)

		row.use_serial_batch_fields = 1
		row.batch_no = batch_no

	def add_to_billables(self, items, stock_entry):
		"""A billable row only invoices once it carries its stock entry."""
		for item in items:
			stock_uom = frappe.db.get_value("Item", item.get("item_code"), "stock_uom")
			self.admission.append(
				"items",
				{
					"item_code": item.get("item_code"),
					"item_name": frappe.db.get_value("Item", item.get("item_code"), "item_name"),
					"quantity": flt(item.get("quantity")),
					"uom": stock_uom,
					"stock_uom": stock_uom,
					"conversion_factor": 1,
					"stock_entry": stock_entry,
				},
			)
		self.admission.save(ignore_permissions=True)


def inpatient_record_for(patient):
	return frappe.db.get_value("Patient", patient, "inpatient_record")


@frappe.whitelist()
def get_consumable_context(patient):
	"""Whether consumables can be recorded here, and where stock comes from."""
	inpatient_record = inpatient_record_for(patient)
	if not inpatient_record:
		return {"inpatient_record": None, "warehouse": None}

	return {
		"inpatient_record": inpatient_record,
		"warehouse": WardStore(inpatient_record).warehouse(),
	}


@frappe.whitelist()
def record_consumables(patient, items):
	if isinstance(items, str):
		items = json.loads(items)

	if not items:
		frappe.throw(_("Add at least one item"))

	inpatient_record = inpatient_record_for(patient)
	if not inpatient_record:
		frappe.throw(_("Consumables are recorded against an admission"))

	return ConsumableRecorder(inpatient_record).record(items)


@frappe.whitelist()
def get_consumables(patient, limit=RECENT_ROWS):
	"""Items issued on this admission, most recent first.

	Child rows carry the parent's creation timestamp, so they cannot be filtered
	by time; a row with a stock entry is one that was actually issued.
	"""
	inpatient_record = inpatient_record_for(patient)
	if not inpatient_record:
		return []

	return frappe.get_all(
		"Inpatient Record Item",
		filters={"parent": inpatient_record, "stock_entry": ["is", "set"]},
		fields=["name", "item_code", "item_name", "quantity", "uom", "stock_entry", "invoiced"],
		order_by="idx desc",
		limit=limit,
	)
