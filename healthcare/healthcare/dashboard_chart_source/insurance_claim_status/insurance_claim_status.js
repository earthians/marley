frappe.provide('frappe.dashboards.chart_sources');

frappe.dashboards.chart_sources["Insurance Claim Status"] = {
	method: "healthcare.healthcare.dashboard_chart_source.insurance_claim_status.insurance_claim_status.get",
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company")
		}
	]
};
