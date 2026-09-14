// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.query_reports["Income by Doctor Patient and Source"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
			reqd: 1,
		},
		{
			fieldname: "fiscal_year",
			label: __("Year"),
			fieldtype: "Link",
			options: "Fiscal Year",
			default: frappe.defaults.get_user_default("fiscal_year"),
			reqd: 1,
		},
		{
			fieldname: "periodicity",
			label: __("Periodicity"),
			fieldtype: "Select",
			options: "Monthly\nYearly",
			default: "Monthly",
			reqd: 1,
		},
		{
			fieldname: "group_by",
			label: __("Group By"),
			fieldtype: "Select",
			options: "Doctor\nPatient\nSource",
			default: "Doctor",
			reqd: 1,
		},
		{
			fieldname: "cost_center",
			label: __("Branch / Cost Center"),
			fieldtype: "Link",
			options: "Cost Center",
		},
		{
			fieldname: "practitioner",
			label: __("Doctor"),
			fieldtype: "Link",
			options: "Healthcare Practitioner",
			get_query: function () {
				return { filters: { receive_commision: 1 } };
			},
		},
		{
			fieldname: "patient",
			label: __("Patient"),
			fieldtype: "Link",
			options: "Patient",
		},
		{
			fieldname: "source",
			label: __("Source"),
			fieldtype: "Link",
			options: "Patient Source",
		},
		{
			fieldname: "paid",
			label: __("Paid Only"),
			fieldtype: "Check",
			default: 1,
		},
	],
};
