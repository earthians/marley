frappe.provide('frappe.dashboards.chart_sources');

frappe.dashboards.chart_sources["Service Unit Type wise Admission Status"] = {
	method: "healthcare.healthcare.dashboard_chart_source.service_unit_type_wise_admission_status.service_unit_type_wise_admission_status.get",
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
