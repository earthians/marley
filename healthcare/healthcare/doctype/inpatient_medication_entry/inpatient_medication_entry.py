# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import datetime

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, get_link_to_form, get_time, getdate

from erpnext.stock.utils import get_latest_stock_qty

from healthcare.healthcare.doctype.healthcare_service_unit.healthcare_service_unit import (
	manages_medication_stock,
)
from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import get_account
from healthcare.healthcare.doctype.inpatient_medication_entry.medication_stock_entry import (
	make_stock_entry,
)


class InpatientMedicationEntry(Document):
	def validate(self):
		self.validate_medication_orders()

	@frappe.whitelist()
	def get_medication_orders(self):
		# pull inpatient medication orders based on selected filters
		orders = get_pending_medication_orders(self)

		if orders:
			self.add_mo_to_table(orders)
			return self
		else:
			self.set("medication_orders", [])
			frappe.msgprint(_("No pending medication orders found for selected criteria"))

	def add_mo_to_table(self, orders):
		# Add medication orders in the child table
		self.set("medication_orders", [])
		for data in orders:
			self.append(
				"medication_orders",
				{
					"patient": data.patient,
					"patient_name": data.patient_name,
					"inpatient_record": data.inpatient_record,
					"service_unit": data.service_unit,
					"datetime": datetime.datetime.combine(getdate(data.date), get_time(data.time)),
					"drug_code": data.drug,
					"drug_name": data.drug_name,
					"dosage": data.dosage,
					"dosage_form": data.dosage_form,
					"against_imo": data.parent,
					"against_imoe": data.name,
				},
			)

	def on_submit(self):
		self.validate_medication_orders()
		success_msg = ""
		if self.update_stock:
			stock_entry = self.process_stock()
			success_msg += _("Stock Entry {0} created and ").format(
				frappe.bold(get_link_to_form("Stock Entry", stock_entry))
			)

		self.update_medication_orders()
		success_msg += _("Inpatient Medication Orders updated successfully")
		frappe.msgprint(success_msg, title=_("Success"), indicator="green")

	def validate_medication_orders(self):
		for entry in self.medication_orders:
			docstatus, status = frappe.db.get_value(
				"Inpatient Medication Order Entry", entry.against_imoe, ["docstatus", "status"]
			)

			if docstatus == 2:
				frappe.throw(
					_(
						"Row {0}: Cannot create Inpatient Medication Entry against cancelled Inpatient Medication Order {1}"
					).format(entry.idx, get_link_to_form(entry.against_imo))
				)

			if status and status != "Pending":
				frappe.throw(
					_("Row {0}: This Medication Order is already {1}").format(
						entry.idx, frappe.bold(_(status))
					)
				)

	def on_cancel(self):
		self.cancel_stock_entries()
		self.update_medication_orders(on_cancel=True)

	def process_stock(self):
		allow_negative_stock = frappe.db.get_single_value("Stock Settings", "allow_negative_stock")
		if not allow_negative_stock:
			self.check_stock_qty()

		return make_stock_entry(self)

	def update_medication_orders(self, on_cancel=False):
		orders, medication_orders = self.get_order_entry_map()

		if not orders:
			return

		self.set_order_entry_status("Pending" if on_cancel else self.status_after_entry(), orders)

		for order in medication_orders:
			frappe.get_doc("Inpatient Medication Order", order).update_completed_orders()

	def status_after_entry(self):
		"""Where medication is managed at the bed, this entry has only moved the
		drug there. The dose is completed when a nurse administers it."""
		return "Transferred" if manages_medication_stock() else "Completed"

	def set_order_entry_status(self, status, orders):
		order_entry = frappe.qb.DocType("Inpatient Medication Order Entry")

		(
			frappe.qb.update(order_entry)
			.set(order_entry.status, status)
			.set(order_entry.is_completed, 1 if status == "Completed" else 0)
			.where(order_entry.name.isin(orders))
		).run()

	def get_order_entry_map(self):
		orders = [entry.against_imoe for entry in self.medication_orders]
		medication_orders = {entry.against_imo for entry in self.medication_orders}
		return orders, medication_orders

	def check_stock_qty(self):
		drug_shortage = get_drug_shortage_map(self.medication_orders, self.warehouse)

		if drug_shortage:
			message = _("Quantity not available for the following items in warehouse {0}. ").format(
				frappe.bold(self.warehouse)
			)
			message += _(
				"Please enable Allow Negative Stock in Stock Settings or create Stock Entry to proceed."
			)

			formatted_item_rows = ""

			for drug, shortage_qty in drug_shortage.items():
				item_link = get_link_to_form("Item", drug)
				formatted_item_rows += f"""
					<td>{item_link}</td>
					<td>{frappe.bold(shortage_qty)}</td>
				</tr>"""

			message += f"""
				<table class='table'>
					<thead>
						<th>{_("Drug Code")}</th>
						<th>{_("Shortage Qty")}</th>
					</thead>
					{formatted_item_rows}
				</table>
			"""

			frappe.throw(message, title=_("Insufficient Stock"), is_minimizable=True, wide=True)

	def cancel_stock_entries(self):
		stock_entries = frappe.get_all("Stock Entry", {"inpatient_medication_entry": self.name})
		for entry in stock_entries:
			doc = frappe.get_doc("Stock Entry", entry.name)
			doc.cancel()


