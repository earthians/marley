# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Consumables that Observation Templates list, recorded on the document that
uses them and issued from stock when that document is submitted."""

import frappe
from frappe import _
from frappe.utils import flt

from erpnext.stock.doctype.item.item import get_uom_conv_factor

from healthcare.healthcare.ward_stock import StockIssue


def issue_consumables(doc):
	"""Issues a submitted document's consumables in one Material Issue.

	A corrected result carries the original's issue; the test was not run again.
	Every quantity set to 0 in the review leaves nothing to issue.
	"""
	items = [stock_item(row) for row in doc.consumables if flt(row.qty) > 0]
	if doc.stock_entry or not doc.consume_stock or not items:
		return
	if not doc.warehouse:
		frappe.throw(_("Set a Warehouse to issue the consumables from"))
	doc.db_set("stock_entry", StockIssue(doc.company, doc.warehouse, doc.patient).issue(items))


def stock_item(row):
	"""A row as a Material Issue item: its quantity in its own UOM, converted on issue."""
	check_stock_precision(row.item_code, row.qty, row.uom, row.conversion_factor)
	return {
		"item_code": row.item_code,
		"quantity": row.qty,
		"uom": row.uom,
		"conversion_factor": row.conversion_factor,
		"batch_no": row.batch_no,
	}


def set_consumable_uom(row):
	"""A template row's UOM, the item's stock UOM unless chosen, with its conversion."""
	row.uom = row.uom or frappe.db.get_value("Item", row.item_code, "stock_uom")
	row.conversion_factor = conversion_factor(row.item_code, row.uom)
	if not row.conversion_factor:
		frappe.throw(
			_("Row #{0}: {1} has no conversion from {2} to its stock UOM").format(
				row.idx, frappe.bold(row.item_code), frappe.bold(row.uom)
			)
		)
	check_stock_precision(row.item_code, row.qty, row.uom, row.conversion_factor)


def check_stock_precision(item_code, qty, uom, conversion_factor):
	"""Stock quantities are rounded to the site's precision, so 2.5 ml of a reagent stocked
	by the 100 ml bottle (0.025) would issue 0.03 bottles, 3 ml. Refuse instead."""
	stock_qty = flt(qty) * (flt(conversion_factor) or 1)
	precision = frappe.get_precision("Stock Entry Detail", "transfer_qty")
	if abs(flt(stock_qty, precision) - stock_qty) > 1e-9:
		frappe.throw(
			_(
				"{0} {1} of {2} is {3} in its stock UOM, finer than stock quantities are kept. "
				"Stock the item in a smaller unit, or raise the Float Precision."
			).format(qty, uom, frappe.bold(item_code), stock_qty)
		)


def conversion_factor(item_code, uom):
	"""Stock units per `uom`: the Item's own conversion, else a general one, else none.
	ERPNext's get_conversion_factor answers 1 when it finds nothing, which would issue
	2.5 bottles for 2.5 ml, so it is not used here."""
	stock_uom = frappe.db.get_value("Item", item_code, "stock_uom")
	if uom == stock_uom:
		return 1
	own = frappe.db.get_value(
		"UOM Conversion Detail",
		{"parent": item_code, "parenttype": "Item", "uom": uom},
		"conversion_factor",
	)
	return flt(own) or flt(get_uom_conv_factor(uom, stock_uom))


def set_stock_qty(doc):
	"""The quantity each row takes from stock, in a UOM no save can change: a saved row
	keeps its own, a new one takes its template row's, else the item's stock UOM.
	A correction's rows, copied from the original by the server, keep the original's:
	they describe an issue already made, whatever the template says now."""
	saved = saved_units(doc)
	for row in doc.get("consumables") or []:
		if row.name in saved:
			row.uom, row.conversion_factor = saved[row.name]
		elif not (doc.flags.correction and row.uom):
			row.uom, row.conversion_factor = template_units(row)
		row.conversion_factor = flt(row.conversion_factor) or 1
		row.stock_qty = flt(row.qty) * row.conversion_factor


def saved_units(doc):
	if not doc.get("name"):
		return {}
	rows = frappe.get_all(
		"Observation Consumable",
		filters={"parent": doc.name, "parenttype": doc.doctype},
		fields=["name", "uom", "conversion_factor"],
	)
	return {row.name: (row.uom, flt(row.conversion_factor) or 1) for row in rows if row.uom}


def template_units(row):
	unit = row.observation_template and frappe.db.get_value(
		"Observation Template Consumable",
		{
			"parent": row.observation_template,
			"parenttype": "Observation Template",
			"item_code": row.item_code,
			"consumed_at": row.consumed_at,
		},
		["uom", "conversion_factor"],
	)
	if unit and unit[0]:
		return unit[0], flt(unit[1]) or 1
	return frappe.db.get_value("Item", row.item_code, "stock_uom"), 1


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
		fields=[
			"parent as observation_template",
			"item_code",
			"consumed_at",
			"qty",
			"uom",
			"conversion_factor",
		],
		order_by="parent, idx",
	)


def item_row(row):
	item_name, stock_uom = frappe.db.get_value("Item", row.item_code, ["item_name", "stock_uom"])
	conversion_factor = flt(row.conversion_factor) or 1
	return {
		"item_code": row.item_code,
		"item_name": item_name,
		"stock_uom": stock_uom,
		"uom": row.uom or stock_uom,
		"conversion_factor": conversion_factor,
		"qty": row.qty,
		"stock_qty": flt(row.qty) * conversion_factor,
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


def prefill_consumables(doc):
	"""The template's Observation-stage items, unless already given.
	A correction keeps the original's table, even an empty one."""
	if doc.consumables or doc.flags.correction or not doc.observation_template:
		return
	for row in template_consumables([doc.observation_template], ("Observation",)):
		doc.append("consumables", item_row(row))


