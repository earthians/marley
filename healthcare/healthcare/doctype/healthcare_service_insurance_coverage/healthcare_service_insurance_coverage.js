// Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Healthcare Service Insurance Coverage', {
	refresh: function(frm) {
		frm.set_query('healthcare_insurance_coverage_plan', function() {
			return {
				filters: { 'is_active': 1 }
			};
		});

		frm.set_query('item_code', function() {
			return {
				filters: {
					'is_sales_item': 1,
					'disabled': 0,
					'is_fixed_asset': 0
				}
			};
		});

		frm.set_query('template_dt', function() {
			let service_templates = ['Appointment Type', 'Clinical Procedure Template', 'Therapy Type',
				'Medication', 'Lab Test Template', 'Healthcare Service Unit Type'];
			return {
				filters: {
					name: ['in', service_templates],
				}
			};
		});

		frm.set_query('template_dn', function() {
			if (frm.doc.template_dt != 'Appointment Type') {
				return {
					filters: { is_billable: 1 }
				};
			}
		});
	},

	coverage_based_on: function(frm) {
		frm.set_value({
			'template_dt': '',
			'template_dn': '',
			'item_code': ''
		});
	},

	template_dt: function(frm) {
		frm.set_value('template_dn', '');
	}
});
