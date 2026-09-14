# Copyright (c) 2026, Healthcare and contributors
"""Multi lab-test lines on a single Service Request (singles + groups)."""

from __future__ import annotations

import json
import re
from typing import Any

import frappe
from frappe import _
from frappe.utils import cint, flt


def lab_template_sort_key(name: str | None) -> tuple:
	"""Natural sort for Lab Test Template ids (LAB-001, LAB-001-002, …)."""
	text = (name or "").strip().upper()
	if not text:
		return ("",)
	parts = re.split(r"(\d+)", text)
	out: list = []
	for part in parts:
		if not part:
			continue
		if part.isdigit():
			out.append(int(part))
		else:
			out.append(part)
	return tuple(out)


def sort_lab_template_codes(names: list | None) -> list[str]:
	"""Unique template codes sorted by lab test id, not display name."""
	unique: list[str] = []
	seen: set[str] = set()
	for raw in names or []:
		code = (str(raw) if raw is not None else "").strip()
		if not code or code in seen:
			continue
		seen.add(code)
		unique.append(code)
	return sorted(unique, key=lab_template_sort_key)


def resolve_group_child_templates(
	parent: str,
	explicit_children: list | None = None,
) -> list[str]:
	"""Child template codes for a group, ordered by lab test id."""
	children = sort_lab_template_codes([c for c in (explicit_children or []) if c])
	if children:
		return children
	parent = (parent or "").strip()
	if not parent:
		return []
	rows = frappe.get_all(
		"Lab Test Template",
		filters={"lab_group": parent, "disabled": 0},
		pluck="name",
		ignore_permissions=True,
	)
	return sort_lab_template_codes(rows)


def sort_lab_request_display_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
	"""Order request lines and group children by lab test template id."""
	rows: list[dict[str, Any]] = []
	for item in items or []:
		row = dict(item)
		kind = (row.get("kind") or "").strip().lower()
		if kind == "group":
			parent = (row.get("parent") or "").strip()
			row["children"] = resolve_group_child_templates(parent, row.get("children"))
			rows.append(row)
		elif kind == "single":
			rows.append(row)

	def _item_key(it: dict[str, Any]) -> tuple:
		kind = (it.get("kind") or "").strip().lower()
		if kind == "group":
			return lab_template_sort_key((it.get("parent") or "").strip())
		return lab_template_sort_key((it.get("template") or "").strip())

	return sorted(rows, key=_item_key)


def _get_patient_category_multiplier(patient: str) -> tuple[float, str | None]:
	from healthcare.healthcare.doctype.service_request.service_request import (
		_get_patient_category_multiplier as _sr_multiplier,
	)

	return _sr_multiplier(patient)


def _get_lab_template_base_rate(template_dn: str, patient_care_type: str | None = None) -> float:
	from healthcare.healthcare.doctype.service_request.service_request import (
		_get_lab_template_base_rate as _sr_rate,
	)

	return _sr_rate(template_dn, patient_care_type)


def parse_lab_request_items(doc) -> list[dict[str, Any]]:
	"""Normalize lab lines from ``lab_request_items`` JSON or legacy single/group fields."""
	raw = getattr(doc, "lab_request_items", None) or ""
	if raw and str(raw).strip():
		try:
			parsed = json.loads(raw)
			if isinstance(parsed, list) and parsed:
				return [item for item in parsed if isinstance(item, dict)]
		except Exception:
			pass

	if getattr(doc, "template_dt", None) != "Lab Test Template":
		return []

	template_dn = (getattr(doc, "template_dn", None) or "").strip()
	if not template_dn:
		return []

	is_group = frappe.db.get_value("Lab Test Template", template_dn, "is_group")
	if is_group:
		children: list[str] = []
		if getattr(doc, "selected_group_templates", None):
			try:
				children = json.loads(doc.selected_group_templates)
			except Exception:
				children = []
		if not isinstance(children, list):
			children = []
		children = [t for t in children if t]
		return [{"kind": "group", "parent": template_dn, "children": children}]

	return [{"kind": "single", "template": template_dn}]


