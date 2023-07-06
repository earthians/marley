# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from healthcare.healthcare.doctype.clinical_procedure_template.clinical_procedure_template import (
	make_item_price,
	update_item_and_item_price,
)

class ObservationTemplate(Document):
	def after_insert(self):
		if not self.item and not self.link_existing_item:
			create_item_from_template(self)

	def on_update(self):
		# If change_in_item update Item and Price List
		if self.change_in_item:
			update_item_and_item_price(self)

	def validate(self):
		if self.has_component and self.sample_collection_required:
			self.sample_collection_required = 0


def create_item_from_template(doc):
	uom = frappe.db.exists("UOM", "Unit") or frappe.db.get_single_value("Stock Settings", "stock_uom")
	# Insert item
	item = frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": doc.item_code,
			"item_name": doc.name,
			"item_group": doc.item_group,
			"description": doc.name,
			"is_sales_item": 1,
			"is_service_item": 1,
			"is_purchase_item": 0,
			"is_stock_item": 0,
			"include_item_in_manufacturing": 0,
			"show_in_website": 0,
			"is_pro_applicable": 0,
			"disabled": 0,
			"stock_uom": uom,
		}
	).insert(ignore_permissions=True, ignore_mandatory=True)

	# Insert item price
	if doc.is_billable and doc.rate != 0.0:
		price_list_name = frappe.db.get_value(
			"Selling Settings", None, "selling_price_list"
		) or frappe.db.get_value("Price List", {"selling": 1})
		if doc.rate:
			make_item_price(item.name, doc.rate)
		else:
			make_item_price(item.name, 0.0)
	# Set item in the template
	frappe.db.set_value("Observation Template", doc.name, "item", item.name)

	doc.reload()