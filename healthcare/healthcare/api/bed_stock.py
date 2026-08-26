# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Settling the medication left at a bed when the patient leaves.

Whatever was transferred to the bed but never administered was never billed
either, so it can go back to the pharmacy for nothing, or onto the patient's
bill if they take it home. Both are started by hand, at discharge.
"""

import json

import frappe
from frappe import _
from frappe.utils import flt, nowdate, nowtime

from healthcare.healthcare.ward_stock import WardIssue, WardStore, set_batch


class BedStock:
	"""What is left in the warehouse of the bed a patient occupies."""

	def __init__(self, inpatient_record):
		self.inpatient_record = inpatient_record
		self.store = WardStore(inpatient_record)
		self.warehouse = self.store.warehouse()
		self.company = self.store.admission.company

	def items(self):
		"""Read the balance from the warehouse itself rather than working it out
		from what was ordered, so a bed the ward has already tidied reads empty."""
		if not self.warehouse:
			return []

		from erpnext.stock.doctype.stock_reconciliation.stock_reconciliation import get_items

		rows = get_items(self.warehouse, nowdate(), nowtime(), self.company, ignore_empty_stock=True)
		return [self.as_item(row) for row in rows if flt(row.get("qty")) > 0]

	def as_item(self, row):
		item_code = row.get("item_code")
		return {
			"item_code": item_code,
			"item_name": frappe.get_cached_value("Item", item_code, "item_name"),
			"quantity": flt(row.get("qty")),
			"batch_no": row.get("batch_no"),
		}

	def return_to_pharmacy(self, warehouse):
		"""A draft for the pharmacy to check against what actually came back."""
		transfer = frappe.new_doc("Stock Entry")
		transfer.stock_entry_type = "Material Transfer"
		transfer.company = self.company
		transfer.from_warehouse = self.warehouse
		transfer.to_warehouse = warehouse

		for item in self.required_items():
			self.add_transfer_item(transfer, item, warehouse)

		return transfer

	def add_transfer_item(self, transfer, item, warehouse):
		row = transfer.append("items")
		row.item_code = item["item_code"]
		row.qty = item["quantity"]
		row.conversion_factor = 1
		row.s_warehouse = self.warehouse
		row.t_warehouse = warehouse
		if item.get("batch_no"):
			set_batch(row, item["batch_no"])

	def sell_to_patient(self, items=None):
		"""Taken home for continued medication, so it goes on the bill the same
		way a dose given at the bedside does."""
		return WardIssue(self.inpatient_record, self.warehouse).record(items or self.required_items())

	def required_items(self):
		items = self.items()
		if not items:
			frappe.throw(_("There is no medication left at this bed"), title=_("Nothing to Settle"))

		return items


@frappe.whitelist()
def get_bed_stock(inpatient_record):
	bed = BedStock(inpatient_record)
	return {"warehouse": bed.warehouse, "items": bed.items()}


@frappe.whitelist()
def return_to_pharmacy(inpatient_record, warehouse):
	return BedStock(inpatient_record).return_to_pharmacy(warehouse)


@frappe.whitelist()
def sell_to_patient(inpatient_record, items=None):
	if isinstance(items, str):
		items = json.loads(items)

	return BedStock(inpatient_record).sell_to_patient(items)
