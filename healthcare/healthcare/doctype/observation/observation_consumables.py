# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Consumables that Observation Templates list, recorded on the document that
uses them and issued from stock when that document is submitted."""

import frappe
from frappe import _
from frappe.utils import flt


def apply_edits(doc, edits):
	"""Reviewed quantities and batches, keyed by row name, onto the document's rows.
	`shown_qty` is what the review showed: a row changed since must be reviewed again."""
	for row in doc.consumables:
		if edit := edits.get(row.name):
			if "shown_qty" in edit and flt(edit.get("shown_qty")) != flt(row.qty):
				frappe.throw(
					_("{0} changed while it was being reviewed. Review it again.").format(
						frappe.bold(row.item_code)
					)
				)
			row.qty = flt(edit.get("qty"))
			row.batch_no = edit.get("batch_no") or None


def template_consumables(templates, stages):
	"""The consumable rows of templates that consume stock, for the given stages."""
	consuming = frappe.get_all(
		"Observation Template", filters={"name": ["in", templates or [""]], "consume_stock": 1}, pluck="name"
	)
	if not consuming:
		return []
	return frappe.get_all(
		"Observation Template Consumable",
		filters={
			"parent": ["in", consuming],
			"parenttype": "Observation Template",
			"consumed_at": ["in", stages],
		},
		fields=["parent as observation_template", "item_code", "consumed_at", "qty"],
		order_by="parent, idx",
	)


def item_row(row):
	item_name, stock_uom = frappe.db.get_value("Item", row.item_code, ["item_name", "stock_uom"])
	return {
		"item_code": row.item_code,
		"item_name": item_name,
		"stock_uom": stock_uom,
		"qty": row.qty,
		"consumed_at": row.consumed_at,
		"observation_template": row.observation_template,
	}


def set_warehouse(doc, unit_field):
	"""Fills the warehouse from the service unit in `unit_field`, else the company default.

	A warehouse still equal to what the previous unit gave was chosen for staff, not
	by them, so it follows the unit when the unit changes. One they picked is kept.
	"""
	if doc.warehouse and not follows_unit(doc, unit_field):
		return
	doc.warehouse = unit_warehouse(doc.company, doc.get(unit_field))


def follows_unit(doc, unit_field):
	before = doc.get_doc_before_save()
	if not before or before.get(unit_field) == doc.get(unit_field):
		return False
	return doc.warehouse == unit_warehouse(before.company, before.get(unit_field))


def unit_warehouse(company, service_unit):
	return (service_unit and frappe.db.get_value("Healthcare Service Unit", service_unit, "warehouse")) or (
		frappe.db.get_value("Company", company, "default_warehouse")
	)
