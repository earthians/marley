# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import get_account


class WardStore:
	"""Where a patient's ward stock is drawn from."""

	def __init__(self, inpatient_record):
		self.admission = frappe.get_doc("Inpatient Record", inpatient_record)

	def warehouse(self):
		"""The warehouse of the bed the patient occupies, and nothing else.

		Medication issued from anywhere else could not be traced back to the bed
		it was transferred to. Callers that can live with a looser answer, such
		as consumables, fall back to the company warehouse themselves.
		"""
		service_unit = self.service_unit()
		return bed_warehouse(service_unit) if service_unit else None

	def service_unit(self):
		"""The bed the patient is in now, rather than one they have left."""
		occupancy = [row for row in self.admission.inpatient_occupancies if not row.left]
		return occupancy[-1].service_unit if occupancy else None

	def company_warehouse(self):
		return frappe.db.get_value("Company", self.admission.company, "default_warehouse")


def bed_warehouse(service_unit):
	return frappe.db.get_value("Healthcare Service Unit", service_unit, "warehouse")


def set_batch(row, batch_no):
	"""ERPNext reads batch_no only when the row opts out of batch bundles.
	Where a site uses bundles instead, say so rather than quietly dropping
	the batch that was picked."""
	if not frappe.db.get_single_value("Stock Settings", "use_serial_batch_fields"):
		frappe.throw(
			_("Enable {0} in Stock Settings to record a batch").format(
				frappe.bold(_("Use Serial / Batch fields"))
			)
		)

	row.use_serial_batch_fields = 1
	row.batch_no = batch_no


class WardIssue:
	"""Issues stock from a ward warehouse and bills it to the admission.

	Consumables and administered medication both leave the ward this way: the
	stock goes out, and a billable row carrying the Stock Entry follows it, so
	the discharge invoice picks the item up.
	"""

	def __init__(self, inpatient_record, warehouse):
		self.admission = frappe.get_doc("Inpatient Record", inpatient_record)
		self.warehouse = warehouse
		self.company = self.admission.company

	def record(self, items):
		stock_entry = self.issue(items)
		self.add_to_billables(items, stock_entry)
		return stock_entry

	def issue(self, items):
		stock_entry = frappe.new_doc("Stock Entry")
		stock_entry.stock_entry_type = "Material Issue"
		stock_entry.from_warehouse = self.warehouse
		stock_entry.company = self.company

		for item in items:
			self.add_item(stock_entry, item)

		stock_entry.save(ignore_permissions=True)
		stock_entry.submit()
		return stock_entry.name

	def add_item(self, stock_entry, item):
		row = stock_entry.append("items")
		row.item_code = item.get("item_code")
		row.qty = flt(item.get("quantity"))
		row.s_warehouse = self.warehouse
		row.cost_center = frappe.get_cached_value("Company", self.company, "cost_center")
		row.expense_account = get_account(None, "expense_account", "Healthcare Settings", self.company)
		if item.get("batch_no"):
			set_batch(row, item.get("batch_no"))
		row.patient = self.admission.patient
		return row

	def add_to_billables(self, items, stock_entry):
		"""A billable row only invoices once it carries its stock entry."""
		for item in items:
			self.admission.append("items", self.billable(item, stock_entry))

		self.admission.save(ignore_permissions=True)

	def billable(self, item, stock_entry):
		item_name, stock_uom = frappe.db.get_value("Item", item.get("item_code"), ["item_name", "stock_uom"])
		return {
			"item_code": item.get("item_code"),
			"item_name": item_name,
			"quantity": flt(item.get("quantity")),
			"uom": stock_uom,
			"stock_uom": stock_uom,
			"conversion_factor": 1,
			"stock_entry": stock_entry,
		}
