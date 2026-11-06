# Copyright (c) 2017, ESS LLP and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.mapper import get_mapped_doc
from frappe.utils import (
	add_to_date,
	flt,
	get_datetime,
	get_link_to_form,
	now_datetime,
	nowdate,
	nowtime,
)

from erpnext.stock.get_item_details import ItemDetailsCtx, get_item_details
from erpnext.stock.stock_ledger import get_previous_sle

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import get_account
from healthcare.healthcare.doctype.lab_test.lab_test import create_sample_doc
from healthcare.healthcare.doctype.nursing_task.nursing_task import NursingTask
from healthcare.healthcare.doctype.service_request.service_request import (
	update_service_request_status,
)
from healthcare.healthcare.utils import validate_nursing_tasks


class ClinicalProcedure(Document):
	def validate(self):
		self.set_status()
		self.set_title()
		self.set_planned_start_date_and_time()
		self.set_planned_endtime()
		self.invoice_separately_as_consumables = any(
			item.invoice_separately_as_consumables for item in self.items
		)

	def before_insert(self):
		self.validate_no_open_draft_for_service_request()
		self.set_price_list()

	def before_cancel(self):
		self.set_status()

	def on_cancel(self):
		if self.service_request:
			update_service_request_status(self.service_request, "active-Request Status")

	def after_insert(self):
		if self.appointment:
			frappe.db.set_value("Patient Appointment", self.appointment, "status", "Closed")
		self.create_sample_collection()

	def on_submit(self):
		self.create_pre_op_tasks()
		if self.service_request:
			update_service_request_status(self.service_request, self.request_status_after_submit())

	def validate_no_open_draft_for_service_request(self):
		if not self.service_request:
			return
		existing_procedure = frappe.db.exists(
			"Clinical Procedure", {"service_request": self.service_request, "docstatus": 0}
		)
		if existing_procedure:
			frappe.throw(
				_("Clinical Procedure {0} already created from service request {1}").format(
					frappe.bold(get_link_to_form("Clinical Procedure", existing_procedure)),
					frappe.bold(get_link_to_form("Service Request", self.service_request)),
				),
				title=_("Already Exist"),
			)

	def create_sample_collection(self):
		if not self.get_template_value("sample"):
			return
		template = frappe.get_doc("Clinical Procedure Template", self.procedure_template)
		patient = frappe.get_doc("Patient", self.patient)
		sample_collection = create_sample_doc(template, patient, None, self.company)
		self.db_set("sample", sample_collection.name)
		self.notify_update()

	def request_status_after_submit(self):
		if self.check_sessions_completed():
			return "completed-Request Status"
		return "active-Request Status"

	def create_pre_op_tasks(self):
		start_time = get_datetime(f"{self.start_date} {self.start_time or nowtime()}")
		self.create_checklist_tasks("pre_op_nursing_checklist_template", start_time, post_event=False)

	def create_post_op_tasks(self):
		self.create_checklist_tasks("post_op_nursing_checklist_template", now_datetime(), post_event=True)

	def create_checklist_tasks(self, template_field, start_time, post_event):
		template = self.get_template_value(template_field)
		if template:
			NursingTask.create_nursing_tasks_from_template(
				template, self, start_time=start_time, post_event=post_event
			)

	def get_template_value(self, fieldname):
		if self.procedure_template:
			return frappe.db.get_value("Clinical Procedure Template", self.procedure_template, fieldname)

	def set_price_list(self):
		if self.price_list:
			return

		customer = frappe.db.get_value("Patient", self.patient, "customer")
		if customer:
			self.price_list = frappe.db.get_value("Customer", customer, "default_price_list")

		if not self.price_list:
			self.price_list = frappe.db.get_single_value("Selling Settings", "selling_price_list")

	def set_planned_start_date_and_time(self):
		if not self.appointment or (self.start_date and self.start_time):
			return

		self.start_date, self.start_time = frappe.db.get_value(
			"Patient Appointment", self.appointment, ["appointment_date", "appointment_time"]
		)

	def set_planned_endtime(self):
		if not self.procedure_template or not self.start_time:
			return

		duration = self.get_template_value("default_duration")
		if duration:
			start = get_datetime(f"{self.start_date} {self.start_time}")
			self.planned_end_datetime = add_to_date(start, seconds=duration)

	def set_status(self):
		if self.docstatus == 0:
			self.status = "Draft"
		elif self.docstatus == 1:
			if self.status not in ["In Progress", "Completed"]:
				self.status = "Pending"
		elif self.docstatus == 2:
			self.status = "Cancelled"

	def set_title(self):
		self.title = _("{0} - {1}").format(self.patient_name or self.patient, self.procedure_template)[:100]

	@frappe.whitelist()
	def complete_procedure(self):
		self.check_permission("write")
		if self.status != "In Progress":
			frappe.throw(_("Only a procedure that is In Progress can be completed"))

		stock_entry = make_stock_entry(self) if self.consume_stock and self.items else None

		self.db_set(
			{
				**self.get_consumption_summary(),
				"status": "Completed",
				"actual_end_datetime": now_datetime(),
			}
		)

		if self.service_request:
			update_service_request_status(self.service_request, "completed-Request Status")

		self.create_post_op_tasks()
		return stock_entry

	def get_consumption_summary(self):
		"""Price of the consumables billed apart from the procedure, with one line per item"""
		if not self.items:
			return {}

		customer = self.get_customer()
		if not self.price_list:
			frappe.throw(_("Price List is mandatory"), title=_("Price List Not Set"))
		currency = frappe.db.get_value("Price List", self.price_list, "currency")

		lines, total = [], 0
		for item in self.items:
			if item.invoice_separately_as_consumables:
				details = self.get_consumable_price(item, customer, currency)
				price = details.price_list_rate * item.qty
				total += price
				lines.append(f"\n\t{details.item_name} {item.qty} {item.uom} {price}")

		if total <= 0:
			return {}
		heading = _("Clinical Procedure ({0}):").format(self.name)
		return {"consumable_total_amount": total, "consumption_details": heading + "".join(lines)}

	def get_customer(self):
		customer = frappe.db.get_value("Patient", self.patient, "customer")
		if not customer:
			frappe.throw(
				_("Please set Customer in Patient {0}").format(frappe.bold(self.patient)),
				title=_("Customer Not Found"),
			)
		return customer

	def get_consumable_price(self, item, customer, currency):
		ctx: ItemDetailsCtx = ItemDetailsCtx(
			{
				"doctype": "Sales Invoice",
				"item_code": item.item_code,
				"qty": item.qty,
				"uom": item.uom,
				"transaction_date": nowdate(),
				"company": self.company,
				"warehouse": self.warehouse,
				"customer": customer,
				"selling_price_list": self.price_list,
				"price_list_currency": currency,
				"plc_conversion_rate": 1.0,
				"conversion_rate": 1.0,
			}
		)
		return get_item_details(ctx)

	@frappe.whitelist()
	def start_procedure(self):
		self.check_permission("write")
		if self.status != "Pending":
			frappe.throw(_("Only a Pending procedure can be started"))

		if self.consume_stock and not self.has_required_qty():
			return "insufficient stock"

		validate_nursing_tasks(self)
		self.db_set({"status": "In Progress", "actual_start_datetime": now_datetime()})
		self.notify_update()
		return "success"

	def has_required_qty(self):
		if frappe.db.get_single_value("Stock Settings", "allow_negative_stock"):
			return True

		return all(get_stock_qty(item.item_code, self.warehouse) >= item.qty for item in self.items)

	@frappe.whitelist()
	def make_material_receipt(self, submit: bool | None = False) -> dict:
		stock_entry = frappe.new_doc("Stock Entry")
		stock_entry.stock_entry_type = "Material Receipt"
		stock_entry.to_warehouse = self.warehouse
		stock_entry.company = self.company
		expense_account = get_account(None, "expense_account", "Healthcare Settings", self.company)
		cost_center = frappe.get_cached_value("Company", self.company, "cost_center")

		for item in self.items:
			item.actual_qty = get_stock_qty(item.item_code, self.warehouse)
			if item.qty > item.actual_qty:
				row = append_stock_row(stock_entry, item, item.qty - item.actual_qty)
				row.t_warehouse = self.warehouse
				row.cost_center = cost_center
				row.expense_account = expense_account

		if submit:
			stock_entry.submit()
			return stock_entry
		return stock_entry.as_dict()

	def check_sessions_completed(self):
		total_sessions_requested = frappe.db.get_value("Service Request", self.service_request, "quantity")
		sessions = frappe.db.count(
			"Clinical Procedure", filters={"docstatus": ["!=", 2], "service_request": self.service_request}
		)
		return total_sessions_requested == sessions