def validate_stock(doc):
	"""Where an Observation is performed, and what it uses there."""
	set_stock_qty(doc)
	set_service_unit(doc)
	validate_service_unit(doc)
	validate_issued(doc)


def validate_issued(doc):
	"""A corrected result shares the original's issue, so what it records must match it.

	Only the system sets the issue link: a correction gets it when it is created and an
	approval when it issues. A save that changed it could skip an issue or repeat one.
	"""
	before = doc.get_doc_before_save()
	if not before:
		return
	if (doc.stock_entry or None) != (before.stock_entry or None):
		frappe.throw(_("The Stock Entry that issued the consumables cannot be changed"))
	if before.stock_entry and issued(before) != issued(doc):
		frappe.throw(
			_("The consumables were issued in {0} and can no longer be changed").format(
				frappe.bold(before.stock_entry)
			)
		)


def replace_consumables(doc, original, repeat_test):
	"""Set up `doc`, the copy that replaces a rejected `original`.

	A correction reuses the original's issue. A repeated test is issued again,
	so it starts from the template's items. copy_doc ignores no_copy, so the
	copy's stock fields are set either way.
	"""
	if repeat_test:
		doc.stock_entry = None
		doc.set("consumables", [])
		prefill_consumables(doc)
	else:
		doc.flags.correction = True
		doc.stock_entry = original.stock_entry
		doc.set("consumables", [row.as_dict(no_default_fields=True) for row in original.consumables])


def set_service_unit(doc):
	if not doc.service_unit:
		doc.service_unit = parent_service_unit(doc) or only_unit_of_type(doc)
	if doc.consume_stock and not doc.stock_entry:
		set_warehouse(doc, "service_unit")


def validate_service_unit(doc):
	unit_type = observation_unit_type(doc)
	if not (doc.service_unit and unit_type):
		return
	if frappe.db.get_value("Healthcare Service Unit", doc.service_unit, "service_unit_type") != unit_type:
		frappe.throw(
			_("Service Unit {0} cannot perform this observation, it needs a {1}").format(
				frappe.bold(doc.service_unit), frappe.bold(unit_type)
			)
		)


def parent_service_unit(doc):
	"""A panel usually runs on one analyser, so components follow their parent,
	unless the component needs another kind of unit."""
	if not doc.parent_observation:
		return None
	unit = frappe.db.get_value("Observation", doc.parent_observation, "service_unit")
	unit_type = observation_unit_type(doc)
	if unit and unit_type:
		if frappe.db.get_value("Healthcare Service Unit", unit, "service_unit_type") != unit_type:
			return None
	return unit


def only_unit_of_type(doc):
	unit_type = observation_unit_type(doc)
	if not unit_type:
		return None
	units = frappe.get_all(
		"Healthcare Service Unit",
		filters={"service_unit_type": unit_type, "company": doc.company, "is_group": 0},
		pluck="name",
		limit=2,
	)
	return units[0] if len(units) == 1 else None


def observation_unit_type(doc):
	return service_unit_type(doc.observation_template, doc.service_request)


def issued(doc):
	rows = sorted((row.item_code, flt(row.qty), row.uom or "", row.batch_no or "") for row in doc.consumables)
	return doc.consume_stock, doc.warehouse, rows


@frappe.whitelist()
def get_service_unit_type(observation_template: str | None = None, service_request: str | None = None):
	"""The form filters its unit chooser with this, so it matches what saving accepts."""
	frappe.has_permission("Observation", "read", throw=True)
	return service_unit_type(observation_template, readable_service_request(service_request))


def readable_service_request(service_request):
	"""A lab approver may not read Service Requests, but may read the Observations
	they ordered, and an Observation shows which request it fulfils."""
	if not service_request or frappe.has_permission("Service Request", "read", service_request):
		return service_request
	if frappe.get_list("Observation", filters={"service_request": service_request}, limit=1):
		return service_request


def service_unit_type(observation_template, service_request):
	"""The kind of unit that can perform this, such as a modality type.
	A Service Request may ask for a different type than its template."""
	if service_request:
		unit_type = frappe.db.get_value("Service Request", service_request, "healthcare_service_unit_type")
		if unit_type:
			return unit_type
	if observation_template:
		return frappe.db.get_value("Observation Template", observation_template, "service_unit")
