# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
from frappe import _
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
		if self.change_in_item and self.is_billable:
			update_item_and_item_price(self)
		if not self.item and self.is_billable:
			create_item_from_template(self)

	def validate(self):
		if self.has_component and self.sample_collection_required:
			self.sample_collection_required = 0

		if self.permitted_data_type == "Boolean":
			if len(self.options.split("\n")) > 2:
				frappe.throw(
					_("You cannot provide more than 2 options for Boolean result"), frappe.ValidationError
				)

		if self.has_component:
			self.abbr = ""
		else:
			self.validate_abbr()

	def validate_abbr(self):
		if not self.abbr:
			self.abbr = frappe.utils.get_abbr(self.observation)
		else:
			self.abbr = self.abbr.strip()

		if not self.abbr:
			frappe.throw(_("Abbreviation is mandatory"))

		ob_t = frappe.qb.DocType("Observation Template")
		duplicate = (
			frappe.qb.from_(ob_t)
			.select("name")
			.where(ob_t.abbr.eq(self.abbr) & ob_t.observation.ne(self.observation))
		).run(as_dict=True)

		if len(duplicate):
			frappe.throw(_("Abbreviation already used for {0}").format(duplicate[0].name))


def create_item_from_template(doc):
	if doc.is_billable:
		uom = frappe.db.exists("UOM", "Unit") or frappe.db.get_single_value(
			"Stock Settings", "stock_uom"
		)
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

		if doc.rate:
			make_item_price(item.name, doc.rate)
		else:
			make_item_price(item.name, 0.0)
		# Set item in the template
		frappe.db.set_value("Observation Template", doc.name, "item", item.name)

	doc.reload()


def get_observation_template_details(observation_template):
	obs_comp = frappe.qb.DocType("Observation Component")
	obs_temp = frappe.qb.DocType("Observation Template")
	from pypika import Case

	data = (
		frappe.qb.from_(obs_comp)
		.left_join(obs_temp)
		.on(obs_comp.observation_template == obs_temp.name)
		.select(
			Case()
			.when(obs_temp.sample_collection_required == 0, obs_temp.name)
			.else_(None)
			.as_("no_sample_reqd"),
			Case()
			.when(obs_temp.sample_collection_required == 1, obs_temp.name)
			.else_(None)
			.as_("sample_reqd"),
		)
		.where(obs_comp.parent == observation_template)
	).run(as_dict=True)
	sample_reqd_component_obs = []
	non_sample_reqd_component_obs = []

	for d in data:
		if d.get("no_sample_reqd"):
			non_sample_reqd_component_obs.append(d.get("no_sample_reqd"))
		elif d.get("sample_reqd"):
			sample_reqd_component_obs.append(d.get("sample_reqd"))

	return sample_reqd_component_obs, non_sample_reqd_component_obs
