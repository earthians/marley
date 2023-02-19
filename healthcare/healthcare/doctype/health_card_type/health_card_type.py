# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.rename_doc import rename_doc

class HealthCardType(Document):
	def after_insert(self):
		create_item(self)
	
	def on_submit(self):
		# Create pricing rule for Healthcard Discount Item
		for discount_item in self.healthcard_discount_item:			
			pricing_rule = frappe.get_doc({
				'doctype': 'Pricing Rule',
				'title': self.health_card_type.replace(" ","") + "-" + discount_item.for_item_group.replace(" ",""),
				'apply_on': discount_item.discount_type,
				'selling': 1,
				'applicable_for': "Customer Group",
				'customer_group': self.customer_group,
				'rate_or_discount': discount_item.based_on
			})

			if discount_item.based_on == "Discount Percentage":
				pricing_rule.discount_percentage = discount_item.discount_percentage
			elif discount_item.based_on == "Discount Amount":
				pricing_rule.discount_amount = discount_item.discount_amount
			
			if discount_item.discount_type == "Item":
				pricing_rule.append("items", {
					'item': discount_item.for_item_group
				})
			elif discount_item.discount_type == "Item Group":
				pricing_rule.append("item_groups", {
					'item_group': discount_item.for_item_group
				})

			pricing_rule.save(ignore_permissions=True)
			frappe.db.set_value("Healthcard Discount Item", discount_item.name, "pricing_rule", pricing_rule.name)

	def on_trash(self):
		if self.item:
			try:
				item = self.item
				self.db_set('item', '')
				frappe.delete_doc('Item', item)
			except Exception:
				frappe.throw(_('Not permitted'))
		if self.healthcard_discount_item:
			for discount_item in self.healthcard_discount_item:
				if discount_item.pricing_rule:
					try:
						frappe.db.set_value("Healthcard Discount Item", discount_item.name, "pricing_rule", "")
						frappe.delete_doc('Pricing Rule', discount_item.pricing_rule)
					except Exception:
						frappe.throw(_('Not permitted'))
	
	def on_cancel(self):
		if self.item:
			frappe.db.set_value('Item', self.item, "disabled", 1)
		
		if self.healthcard_discount_item:
			for discount_item in self.healthcard_discount_item:
				frappe.db.set_value("Pricing Rule", discount_item.pricing_rule, "disable", 1)

def create_item(doc):
	if frappe.db.exists({'doctype': 'Item', 'item_code': doc.item_code}):
		item =  frappe.get_doc("Item", doc.item_code)
		# Set item in the doc
		doc.db_set('item', item.name)
		# insert item price
		# get item price list to insert item price
		price_list_name = frappe.db.get_value('Price List', {'selling': 1})
		if doc.rate:
			make_item_price(item.name, price_list_name, doc.rate)
			item.standard_rate = doc.rate
		else:
			make_item_price(item.name, price_list_name, 0.0)
			item.standard_rate = 0.0	
			
		item.save(ignore_permissions=True)	
		update_item(doc)		
	else:
		# insert item
		item =  frappe.get_doc({
			'doctype': 'Item',
			'item_code': doc.item_code,
			'item_name': doc.health_card_type,
			'item_group': doc.item_group,
			'description': doc.description or doc.item_code,
			'is_sales_item': 1,
			'is_service_item': 1,
			'is_purchase_item': 0,
			'is_stock_item': 0,
			'show_in_website': 0,
			'is_pro_applicable': 0,
			'disabled': 0,
			'stock_uom': 'Nos'
		}).insert(ignore_permissions=True, ignore_mandatory=True)

		# insert item price
		# get item price list to insert item price
		price_list_name = frappe.db.get_value('Price List', {'selling': 1})
		if doc.rate:
			make_item_price(item.name, price_list_name, doc.rate)
			item.standard_rate = doc.rate
		else:
			make_item_price(item.name, price_list_name, 0.0)
			item.standard_rate = 0.0

		item.save(ignore_permissions=True)

		# Set item in the doc
		doc.db_set('item', item.name)
	
def make_item_price(item, price_list_name, item_price):
	frappe.get_doc({
		'doctype': 'Item Price',
		'price_list': price_list_name,
		'item_code': item,
		'price_list_rate': item_price
	}).insert(ignore_permissions=True, ignore_mandatory=True)

def update_item(doc):
	item = frappe.get_doc("Item", doc.item)
	if item:
		item.update({
			"item_name": doc.health_card_type,
			"item_group": doc.item_group,
			"disabled": 0,
			"standard_rate": doc.rate,
			"description": doc.description
		})
		item.db_update()

@frappe.whitelist()
def change_item_code(item, item_code, doc_name):
	if frappe.db.exists({'doctype': 'Item', 'item_code': item_code}):
		frappe.db.set_value('Health Card Type', doc_name, 'item_code', item_code)
	else:
		rename_doc('Item', item, item_code, ignore_permissions=True)
		frappe.db.set_value('Health Card Type', doc_name, 'item_code', item_code)
