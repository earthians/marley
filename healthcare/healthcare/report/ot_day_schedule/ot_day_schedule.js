frappe.query_reports["OT Day Schedule"] = {
	filters: [
		{
			fieldname: "date",
			label: __("Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
			reqd: 1,
		},
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
		},
		{
			fieldname: "department",
			label: __("Department"),
			fieldtype: "Link",
			options: "Medical Department",
		},
		{
			fieldname: "theatre",
			label: __("Theatre"),
			fieldtype: "Link",
			options: "Healthcare Service Unit",
			get_query: () => ({ filters: { is_ot: 1, is_group: 0 } }),
		},
		{
			fieldname: "practitioner",
			label: __("Practitioner"),
			fieldtype: "Link",
			options: "Healthcare Practitioner",
		},
		{
			fieldname: "patient",
			label: __("Patient"),
			fieldtype: "Link",
			options: "Patient",
		},
		{
			fieldname: "group_by",
			label: __("Group By"),
			fieldtype: "Select",
			options: "Theatre\nPractitioner",
			default: "Theatre",
		},
	],
};