def get_pending_medication_orders(entry):
	inpatient_medication_order = frappe.qb.DocType("Inpatient Medication Order")
	medication_order_entry = frappe.qb.DocType("Inpatient Medication Order Entry")

	query = (
		frappe.qb.from_(inpatient_medication_order)
		.inner_join(medication_order_entry)
		.on(inpatient_medication_order.name == medication_order_entry.parent)
		.select(
			inpatient_medication_order.inpatient_record,
			inpatient_medication_order.patient,
			inpatient_medication_order.patient_name,
			medication_order_entry.name,
			medication_order_entry.parent,
			medication_order_entry.drug,
			medication_order_entry.drug_name,
			medication_order_entry.dosage,
			medication_order_entry.dosage_form,
			medication_order_entry.date,
			medication_order_entry.time,
			medication_order_entry.instructions,
		)
		.where(inpatient_medication_order.docstatus == 1)
		.where(inpatient_medication_order.company == entry.company)
		.where(medication_order_entry.status == "Pending")
		.orderby(medication_order_entry.date)
		.orderby(medication_order_entry.time)
	)

	if entry.from_date:
		query = query.where(medication_order_entry.date >= entry.from_date)

	if entry.to_date:
		query = query.where(medication_order_entry.date <= entry.to_date)

	if entry.from_time:
		query = query.where(medication_order_entry.time >= entry.from_time)

	if entry.to_time:
		query = query.where(medication_order_entry.time <= entry.to_time)

	if entry.patient:
		query = query.where(inpatient_medication_order.patient == entry.patient)

	if entry.practitioner:
		query = query.where(inpatient_medication_order.practitioner == entry.practitioner)

	if entry.item_code:
		query = query.where(medication_order_entry.drug == entry.item_code)

	if entry.assigned_to_practitioner:
		query = query.where(inpatient_medication_order["_assign"].like(f"%{entry.assigned_to_practitioner}%"))

	data = query.run(as_dict=True)

	filtered_data = []

	for doc in data:
		if doc.inpatient_record:
			doc.service_unit = get_current_healthcare_service_unit(doc.inpatient_record)

		if entry.service_unit and doc.service_unit != entry.service_unit:
			continue

		filtered_data.append(doc)

	return filtered_data


def get_current_healthcare_service_unit(inpatient_record):
	inpatient_record_doc = frappe.get_doc("Inpatient Record", inpatient_record)

	if (
		inpatient_record_doc.status in ["Admitted", "Discharge Scheduled"]
		and inpatient_record_doc.inpatient_occupancies
	):
		return inpatient_record_doc.inpatient_occupancies[-1].service_unit

	return None


def get_drug_shortage_map(medication_orders, warehouse):
	"""
	Returns a dict like { drug_code: shortage_qty }
	"""
	drug_requirement = dict()
	for d in medication_orders:
		if not drug_requirement.get(d.drug_code):
			drug_requirement[d.drug_code] = 0
		drug_requirement[d.drug_code] += flt(d.dosage)

	drug_shortage = dict()
	for drug, required_qty in drug_requirement.items():
		available_qty = get_latest_stock_qty(drug, warehouse) or 0
		if flt(required_qty) > flt(available_qty):
			drug_shortage[drug] = flt(flt(required_qty) - flt(available_qty))

	return drug_shortage


@frappe.whitelist()
def make_difference_stock_entry(docname):
	doc = frappe.get_doc("Inpatient Medication Entry", docname)
	drug_shortage = get_drug_shortage_map(doc.medication_orders, doc.warehouse)

	if not drug_shortage:
		return None

	stock_entry = frappe.new_doc("Stock Entry")
	stock_entry.purpose = "Material Transfer"
	stock_entry.set_stock_entry_type()
	stock_entry.to_warehouse = doc.warehouse
	stock_entry.company = doc.company
	cost_center = frappe.get_cached_value("Company", doc.company, "cost_center")
	expense_account = get_account(None, "expense_account", "Healthcare Settings", doc.company)

	for drug, shortage_qty in drug_shortage.items():
		se_child = stock_entry.append("items")
		se_child.item_code = drug
		se_child.item_name = frappe.db.get_value("Item", drug, "stock_uom")
		se_child.uom = frappe.db.get_value("Item", drug, "stock_uom")
		se_child.stock_uom = se_child.uom
		se_child.qty = flt(shortage_qty)
		se_child.t_warehouse = doc.warehouse
		# in stock uom
		se_child.conversion_factor = 1
		se_child.cost_center = cost_center
		se_child.expense_account = expense_account

	return stock_entry
