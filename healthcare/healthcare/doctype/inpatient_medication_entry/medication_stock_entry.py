# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt, get_link_to_form

from healthcare.healthcare.doctype.healthcare_service_unit.healthcare_service_unit import (
	manages_medication_stock,
)
from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import get_account
from healthcare.healthcare.ward_stock import bed_warehouse, set_batch


def make_stock_entry(medication_entry):
	"""Issue the drugs, or move them to the bed they were prescribed for."""
	builder = ServiceUnitTransfer if manages_medication_stock() else MedicationIssue
	return builder(medication_entry).create()


class MedicationStockEntry:
	"""Builds the Stock Entry an Inpatient Medication Entry submits."""

	purpose = "Material Issue"

	def __init__(self, medication_entry):
		self.medication_entry = medication_entry
		self.company = medication_entry.company
		self.source = medication_entry.warehouse
		self.cost_center = frappe.get_cached_value("Company", self.company, "cost_center")
		self.expense_account = get_account(None, "expense_account", "Healthcare Settings", self.company)

	def create(self):
		self.validate()

		stock_entry = self.new_stock_entry()
		for order in self.medication_entry.medication_orders:
			self.add_order(stock_entry, order)

		stock_entry.submit()
		return stock_entry.name

	def validate(self):
		"""Nothing to check before drugs simply leave the pharmacy."""

	def new_stock_entry(self):
		stock_entry = frappe.new_doc("Stock Entry")
		stock_entry.purpose = self.purpose
		stock_entry.set_stock_entry_type()
		stock_entry.company = self.company
		stock_entry.from_warehouse = self.source
		stock_entry.inpatient_medication_entry = self.medication_entry.name
		return stock_entry

	def add_order(self, stock_entry, order):
		for allocation in self.allocate(order):
			self.add_item(stock_entry, order, allocation)

	def allocate(self, order):
		"""One row for the whole dose, leaving batches to ERPNext."""
		return [frappe._dict(qty=flt(order.dosage))]

	def add_item(self, stock_entry, order, allocation):
		row = stock_entry.append("items")
		row.item_code = order.drug_code
		row.item_name = order.drug_name
		row.uom = row.stock_uom = frappe.get_cached_value("Item", order.drug_code, "stock_uom")
		row.qty = flt(allocation.qty)
		# in stock uom
		row.conversion_factor = 1
		row.cost_center = self.cost_center
		row.expense_account = self.expense_account
		row.s_warehouse = self.source
		# references
		row.patient = order.patient
		row.inpatient_medication_entry_child = order.name

		if allocation.get("batch_no"):
			set_batch(row, allocation.batch_no)

		self.set_target(row, order)
		return row

	def set_target(self, row, order):
		"""An issue has no destination."""


class MedicationIssue(MedicationStockEntry):
	"""Drugs leave the pharmacy for the patient, the way they always have."""

	purpose = "Material Issue"


class ServiceUnitTransfer(MedicationStockEntry):
	"""Drugs move to the warehouse of the bed the patient occupies, and are
	issued later, when a nurse administers the dose."""

	purpose = "Material Transfer"

	def validate(self):
		beds = {order.service_unit for order in self.medication_entry.medication_orders}
		missing = sorted(bed for bed in beds if not self.target_for(bed))
		if not missing:
			return

		frappe.throw(
			_("These service units have no warehouse to transfer medication to: {0}").format(
				", ".join(get_link_to_form("Healthcare Service Unit", bed) for bed in missing if bed)
				or _("the patient is not in a bed")
			),
			title=_("Nowhere to Transfer"),
		)

	def set_target(self, row, order):
		row.t_warehouse = self.target_for(order.service_unit)

	def target_for(self, service_unit):
		return bed_warehouse(service_unit) if service_unit else None

	def allocate(self, order):
		"""Earliest expiry first, so short-dated stock moves before it lapses.
		Whatever the batches cannot cover is left on the last of them, for the
		negative stock settings to rule on."""
		if not frappe.get_cached_value("Item", order.drug_code, "has_batch_no"):
			return super().allocate(order)

		required = flt(order.dosage)
		allocations = self.available_batches(order.drug_code, required)
		if not allocations:
			return super().allocate(order)

		shortfall = required - sum(flt(batch.qty) for batch in allocations)
		if shortfall > 0:
			allocations[-1].qty = flt(allocations[-1].qty) + shortfall

		return allocations

	def available_batches(self, drug, required):
		from erpnext.stock.doctype.serial_and_batch_bundle.serial_and_batch_bundle import (
			get_auto_batch_nos,
		)

		# Availability is read as of now, to match the Stock Entry this builds:
		# the entry carries no posting time, and a date without one is rejected.
		return get_auto_batch_nos(
			frappe._dict(item_code=drug, warehouse=self.source, qty=required, based_on="Expiry")
		)
