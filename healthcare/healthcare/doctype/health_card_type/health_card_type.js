// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on('Health Card Type', {
	refresh: function(frm) {
		frm.set_df_property('item_code', 'read_only', frm.doc.__islocal ? 0 : 1);
		if (!frm.doc.__islocal) {
			frm.add_custom_button(__('Change Item Code'), function() {
				change_item_code(cur_frm, frm.doc);
			});
		}		
		frm.set_query("discount_type", "healthcard_discount_item", function(doc, cdt, cdn) {
			return {
				filters: {
					name: ['in', ['Item', 'Item Group']],
				}
			};
		});
	},

	health_card_type: function(frm) {
		if (frm.doc.__islocal) {
			frm.set_value('item_code', frm.doc.health_card_type);
			frm.set_value('description', frm.doc.health_card_type);
			frm.set_value('item_group', 'Services');
		}
	}
});

let change_item_code = function(frm, doc) {
	let d = new frappe.ui.Dialog({
		title: __('Change Item Code'),
		fields: [
			{
				'fieldtype': 'Data',
				'label': 'Item Code',
				'fieldname': 'item_code',
				'default': doc.item_code,
				reqd: 1,
			}
		],
		primary_action: function() {
			let values = d.get_values();
			if (values) {
				frappe.call({
					"method": "healthcare.healthcare.doctype.healthcard_type.healthcard_type.change_item_code",
					"args": {item: doc.item, item_code: values['item_code'], doc_name: doc.name},
					callback: function () {
						frm.reload_doc();
					}
				});
			}
			d.hide();
		},
		primary_action_label: __("Change Template Code")
	});

	d.show();
	d.set_values({
		'Item Code': frm.doc.item_code
	});
};