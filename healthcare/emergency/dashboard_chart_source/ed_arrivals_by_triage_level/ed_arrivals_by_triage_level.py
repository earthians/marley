# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _
from frappe.utils import add_days, today
from frappe.utils.dashboard import cache_source

CHART = "ED Arrivals by Triage Level"
NOT_TRIAGED_COLOUR = "#9ca3af"
WINDOW_DAYS = 30


@frappe.whitelist()
@cache_source
def get(
	chart_name: str | None = None,
	chart: str | None = None,
	no_cache: int | None = None,
	filters: str | dict | None = None,
	from_date: str | None = None,
	to_date: str | None = None,
	timespan: str | None = None,
	time_interval: str | None = None,
	heatmap_year: str | None = None,
) -> dict:
	frappe.has_permission("Emergency Record", "read", throw=True)
	counts = arrivals_by_level(frappe.parse_json(filters) or {})
	levels = ordered_levels()
	return {
		"labels": [level.name for level in levels] + [_("Not Triaged")],
		"datasets": [
			{
				"name": _("Arrivals"),
				"values": [counts.get(level.name, 0) for level in levels] + [counts.get(None, 0)],
			}
		],
	}


def arrivals_by_level(filters: dict) -> dict:
	conditions = {
		"status": ["!=", "Cancelled"],
		"arrival_datetime": [">=", add_days(today(), -WINDOW_DAYS)],
	}
	if filters.get("company"):
		conditions["company"] = filters.get("company")
	rows = frappe.get_list(
		"Emergency Record",
		fields=["triage_level", {"COUNT": "*", "as": "arrivals"}],
		filters=conditions,
		group_by="triage_level",
	)
	return {row.triage_level or None: row.arrivals for row in rows}


def ordered_levels() -> list:
	return frappe.get_all("Triage Level", fields=["name", "color"], order_by="priority asc, name asc")


def level_colours() -> list[str]:
	return [level.color or NOT_TRIAGED_COLOUR for level in ordered_levels()] + [NOT_TRIAGED_COLOUR]


def sync_colours() -> None:
	if not frappe.db.exists("Dashboard Chart", CHART):
		return
	options = json.loads(frappe.db.get_value("Dashboard Chart", CHART, "custom_options") or "{}")
	options["colors"] = level_colours()
	frappe.db.set_value(
		"Dashboard Chart", CHART, "custom_options", json.dumps(options), update_modified=False
	)
	frappe.cache.delete_value(f"chart-data:{CHART}")
