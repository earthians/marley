// Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Therapy Plan Template', {
	refresh: function(frm) {
		frm.set_query('therapy_type', 'therapy_types', () => {
			return {
				filters: {
					'is_billable': 1
				}
			};
		});

		frm.set_query('linked_item', function() {
			return {
				filters: {
					'disabled': false,
					'is_stock_item': false
				}
			};
		});
	},

	set_totals: function (frm) {
		let total_sessions = 0;
		let total_amount = 0.0;
		frm.doc.therapy_types.forEach((d) => {
			if (d.no_of_sessions) total_sessions += cint(d.no_of_sessions);
			if (d.amount) total_amount += flt(d.amount);
		});
		frm.set_value('total_sessions', total_sessions);
		frm.set_value('total_amount', total_amount);
		frm.refresh_fields();
	},

	link_existing_item: function (frm) {
		if (frm.doc.link_existing_item) {
			frm.set_value('item_code', '');
		} else {
			frm.set_value('linked_item', '');
		}
	},

	linked_item: function (frm) {
		if (frm.doc.linked_item) {
			frappe.db.get_value('Item', frm.doc.linked_item, ['item_group', 'description', 'item_name'])
			.then(r => {
				frm.set_value({
					'item_group': r.message.item_group,
					'description': r.message.description,
					'item_name': r.message.item_name
				});
			})
		}
	}
});

frappe.ui.form.on('Therapy Plan Template Detail', {
	therapy_type: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		frappe.call('frappe.client.get', {
			doctype: 'Therapy Type',
			name: row.therapy_type
		}).then((res) => {
			row.rate = res.message.rate;
			if (!row.no_of_sessions)
				row.no_of_sessions = 1;
			row.amount = flt(row.rate) * cint(row.no_of_sessions);
			frm.refresh_field('therapy_types');
			frm.trigger('set_totals');
		});
	},

	no_of_sessions: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		row.amount = flt(row.rate) * cint(row.no_of_sessions);
		frm.refresh_field('therapy_types');
		frm.trigger('set_totals');
	},

	rate: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		row.amount = flt(row.rate) * cint(row.no_of_sessions);
		frm.refresh_field('therapy_types');
		frm.trigger('set_totals');
	}
});
