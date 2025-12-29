# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.rename_doc import rename_doc


class HealthcareServiceUnitType(Document):
	def validate(self):
		if self.allow_appointments and self.inpatient_occupancy:
			frappe.msgprint(
				_("Healthcare Service Unit Type cannot have both {0} and {1}").format(
					frappe.bold("Allow Appointments"), frappe.bold("Inpatient Occupancy")
				),
				raise_exception=1,
				title=_("Validation Error"),
				indicator="red",
			)
		elif not self.allow_appointments and not self.inpatient_occupancy:
			frappe.msgprint(
				_("Healthcare Service Unit Type must allow atleast one among {0} and {1}").format(
					frappe.bold("Allow Appointments"), frappe.bold("Inpatient Occupancy")
				),
				raise_exception=1,
				title=_("Validation Error"),
				indicator="red",
			)

		if not self.allow_appointments:
			self.overlap_appointments = 0

		if self.is_billable:
			if self.disabled:
				frappe.db.set_value("Item", self.item, "disabled", 1)
			else:
				frappe.db.set_value("Item", self.item, "disabled", 0)

		if self.inpatient_occupancy and self.is_billable and not self.item:
			self.create_service_unit_item()

	def on_trash(self):
		if self.item:
			try:
				item = self.item
				self.db_set("item", "")
				frappe.delete_doc("Item", item)
			except Exception:
				frappe.throw(_("Not permitted. Please disable the Service Unit Type"))

	def on_update(self):
		doc_before_save = self.get_doc_before_save()
		if not doc_before_save:
			return
		if (
			doc_before_save.rate != self.rate
			or doc_before_save.is_billable != self.is_billable
			or doc_before_save.item_group != self.item_group
			or doc_before_save.description != self.description
			or doc_before_save.get("gst_hsn_code") != self.get("gst_hsn_code")
		):
			update_item(self)

			item_price = frappe.db.exists("Item Price", {"item_code": self.item_code})

			if not item_price:
				price_list_name = frappe.db.get_value("Price List", {"selling": 1})
				if self.rate:
					make_item_price(self.item_code, price_list_name, self.rate)
				else:
					make_item_price(self.item_code, price_list_name, 0.0)
			else:
				frappe.db.set_value("Item Price", item_price, "price_list_rate", self.rate)

		self.reload()

	@frappe.whitelist()
	def create_service_unit_item(self):
		create_item(self)


def create_item(doc):
	# insert item
	item = frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": doc.item_code,
			"item_name": doc.service_unit_type,
			"item_group": doc.item_group,
			"description": doc.description or doc.item_code,
			"is_sales_item": 1,
			"is_service_item": 1,
			"is_purchase_item": 0,
			"is_stock_item": 0,
			"show_in_website": 0,
			"is_pro_applicable": 0,
			"disabled": 0,
			"stock_uom": doc.uom,
		}
	).insert(ignore_permissions=True, ignore_mandatory=True)

	# insert item price
	# get item price list to insert item price
	price_list_name = frappe.db.get_value("Price List", {"selling": 1})
	if doc.rate:
		make_item_price(item.name, price_list_name, doc.rate)
		item.standard_rate = doc.rate
	else:
		make_item_price(item.name, price_list_name, 0.0)
		item.standard_rate = 0.0

	item.save(ignore_permissions=True)

	# Set item in the doc
	doc.db_set("item", item.name)


def make_item_price(item, price_list_name, item_price):
	frappe.get_doc(
		{
			"doctype": "Item Price",
			"price_list": price_list_name,
			"item_code": item,
			"price_list_rate": item_price,
		}
	).insert(ignore_permissions=True, ignore_mandatory=True)


def update_item(doc):
	item = frappe.get_doc("Item", doc.item)
	if item:
		disabled = doc.disabled or not doc.is_billable
		item.update(
			{
				"item_name": doc.service_unit_type,
				"item_group": doc.item_group,
				"disabled": disabled,
				"standard_rate": doc.rate,
				"description": doc.description,
			}
		)
		item.save(ignore_permissions=True)


@frappe.whitelist()
def change_item_code(item, item_code, doc_name):
	if frappe.db.exists({"doctype": "Item", "item_code": item_code}):
		frappe.throw(_("Item with Item Code {0} already exists").format(item_code))
	else:
		rename_doc("Item", item, item_code, ignore_permissions=True)
		frappe.db.set_value("Healthcare Service Unit Type", doc_name, "item_code", item_code)
