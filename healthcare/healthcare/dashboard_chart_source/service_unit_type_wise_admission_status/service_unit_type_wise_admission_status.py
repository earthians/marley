# Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
# License: GNU General Public License v3. See license.txt


import frappe
from frappe import _
from frappe.query_builder.functions import Count
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

	ip = frappe.qb.DocType("Inpatient Record")

	query = (
		frappe.qb.from_(ip)
		.select(
			ip.admission_service_unit_type.as_("type"),
			Count(ip.name).as_("total_ip_records"),
			Count(frappe.qb.terms.Case().when(ip.status == "Admission Scheduled", 1)).as_(
				"admission_scheduled"
			),
			Count(frappe.qb.terms.Case().when(ip.status == "Discharge Scheduled", 1)).as_(
				"discharge_scheduled"
			),
			Count(frappe.qb.terms.Case().when(ip.status == "Admitted", 1)).as_("admitted"),
			Count(frappe.qb.terms.Case().when(ip.status == "Discharged", 1)).as_("discharged"),
		)
		.where(
			(ip.status != "Cancelled")
			& (ip.admission_service_unit_type.isnotnull() & (ip.company == company))
		)
		.groupby(ip.admission_service_unit_type)
	)

	data = query.run(as_dict=True)

	labels = []
	admission_scheduled_ips = []
	admitted_ips = []
	discharge_scheduled_ips = []
	discharged_ips = []

	for ip in data:
		labels.append(ip.type)
		admission_scheduled_ips.append(ip.admission_scheduled)
		admitted_ips.append(ip.admitted)
		discharge_scheduled_ips.append(ip.discharge_scheduled)
		discharged_ips.append(ip.discharged)

	return {
		"labels": labels,
		"datasets": [
			{"name": _("Admitted"), "values": admitted_ips},
			{"name": _("Discharged"), "values": discharged_ips},
			{"name": _("To Admit"), "values": admission_scheduled_ips},
			{"name": _("To Discharge"), "values": discharge_scheduled_ips},
		],
		"type": "bar",
	}