def get_stock_qty(item_code, warehouse):
	return (
		get_previous_sle(
			{
				"item_code": item_code,
				"warehouse": warehouse,
				"posting_date": nowdate(),
				"posting_time": nowtime(),
			}
		).get("qty_after_transaction")
		or 0
	)


@frappe.whitelist()
def get_procedure_consumables(procedure_template: str) -> list:
	frappe.has_permission("Clinical Procedure Template", "read", procedure_template, throw=True)
	return get_items("Clinical Procedure Item", procedure_template, "Clinical Procedure Template")


def set_stock_items(doc, stock_detail_parent, parenttype):
	for item in get_items("Clinical Procedure Item", stock_detail_parent, parenttype):
		row = append_stock_row(doc, item, item.qty)
		if item.batch_no:
			row.batch_no = item.batch_no
		if parenttype == "Clinical Procedure Template":
			row.invoice_separately_as_consumables = item.invoice_separately_as_consumables

	return doc


def append_stock_row(doc, item, qty):
	"""Copy an item row to a stock entry or procedure, with transfer qty in stock UOM"""
	row = doc.append("items")
	row.item_code = item.item_code
	row.item_name = item.item_name
	row.uom = item.uom
	row.stock_uom = item.stock_uom
	row.qty = flt(qty)
	row.transfer_qty = flt(item.transfer_qty)
	row.conversion_factor = flt(item.conversion_factor)
	return row


