// Copyright (c) 2016, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt
/* eslint-disable */

frappe.query_reports['Diagnosis Trends'] = {
	"filters": [
		{
			fieldname: 'department',
			label: __('Medical Department'),
			fieldtype: 'Link',
			options: 'Medical Department'
		},
		{
			fieldname: 'from_date',
			label: __('From Date'),
			fieldtype: 'Date',
			default: frappe.defaults.get_user_default('year_start_date'),
			reqd: 1
		},
		{
			fieldname: 'to_date',
			label: __('To Date'),
			fieldtype: 'Date',
			default: frappe.defaults.get_user_default('year_end_date'),
			reqd: 1
		},
		{
			fieldname: 'range',
			label: __('Range'),
			fieldtype: 'Select',
			options:[
				{label: __('Weekly'), value: 'Weekly'},
				{label: __('Monthly'), value: 'Monthly'},
				{label: __('Quarterly'), value: 'Quarterly'},
				{label: __('Yearly'), value: 'Yearly'}
			],
			default: 'Monthly',
			reqd: 1
		}
	],
	after_datatable_render: function(datatable_obj) {
		$(datatable_obj.wrapper).find(".dt-row-0").find('input[type=checkbox]').click();
	},
	get_datatable_options(options) {
		return Object.assign(options, {
			checkboxColumn: true,
			events: {
				onCheckRow: function(data) {
					row_name = data[2].content;
					length = data.length;

					row_values = data.slice(3,length-1).map(function (column) {
						return column.content;
					})

					entry = {
						'name': row_name,
						'values': row_values
					}

					let raw_data = frappe.query_report.chart.data;
					let new_datasets = raw_data.datasets;

					let found = false;
					for (let i=0; i < new_datasets.length;i++) {
						if (new_datasets[i].name == row_name) {
							found = true;
							new_datasets.splice(i,1);
							break;
						}
					}

					if (!found) {
						new_datasets.push(entry);
					}

					let new_data = {
						labels: raw_data.labels,
						datasets: new_datasets
					}

					setTimeout(() => {
						frappe.query_report.chart.update(new_data)
					}, 500)


					setTimeout(() => {
						frappe.query_report.chart.draw(true);
					}, 1000)

					frappe.query_report.raw_chart_data = new_data;
				},
			}
		})
	},
};
