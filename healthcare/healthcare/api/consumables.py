# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _

from healthcare.healthcare.ward_stock import WardIssue, WardStore

# Consumables bill through Inpatient Record Item, so they need an admission.
RECENT_ROWS = 20


class ConsumableRecorder:
	"""Issues stock from the ward and adds the items to the patient's billables."""

	def __init__(self, inpatient_record):
		self.inpatient_record = inpatient_record
		self.store = WardStore(inpatient_record)

	def record(self, items):
		warehouse = self.store.warehouse() or self.store.company_warehouse()
		if not warehouse:
			frappe.throw(_("No warehouse found for this patient's service unit"))

		return WardIssue(self.inpatient_record, warehouse).record(items)


def inpatient_record_for(patient):
	return frappe.db.get_value("Patient", patient, "inpatient_record")


@frappe.whitelist()
def get_consumable_context(patient):
	"""Whether consumables can be recorded here, and where stock comes from."""
	inpatient_record = inpatient_record_for(patient)
	if not inpatient_record:
		return {"inpatient_record": None, "warehouse": None}

	store = WardStore(inpatient_record)
	return {
		"inpatient_record": inpatient_record,
		"warehouse": store.warehouse() or store.company_warehouse(),
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
