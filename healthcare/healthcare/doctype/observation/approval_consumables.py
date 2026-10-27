# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Lets staff review an Observation's consumables before approving it issues them.

Approval happens away from the Observation form, in the observation widget and the
Diagnostic Report, so the rows are read and written here instead of on a form."""

import frappe
from frappe import _

from healthcare.healthcare.doctype.observation.observation_consumables import apply_edits


@frappe.whitelist()
def get_approval_consumables(
	observation: str | None = None, diagnostic_report: str | None = None
) -> list[dict]:
	"""The rows approving one Observation, or all of a report, would issue."""
	if observation:
		frappe.has_permission("Observation", "read", observation, throw=True)
		roots = [observation]
	else:
		frappe.has_permission("Diagnostic Report", "read", diagnostic_report, throw=True)
		roots = report_roots(diagnostic_report)
	return approval_rows([root for root in roots if root])


@frappe.whitelist()
def update_approval_consumables(rows: list | str) -> None:
	"""Saved through each Observation, so a form open on it sees it changed."""
	edits = {row.get("row_name"): row for row in frappe.parse_json(rows)}
	parents = frappe.get_all(
		"Observation Consumable",
		filters={"name": ["in", list(edits)], "parenttype": "Observation"},
		pluck="parent",
		distinct=True,
	)
	for parent in parents:
		save_edits(frappe.get_doc("Observation", parent), edits)


def save_edits(observation, edits):
	observation.check_permission("write")
	if observation.docstatus != 0:
		frappe.throw(_("Observation {0} is already approved").format(frappe.bold(observation.name)))
	apply_edits(observation, edits)
	observation.save()


def report_roots(diagnostic_report):
	"""The report's Observations that Approve All will approve."""
	from healthcare.healthcare.doctype.observation.observation import (
		get_approvable_observations,
		get_root_observations,
	)

	roots = []
	for observation in get_root_observations(diagnostic_report):
		roots.extend(get_approvable_observations(observation.get("name")))
	return roots


def approval_rows(roots):
	"""Consumables of draft Observations, and their components, not yet issued."""
	observations = pending_observations(roots)
	if not observations:
		return []
	rows = frappe.get_all(
		"Observation Consumable",
		filters={"parent": ["in", list(observations)], "parenttype": "Observation"},
		fields=["name as row_name", "parent", "item_code", "consumed_at", "qty", "uom", "batch_no"],
		order_by="parent, idx",
	)
	for row in rows:
		row.update(observations[row.parent])
	return rows


def pending_observations(roots):
	"""Observation name to its label and warehouse, for those that will issue.
	get_list leaves out the ones, components too, this user may not read."""
	observations = frappe.get_list(
		"Observation",
		filters={
			"name": ["in", with_components(roots)],
			"docstatus": 0,
			"consume_stock": 1,
			"stock_entry": ["is", "not set"],
		},
		fields=["name", "preferred_display_name", "observation_template", "warehouse"],
		limit=0,  # every component, as approval issues them all
	)
	return {
		observation.name: {
			"observation": observation.preferred_display_name or observation.observation_template,
			"warehouse": observation.warehouse,
		}
		for observation in observations
	}


def with_components(roots):
	"""Approving a panel approves its components too, at any depth."""
	found, level = list(roots), list(roots)
	while level:
		level = frappe.get_all(
			"Observation", filters={"parent_observation": ["in", level], "docstatus": 0}, pluck="name"
		)
		found.extend(level)
	return found or [""]