def get_items(table, parent, parenttype):
	return frappe.db.get_all(table, filters={"parent": parent, "parenttype": parenttype}, fields=["*"])


def make_stock_entry(doc):
	stock_entry = frappe.new_doc("Stock Entry")
	stock_entry = set_stock_items(stock_entry, doc.name, "Clinical Procedure")
	stock_entry.stock_entry_type = "Material Issue"
	stock_entry.from_warehouse = doc.warehouse
	stock_entry.company = doc.company
	expense_account = get_account(None, "expense_account", "Healthcare Settings", doc.company)
	cost_center = frappe.get_cached_value("Company", doc.company, "cost_center")

	for item_line in stock_entry.items:
		item_line.cost_center = cost_center
		item_line.expense_account = expense_account

	stock_entry.save(ignore_permissions=True)
	stock_entry.submit()
	return stock_entry.name


@frappe.whitelist()
def make_procedure(source_name: str, target_doc: Document | None = None) -> Document:
	def set_missing_values(source, target):
		consume_stock = frappe.db.get_value(
			"Clinical Procedure Template", source.procedure_template, "consume_stock"
		)
		if consume_stock:
			target.consume_stock = 1
			warehouse = None
			if source.service_unit:
				warehouse = frappe.db.get_value("Healthcare Service Unit", source.service_unit, "warehouse")
			if not warehouse and source.company:
				warehouse = frappe.db.get_value("Company", source.company, "default_warehouse")
			if warehouse:
				target.warehouse = warehouse

			set_stock_items(target, source.procedure_template, "Clinical Procedure Template")

	doc = get_mapped_doc(
		"Patient Appointment",
		source_name,
		{
			"Patient Appointment": {
				"doctype": "Clinical Procedure",
				"field_map": [
					["appointment", "name"],
					["patient", "patient"],
					["patient_age", "patient_age"],
					["patient_sex", "patient_sex"],
					["procedure_template", "procedure_template"],
					["prescription", "procedure_prescription"],
					["practitioner", "practitioner"],
					["medical_department", "department"],
					["start_date", "appointment_date"],
					["start_time", "appointment_time"],
					["notes", "notes"],
					["service_unit", "service_unit"],
					["company", "company"],
					["invoiced", "invoiced"],
				],
			}
		},
		target_doc,
		set_missing_values,
	)

	return doc


@frappe.whitelist()
def get_procedure_prescribed(patient: str) -> list[tuple]:
	frappe.has_permission("Patient", "read", patient, throw=True)
	hso = frappe.qb.DocType("Service Request")
	return (
		frappe.qb.from_(hso)
		.select(
			hso.template_dn,
			hso.order_group,
			hso.billing_status,
			hso.practitioner,
			hso.order_date,
			hso.name,
			hso.insurance_policy,
			hso.insurance_payor,
		)
		.where(hso.patient == patient)
		.where(hso.status != "completed-Request Status")
		.where(hso.template_dt == "Clinical Procedure Template")
		.orderby(hso.creation, order=frappe.qb.desc)
	).run()
