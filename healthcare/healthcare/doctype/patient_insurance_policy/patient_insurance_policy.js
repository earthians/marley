// Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Patient Insurance Policy', {
	onload: function (frm) {
		frm.set_query('insurance_plan', function () {
			return {
				filters: {
					'insurance_payor': frm.doc.insurance_payor
				}
			};
		});

		frm.set_query('patient', function () {
			return {
				filters: {
					'status': 'Active'
				}
			};
		});
	},

	insurance_payor: function (frm) {
		if (frm.doc.insurance_payor) {
			frappe.call({
				'method': 'frappe.client.get_value',
				args: {
					doctype: 'Insurance Payor Contract',
					filters: {
						'insurance_payor': frm.doc.insurance_payor,
						'is_active': 1,
						'end_date': ['>=', frappe.datetime.nowdate()],
						'docstatus': 1
					},
					fieldname: ['name']
				},
				callback: function (data) {
					if (!data.message.name) {
						frappe.msgprint(__('No valid contract found with the Insurance Payor {0}', [frm.doc.insurance_payor]));
						frm.set_value('insurance_payor', '');
					}
				}
			});
		}
	}
});
