# -*- coding: utf-8 -*-
# Copyright (c) 2017, earthians and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import json

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.rename_doc import rename_doc
from frappe.utils import today


class ClinicalProcedureTemplate(Document):
	def before_insert(self):
		if self.link_existing_item and self.item:
			price_list = frappe.db.get_all('Item Price', {"item_code": self.item}, ["price_list_rate"], order_by="valid_from desc")
			if price_list:
				self.rate = price_list[0].get('price_list_rate')

	def validate(self):
		self.enable_disable_item()

	def after_insert(self):
		if not self.link_existing_item:
			create_item_from_template(self)

	def on_update(self):
		if self.change_in_item:
			update_item_and_item_price(self)

	def enable_disable_item(self):
		if self.is_billable:
			if self.disabled:
				frappe.db.set_value('Item', self.item, 'disabled', 1)
			else:
				frappe.db.set_value('Item', self.item, 'disabled', 0)


@frappe.whitelist()
def get_item_details(args=None):
	if not isinstance(args, dict):
		args = json.loads(args)

	item = frappe.db.get_all('Item',
		filters={
			'disabled': 0,
			'name': args.get('item_code')
		},
		fields=['stock_uom', 'item_name']
	)

	if not item:
		frappe.throw(_('Item {0} is not active').format(args.get('item_code')))

	item = item[0]
	ret = {
		'uom': item.stock_uom,
		'stock_uom': item.stock_uom,
		'item_name': item.item_name,
		'qty': 1,
		'transfer_qty': 0,
		'conversion_factor': 1
	}
	return ret

def create_item_from_template(doc):
	disabled = doc.disabled
	if doc.is_billable and not doc.disabled:
		disabled = 0

	uom = frappe.db.exists('UOM', 'Unit') or frappe.db.get_single_value('Stock Settings', 'stock_uom')
	item = frappe.get_doc({
		'doctype': 'Item',
		'item_code': doc.template,
		'item_name':doc.template,
		'item_group': doc.item_group,
		'description':doc.description,
		'is_sales_item': 1,
		'is_service_item': 1,
		'is_purchase_item': 0,
		'is_stock_item': 0,
		'show_in_website': 0,
		'is_pro_applicable': 0,
		'disabled': disabled,
		'stock_uom': uom
	}).insert(ignore_permissions=True, ignore_mandatory=True)

	make_item_price(item.name, doc.rate)
	doc.db_set('item', item.name)

def make_item_price(item, item_price):
	price_list_name = frappe.db.get_value('Selling Settings', None, 'selling_price_list') or frappe.db.get_value('Price List', {'selling': 1})
	frappe.get_doc({
		'doctype': 'Item Price',
		'price_list': price_list_name,
		'item_code': item,
		'price_list_rate': item_price,
		'valid_from': today(),
	}).insert(ignore_permissions=True, ignore_mandatory=True)

@frappe.whitelist()
def change_item_code_from_template(item_code, doc):
	doc = frappe._dict(json.loads(doc))

	if frappe.db.exists('Item', {'item_code': item_code}):
		frappe.throw(_('Item with Item Code {0} already exists').format(item_code))
	else:
		rename_doc('Item', doc.item_code, item_code, ignore_permissions=True)
		frappe.db.set_value('Clinical Procedure Template', doc.name, 'item_code', item_code)
	return


def update_item_and_item_price(doc):
	if doc.is_billable and doc.item:
		item_name = doc.lab_test_name if doc.get('doctype') == 'Lab Test Template' else doc.template
		rate = doc.lab_test_rate if doc.get('doctype') == 'Lab Test Template' else doc.rate
		item_group = doc.lab_test_group if doc.get('doctype') == 'Lab Test Template' else doc.item_group

		item_doc = frappe.get_doc('Item', {'item_code': doc.item})
		item_doc.item_name = item_name
		item_doc.item_group = item_group
		item_doc.description = doc.description if doc.get('doctype') == 'Clinical Procedure Template' else ''
		item_doc.disabled = 0
		item_doc.save(ignore_permissions=True)
		if rate:
			if not frappe.db.exists('Item Price', {
				'item_code': doc.item,
				'valid_from': today()
			}):
				make_item_price(doc.item, rate)
			else:
				item_price = frappe.get_doc('Item Price', {'item_code': doc.item})
				item_price.item_name = item_name
				item_price.valid_from = today()
				item_price.price_list_rate = rate
				item_price.save()

	elif not doc.is_billable and doc.item and not doc.link_existing_item:
		frappe.db.set_value('Item', doc.item, 'disabled', 1)

	doc.db_set('change_in_item', 0)