def _lab_test_template_labels(names: list[str]) -> dict[str, str]:
	"""Map Lab Test Template name → lab_test_name (fallback to name)."""
	unique = [n for n in { (n or "").strip() for n in names } if n]
	if not unique:
		return {}
	rows = frappe.get_all(
		"Lab Test Template",
		filters={"name": ["in", unique]},
		fields=["name", "lab_test_name"],
		ignore_permissions=True,
	)
	out = {row.name: (row.lab_test_name or row.name) for row in rows}
	for name in unique:
		out.setdefault(name, name)
	return out


def enrich_lab_request_items_for_display(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
	"""Attach human-readable lab_test_name labels for UI (detail slider / edit).

	Adds ``template_label`` / ``parent_label`` and ``child_labels`` map without
	changing the stored template ids used for billing.
	"""
	if not items:
		return []

	ids: list[str] = []
	for item in items:
		kind = (item.get("kind") or "").strip().lower()
		if kind == "single":
			ids.append((item.get("template") or "").strip())
		elif kind == "group":
			ids.append((item.get("parent") or "").strip())
			for child in item.get("children") or []:
				ids.append(str(child).strip())

	labels = _lab_test_template_labels(ids)
	enriched: list[dict[str, Any]] = []
	for item in items:
		row = dict(item)
		kind = (row.get("kind") or "").strip().lower()
		if kind == "single":
			tpl = (row.get("template") or "").strip()
			row["template_label"] = labels.get(tpl) or tpl
		elif kind == "group":
			parent = (row.get("parent") or "").strip()
			row["parent_label"] = labels.get(parent) or parent
			children = [str(c).strip() for c in (row.get("children") or []) if c]
			row["child_labels"] = {c: labels.get(c) or c for c in children}
		enriched.append(row)
	return enriched


def normalize_lab_request_items_for_storage(items: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
	"""Strip display-only keys and keep a stable shape for persisted JSON.

	UI enrichment (``parent_label``, ``child_labels``, ``template_label``) must never
	be written back — that alone can fail update-after-submit checks.
	"""
	out: list[dict[str, Any]] = []
	for item in items or []:
		if not isinstance(item, dict):
			continue
		kind = (item.get("kind") or "").strip().lower()
		if kind == "single":
			tpl = (item.get("template") or "").strip()
			if not tpl:
				continue
			row: dict[str, Any] = {"kind": "single", "template": tpl}
			for key in ("discount_type", "discount_rate", "discount"):
				if key in item and item.get(key) not in (None, ""):
					row[key] = item.get(key)
			if cint(item.get("finished")):
				row["finished"] = 1
			out.append(row)
		elif kind == "group":
			parent = (item.get("parent") or "").strip()
			if not parent:
				continue
			children = sort_lab_template_codes(
				[str(c).strip() for c in (item.get("children") or []) if str(c).strip()]
			)
			row = {"kind": "group", "parent": parent, "children": children}
			# Group-charge (parent) line discount — separate from per-child discounts.
			for key in ("discount_type", "discount_rate", "discount"):
				if key in item and item.get(key) not in (None, ""):
					row[key] = item.get(key)
			raw_discounts = item.get("child_discounts")
			if isinstance(raw_discounts, dict) and raw_discounts:
				clean_discounts: dict[str, Any] = {}
				for child, disc in raw_discounts.items():
					child_key = str(child).strip()
					if not child_key or child_key not in children or not isinstance(disc, dict):
						continue
					clean_discounts[child_key] = {
						"discount_type": disc.get("discount_type") or "Amount",
						"discount_rate": flt(disc.get("discount_rate") or 0),
						"discount": flt(disc.get("discount") or 0),
					}
				if clean_discounts:
					row["child_discounts"] = clean_discounts
			if cint(item.get("finished")):
				row["finished"] = 1
			out.append(row)
	return out


def templates_in_lab_request_items(items: list[dict[str, Any]] | None) -> set[str]:
	"""Concrete lab templates that should exist for the basket (singles + group children)."""
	out: set[str] = set()
	for item in items or []:
		kind = (item.get("kind") or "").strip().lower()
		if kind == "single":
			tpl = (item.get("template") or "").strip()
			if tpl:
				out.add(tpl)
		elif kind == "group":
			parent = (item.get("parent") or "").strip()
			children = resolve_group_child_templates(parent, item.get("children"))
			for child in children:
				if child:
					out.add(child)
	return out


def remove_template_from_lab_request_items(
	items: list[dict[str, Any]] | None,
	template: str,
) -> list[dict[str, Any]]:
	"""Drop a child/single template from the basket. Removes empty groups.

	Parent group codes are never deleted by this helper — only the listed child/single.
	"""
	template = (template or "").strip()
	if not template:
		return list(items or [])

	next_items: list[dict[str, Any]] = []
	for item in items or []:
		row = dict(item)
		kind = (row.get("kind") or "").strip().lower()
		if kind == "single":
			if (row.get("template") or "").strip() == template:
				continue
			next_items.append(row)
			continue
		if kind == "group":
			children = [str(c).strip() for c in (row.get("children") or []) if str(c).strip()]
			if not children:
				# Explicit empty means "all children" at resolve time — materialize then prune.
				parent = (row.get("parent") or "").strip()
				children = resolve_group_child_templates(parent, None)
			children = [c for c in children if c != template]
			if not children:
				continue
			row["children"] = children
			discounts = row.get("child_discounts")
			if isinstance(discounts, dict) and template in discounts:
				discounts = dict(discounts)
				discounts.pop(template, None)
				row["child_discounts"] = discounts or None
			next_items.append(row)
			continue
		next_items.append(row)
	return next_items


def expand_lab_test_specs(
	items: list[dict[str, Any]],
	patient: str,
	patient_care_type: str | None = None,
) -> list[dict[str, Any]]:
	"""Expand basket lines into concrete lab tests to create.

	Uses TRICARE/insurance inclusive price + OP/IP discount when the patient is insured.
	Category multiplier is skipped for insurance when Apply Multiplier on Insurance is off.
	"""
	from healthcare.controllers.insurance_pricing import resolve_charge

	multiplier, _ = _get_patient_category_multiplier(patient)
	specs: list[dict[str, Any]] = []
	seen_templates: set[str] = set()

	def _priced_row(template: str) -> dict[str, Any]:
		base_rate = _get_lab_template_base_rate(template, patient_care_type)
		charged = resolve_charge(
			patient=patient,
			base_rate=base_rate,
			patient_care_type=patient_care_type,
			template_dt="Lab Test Template",
			template_dn=template,
			multiplier=multiplier,
		)
		list_amt = flt(charged["rate_before_discount"])
		return {
			"amount": list_amt,
			"insurance_discount_pct": flt(charged["discount_pct"]),
			"insurance_discount_amount": max(0.0, list_amt - flt(charged["rate"])),
		}

	for item in items or []:
		kind = (item.get("kind") or "").strip().lower()
		if kind == "single":
			tpl = (item.get("template") or "").strip()
			if not tpl or tpl in seen_templates:
				continue
			seen_templates.add(tpl)
			priced = _priced_row(tpl)
			specs.append(
				{
					"template": tpl,
					"parent_group": None,
					**priced,
				}
			)
			continue

		if kind == "group":
			parent = (item.get("parent") or "").strip()
			if not parent:
				continue
			children = resolve_group_child_templates(parent, item.get("children"))

			filters: dict[str, Any] = {"lab_group": parent, "disabled": 0}
			if children:
				filters["name"] = ["in", children]

			child_fields = ["name", "price_included_in_group"]
			if not frappe.db.has_column("Lab Test Template", "price_included_in_group") and frappe.db.has_column(
				"Lab Test Template", "price_incuded_in_group"
			):
				child_fields = ["name", "price_incuded_in_group"]

			child_rows = frappe.get_all(
				"Lab Test Template",
				filters=filters,
				fields=child_fields,
				ignore_permissions=True,
			)
			child_rows.sort(key=lambda row: lab_template_sort_key(row.get("name")))

			group_specs: list[dict[str, Any]] = []
			child_by_name = {row.name: row for row in child_rows}
			for tpl in children:
				child = child_by_name.get(tpl)
				if not child:
					continue
				if not tpl or tpl in seen_templates:
					continue
				seen_templates.add(tpl)
				included = cint(
					child.get("price_included_in_group")
					if "price_included_in_group" in child
					else child.get("price_incuded_in_group")
				)
				if included:
					priced = {
						"amount": 0.0,
						"insurance_discount_pct": 0.0,
						"insurance_discount_amount": 0.0,
					}
				else:
					priced = _priced_row(tpl)
				group_specs.append(
					{
						"template": tpl,
						"parent_group": parent,
						"price_included_in_group": included,
						**priced,
					}
				)

			# Group charge always applies when the parent template has a rate.
			# Included children are covered by it; unticked children add their own rates.
			if group_specs:
				parent_priced = _priced_row(parent)
				parent_amount = flt(parent_priced.get("amount") or 0)
				if parent_amount > 0:
					parent_item = frappe.db.get_value("Lab Test Template", parent, "item")
					if parent_item:
						group_specs.insert(
							0,
							{
								"template": parent,
								"parent_group": parent,
								"amount": parent_priced["amount"],
								"insurance_discount_pct": parent_priced.get("insurance_discount_pct"),
								"insurance_discount_amount": parent_priced.get(
									"insurance_discount_amount"
								),
								"billed_from_parent_group": 1,
								"billing_only": 1,
								"price_included_in_group": 0,
							},
						)
					else:
						# No billing Item on the group — park the group rate on an included child.
						anchor = next(
							(s for s in group_specs if s.get("price_included_in_group")),
							group_specs[0],
						)
						if cint(anchor.get("price_included_in_group")) or flt(anchor.get("amount")) <= 0:
							anchor["amount"] = parent_priced["amount"]
							anchor["insurance_discount_pct"] = parent_priced.get(
								"insurance_discount_pct"
							)
							anchor["insurance_discount_amount"] = parent_priced.get(
								"insurance_discount_amount"
							)
						else:
							anchor["amount"] = flt(anchor.get("amount") or 0) + parent_amount
						anchor["billed_from_parent_group"] = 1

			specs.extend(group_specs)

	return specs


def lab_request_items_summary(items: list[dict[str, Any]]) -> str:
	"""Human-readable summary for list views."""
	labels: list[str] = []
	for item in items or []:
		kind = (item.get("kind") or "").strip().lower()
		if kind == "single":
			tpl = item.get("template")
			if tpl:
				labels.append(
					frappe.db.get_value("Lab Test Template", tpl, "lab_test_name") or tpl
				)
		elif kind == "group":
			parent = item.get("parent")
			if parent:
				name = frappe.db.get_value("Lab Test Template", parent, "lab_test_name") or parent
				child_count = len(item.get("children") or [])
				labels.append(f"{name} ({child_count} tests)" if child_count else name)
	if not labels:
		return ""
	if len(labels) <= 3:
		return ", ".join(labels)
	return f"{', '.join(labels[:2])} + {len(labels) - 2} more"


def primary_template_dn_for_items(items: list[dict[str, Any]]) -> str:
	"""Legacy ``template_dn`` for Service Request row (first line)."""
	if not items:
		return ""
	first = items[0]
	if first.get("kind") == "single":
		return (first.get("template") or "").strip()
	if first.get("kind") == "group":
		return (first.get("parent") or "").strip()
	return ""


def _normalize_discount(source: dict[str, Any] | None) -> dict[str, Any]:
	"""Normalize per-test discount fields (Percentage or Amount).

	UI lab discounts are Amount-based; default to Amount so a bare ``discount``
	value is not ignored when ``discount_type`` is omitted.
	"""
	if not source:
		return {"discount_type": "Amount", "discount_rate": 0.0, "discount": 0.0}
	discount_type = (source.get("discount_type") or "Amount").strip()
	if discount_type not in ("Percentage", "Amount"):
		discount_type = "Amount"
	return {
		"discount_type": discount_type,
		"discount_rate": flt(source.get("discount_rate") or 0),
		"discount": flt(source.get("discount") or 0),
	}


def discount_for_template(
	items: list[dict[str, Any]], template: str
) -> dict[str, Any]:
	"""Look up discount config for a concrete lab template from basket JSON."""
	for item in items or []:
		kind = (item.get("kind") or "").strip().lower()
		if kind == "single" and (item.get("template") or "").strip() == template:
			return _normalize_discount(item)
		if kind == "group":
			parent = (item.get("parent") or "").strip()
			# Parent / group-charge SO line uses the group row's own discount fields.
			if parent and template == parent:
				return _normalize_discount(item)
			child_discounts = item.get("child_discounts") or {}
			if isinstance(child_discounts, dict) and template in child_discounts:
				return _normalize_discount(child_discounts.get(template))
	return _normalize_discount(None)


def compute_test_net_amount(
	amount: float,
	discount_type: str = "Percentage",
	discount_rate: float = 0,
	discount: float = 0,
) -> tuple[float, float]:
	"""Return (net_amount, discount_applied) for a single test line.

	Negative discount values are allowed (treated as a surcharge / markup).
	"""
	gross = flt(amount)
	discount_type = (discount_type or "Percentage").strip()
	if discount_type == "Amount":
		applied = flt(discount)
	else:
		applied = gross * flt(discount_rate) / 100
	net = gross - applied
	return net, applied


def apply_discounts_to_specs(
	specs: list[dict[str, Any]], items: list[dict[str, Any]]
) -> list[dict[str, Any]]:
	"""Attach discount + net_amount to expanded lab test specs.

	Manual basket discounts win when set; otherwise insurance % / amount is used
	so list price stays in ``amount`` and the insurance cut is tracked as discount.
	"""
	enriched: list[dict[str, Any]] = []
	for spec in specs or []:
		tpl = spec.get("template")
		amount = flt(spec.get("amount") or 0)
		disc = discount_for_template(items, tpl)
		has_manual = flt(disc.get("discount_rate")) != 0 or flt(disc.get("discount")) != 0
		if not has_manual:
			ins_pct = flt(spec.get("insurance_discount_pct"))
			ins_amt = flt(spec.get("insurance_discount_amount"))
			if ins_pct > 0:
				disc = {
					"discount_type": "Percentage",
					"discount_rate": ins_pct,
					"discount": 0.0,
				}
			elif ins_amt > 0:
				disc = {
					"discount_type": "Amount",
					"discount_rate": 0.0,
					"discount": ins_amt,
				}
		net, applied = compute_test_net_amount(
			amount,
			disc["discount_type"],
			disc["discount_rate"],
			disc["discount"],
		)
		row = dict(spec)
		row.update(disc)
		row["discount_applied"] = applied
		row["net_amount"] = net
		enriched.append(row)
	return enriched


def totals_from_specs(specs: list[dict[str, Any]]) -> dict[str, float]:
	"""Sum gross, net, and discount across expanded specs."""
	gross = sum(flt(s.get("amount") or 0) for s in specs or [])
	net = sum(flt(s.get("net_amount") if s.get("net_amount") is not None else s.get("amount") or 0) for s in specs or [])
	return {
		"cost": gross,
		"grand_total": net,
		"discount_amount": gross - net,
	}
