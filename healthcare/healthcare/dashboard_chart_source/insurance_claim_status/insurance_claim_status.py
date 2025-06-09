# Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
# License: GNU General Public License v3. See license.txt


import frappe
from frappe import _
from frappe.query_builder.functions import Count, Sum
from frappe.utils.dashboard import cache_source


@frappe.whitelist()
@cache_source
def get(
	chart_name=None,
	chart=None,
	no_cache=None,
	filters=None,
	from_date=None,
	to_date=None,
	timespan=None,
	time_interval=None,
	heatmap_year=None,
):
	if chart_name:
		chart = frappe.get_doc("Dashboard Chart", chart_name)
	else:
		chart = frappe._dict(frappe.parse_json(chart))

	filters = frappe.parse_json(filters)
	company = (
		filters.get("company")
		if filters and filters.get("company")
		else frappe.db.get_single_value("Global Defaults", "default_company")
	)

	claim = frappe.qb.DocType("Insurance Claim")

	query = (
		frappe.qb.from_(claim)
		.select(
			claim.insurance_payor.as_("payor"),
			Count(claim.name).as_("total_claims"),
			Sum(claim.approved_amount).as_("approved"),
			Sum(claim.outstanding_amount).as_("outstanding"),
			Sum(claim.paid_amount).as_("paid"),
			Sum(claim.rejected_amount).as_("rejected"),
		)
		.where((claim.docstatus == 1) & (claim.company == company))
		.groupby(claim.insurance_payor)
	)

	if filters and filters.get("company"):
		query = query.where(claim.company == filters.get("company"))

	data = query.run(as_dict=True)

	labels = []
	approved = []
	outstanding = []
	paid = []
	rejected = []

	for claim in data:
		labels.append(claim.payor)
		approved.append(claim.approved)
		outstanding.append(claim.outstanding)
		paid.append(claim.paid)
		rejected.append(claim.rejected)

	return {
		"labels": labels,
		"datasets": [
			{"name": _("Approved"), "values": approved},
			{"name": _("Outstanding"), "values": outstanding},
			{"name": _("Paid"), "values": paid},
			{"name": _("Rejected"), "values": rejected},
		],
		"type": "bar",
	}
