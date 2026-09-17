# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Settling what is left at a bed when the patient leaves.

Medication that was transferred to the bed but never administered was never
billed either, so it can go back to the pharmacy for nothing, or onto the
patient's bill if they take it home. Ward consumables kept at the bed only
ever go back to the ward store. Both are started by hand, at discharge.
"""

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
		prescribed = self.prescribed_items()
		return [self.as_item(row, prescribed) for row in rows if flt(row.get("qty")) > 0]

	def as_item(self, row, prescribed):
		item_code = row.get("item_code")
		return {
			"item_code": item_code,
			"item_name": frappe.get_cached_value("Item", item_code, "item_name"),
			"quantity": flt(row.get("qty")),
			"batch_no": row.get("batch_no"),
			"is_medication": item_code in prescribed,
		}

	def prescribed_items(self):
		"""Medication is whatever was ordered for this admission; it is what the
		pharmacy transferred to the bed. Anything else at the bed is ward stock."""
		orders = frappe.get_all(
			"Inpatient Medication Order", filters={"inpatient_record": self.inpatient_record}, pluck="name"
		)
		if not orders:
			return set()

		return set(
			frappe.get_all(
				"Inpatient Medication Order Entry", filters={"parent": ["in", orders]}, pluck="drug"
			)
		)

	def split(self):
		"""Medication and consumables, in that order."""
		items = self.items()
		medication = [item for item in items if item["is_medication"]]
		consumables = [item for item in items if not item["is_medication"]]
		return medication, consumables

	def return_leftovers(self, pharmacy, ward_store=None):
		"""One draft transfer for the ward to check against what actually went
		back: medication to the pharmacy, consumables to the ward store."""
		medication, consumables = self.split()
		if not medication and not consumables:
			frappe.throw(_("There is nothing left at this bed"), title=_("Nothing to Settle"))
		if consumables and not ward_store:
			frappe.throw(_("Choose the ward store the consumables go back to"))

		transfer = frappe.new_doc("Stock Entry")
		transfer.stock_entry_type = "Material Transfer"
		transfer.company = self.company
		transfer.from_warehouse = self.warehouse
		transfer.to_warehouse = pharmacy
		for item in medication:
			self.add_transfer_item(transfer, item, pharmacy)
		for item in consumables:
			self.add_transfer_item(transfer, item, ward_store)

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

	def sell_to_patient(self):
		"""Medication taken home for continued treatment goes on the bill the
		same way a dose given at the bedside does. Consumables are never sold."""
		medication, _consumables = self.split()
		if not medication:
			frappe.throw(_("There is no medication left at this bed to sell"), title=_("Nothing to Sell"))

		return WardIssue(self.inpatient_record, self.warehouse).record(medication)


@frappe.whitelist()
def get_bed_stock(inpatient_record):
	bed = BedStock(inpatient_record)
	return {"warehouse": bed.warehouse, "items": bed.items()}


@frappe.whitelist()
def return_leftovers(inpatient_record, pharmacy, ward_store=None):
	return BedStock(inpatient_record).return_leftovers(pharmacy, ward_store)


@frappe.whitelist()
def sell_to_patient(inpatient_record):
	return BedStock(inpatient_record).sell_to_patient()
