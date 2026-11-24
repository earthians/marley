frappe.provide("frappe.dashboards.chart_sources");

frappe.dashboards.chart_sources["ED Arrivals by Triage Level"] = {
	method: "healthcare.emergency.dashboard_chart_source.ed_arrivals_by_triage_level.ed_arrivals_by_triage_level.get",
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
		},
	],
};
