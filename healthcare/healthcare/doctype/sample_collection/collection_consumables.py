# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt

from healthcare.healthcare.doctype.observation.observation_consumables import (
	apply_edits,
	item_row,
	template_consumables,
)
from healthcare.healthcare.ward_stock import StockIssue

STAGES = ("Specimen", "Sample Collection")
# What makes a separate container; create_specimen() groups by the same fields.
CONTAINER_FIELDS = ("medical_department", "sample", "container_closure_color")


def record_consumables(sample_collection, collected, collect_action=None):
	"""Records what a collect action uses on its Sample Collection.

	`collected` is a list of dicts of observation_template, the container fields and specimen.
	One draw and one tube serve many tests, so within one collect action an item
	is recorded at the largest quantity any template asks for, not the sum: once
	per container for the Specimen stage, once for the draw. A later action may
	have used a new tube or a new draw, or added a test to one already counted;
	only staff know, so its row starts at the same-container quantity and keeps
	the full one as `suggested_qty` for the review to offer.
	"""
	context = frappe._dict(
		sample_collection=sample_collection,
		collect_action=collect_action,
		rows=recorded_rows(sample_collection),
	)
	by_template = {entry.get("observation_template"): entry for entry in collected}
	for row in template_consumables(list(by_template), STAGES):
		entry = by_template[row.observation_template]
		add_consumable(context, row, container_of(row, entry), entry.get("specimen"))


def recorded_rows(sample_collection):
	return frappe.get_all(
		"Observation Consumable",
		filters={"parent": sample_collection, "parenttype": "Sample Collection"},
		fields=[
			"name",
			"item_code",
			"consumed_at",
			"qty",
			"suggested_qty",
			"stock_entry",
			"collect_action",
			*CONTAINER_FIELDS,
		],
	)


def container_of(row, entry):
	"""The container a Specimen-stage item belongs to. Draw items share none."""
	if row.consumed_at != "Specimen":
		return dict.fromkeys(CONTAINER_FIELDS)
	return {field: entry.get(field) or None for field in CONTAINER_FIELDS}


def add_consumable(context, row, container, specimen):
	matches = matching_rows(context.rows, row.item_code, row.consumed_at, container)
	extra = max(flt(row.qty) - sum(flt(match.qty) for match in matches), 0)
	counted_earlier = any(match.collect_action != context.collect_action for match in matches)
	suggested = flt(row.qty) if counted_earlier else 0
	# Recorded by this action and not yet issued, so still open to change.
	current = next(
		(m for m in matches if m.collect_action == context.collect_action and not m.stock_entry), None
	)
	if current:
		update_consumable(current, flt(current.qty) + extra, max(flt(current.suggested_qty), suggested))
	elif extra or suggested:
		insert_consumable(context, row, container, specimen, extra, suggested)


def update_consumable(row, qty, suggested_qty):
	row.qty, row.suggested_qty = qty, suggested_qty
	frappe.db.set_value("Observation Consumable", row.name, {"qty": qty, "suggested_qty": suggested_qty})


def matching_rows(rows, item_code, consumed_at, container):
	return [
		row
		for row in rows
		if row.item_code == item_code
		and row.consumed_at == consumed_at
		and all((row.get(field) or None) == value for field, value in container.items())
	]


def insert_consumable(context, row, container, specimen, qty, suggested_qty):
	consumable = frappe.get_doc(
		{
			"doctype": "Observation Consumable",
			"parent": context.sample_collection,
			"parenttype": "Sample Collection",
			"parentfield": "consumables",
			"idx": len(context.rows) + 1,
			"specimen": specimen,
			**container,
			**item_row(row),
			"qty": qty,
			"suggested_qty": suggested_qty,
			"collect_action": context.collect_action,
		}
	)
	consumable.db_insert()
	context.rows.append(frappe._dict(consumable.as_dict()))


def issue_collection(doc, reviewed=None):
	"""Issues the rows collecting has added since the last issue.

	Samples arrive at different times, so each collect issues its own supplies and
	no result waits for the rest. Only the `reviewed` row names, when given: rows
	another collect added while the review was open wait for a review of their own.
	"""
	pending = [row for row in unissued_rows(doc) if reviewed is None or row.name in reviewed]
	if not (doc.consume_stock and pending):
		return
	if not doc.warehouse:
		frappe.throw(_("Set a Warehouse to issue the consumables from"))

	items = [{"item_code": row.item_code, "quantity": row.qty, "batch_no": row.batch_no} for row in pending]
	stock_entry = StockIssue(doc.company, doc.warehouse, doc.patient).issue(items)
	for row in pending:
		row.db_set({"issued_qty": row.qty, "stock_entry": stock_entry})


def unissued_rows(doc):
	return [row for row in doc.consumables if not row.stock_entry and flt(row.qty) > 0]


def validate_issued_rows(doc):
	"""Issued rows are fixed: they stay, and keep their item, quantity and batch.
	Their issue fields come from the database, never from what was sent."""
	issued = issued_rows(doc.name)
	for row in doc.get("consumables") or []:
		before = issued.pop(row.name, None)
		if before and changed_since_issue(row, before):
			refuse_issued(before, _("{0} was issued in {1} and can no longer be changed"))
		row.issued_qty = before.issued_qty if before else 0
		row.stock_entry = before.stock_entry if before else None
	for before in issued.values():
		refuse_issued(before, _("{0} was issued in {1} and cannot be removed"))


def issued_rows(sample_collection):
	rows = frappe.get_all(
		"Observation Consumable",
		filters={
			"parent": sample_collection,
			"parenttype": "Sample Collection",
			"stock_entry": ["is", "set"],
		},
		fields=["name", "item_code", "batch_no", "issued_qty", "stock_entry"],
	)
	return {row.name: row for row in rows}


def changed_since_issue(row, before):
	return (
		flt(row.qty) != flt(before.issued_qty)
		or row.item_code != before.item_code
		or (row.batch_no or "") != (before.batch_no or "")
	)


def refuse_issued(before, message):
	frappe.throw(message.format(frappe.bold(before.item_code), frappe.bold(before.stock_entry)))


@frappe.whitelist()
def issue_collection_consumables(
	sample_collection: str, rows: list | str, warehouse: str | None = None
) -> None:
	"""Saves the reviewed rows through the collection, then issues them."""
	# Locked until this request commits: a second confirm waits, then finds the rows issued.
	doc = frappe.get_doc("Sample Collection", sample_collection, for_update=True)
	doc.check_permission("write")
	if doc.docstatus != 0:
		frappe.throw(_("Sample Collection {0} is already submitted").format(frappe.bold(doc.name)))
	edits = {row.get("row_name"): row for row in frappe.parse_json(rows)}
	apply_edits(doc, edits)
	remove_declined(doc, edits)
	doc.warehouse = warehouse or doc.warehouse
	doc.save()
	issue_collection(doc, reviewed=set(edits))


def remove_declined(doc, edits):
	"""Rows staff confirmed at nothing, such as a container counted earlier that was
	not new, would otherwise come back in every review."""
	declined = [
		row for row in doc.consumables if row.name in edits and not row.stock_entry and flt(row.qty) <= 0
	]
	for row in declined:
		doc.remove(row)
