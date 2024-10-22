// Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Healthcare Service Unit Type', {
	refresh: function(frm) {
		frm.set_df_property('item_code', 'read_only', frm.doc.__islocal ? 0 : 1);
		if (!frm.doc.__islocal && frm.doc.is_billable && frm.doc.item) {
			frm.add_custom_button(__('Change Item Code'), function() {
				change_item_code(cur_frm, frm.doc);
			});
		}
		if (!frm.doc.__islocal && frm.doc.is_billable && !frm.doc.item) {
			frm.add_custom_button(__("Create/Link Item"), function() {
				create_item(frm);
			});
		}
	},

	service_unit_type: function(frm) {
		set_item_details(frm);

		if (!frm.doc.__islocal) {
			frm.doc.change_in_item = 1;
		}
	},

	is_billable: function(frm) {
		set_item_details(frm);
	},

	rate: function(frm) {
		if (!frm.doc.__islocal) {
			frm.doc.change_in_item = 1;
		}
	},
	item_group: function(frm) {
		if (!frm.doc.__islocal) {
			frm.doc.change_in_item = 1;
		}
	},
	description: function(frm) {
		if (!frm.doc.__islocal) {
			frm.doc.change_in_item = 1;
		}
	}
});

let set_item_details = function(frm) {
	if (frm.doc.service_unit_type && frm.doc.is_billable) {
		if (!frm.doc.item_code)
			frm.set_value('item_code', frm.doc.service_unit_type);
		if (!frm.doc.description)
			frm.set_value('description', frm.doc.service_unit_type);
		if (!frm.doc.item_group)
			frm.set_value('item_group', 'Services');
	}
};

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
					"method": "healthcare.healthcare.doctype.healthcare_service_unit_type.healthcare_service_unit_type.change_item_code",
					"args": { item: doc.item, item_code: values['item_code'], doc_name: doc.name },
					callback: function() {
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

let create_item = function(frm) {
	let d = new frappe.ui.Dialog({
		title: __("Create/Link Item"),
		fields: [
			{
				"fieldtype": "Link",
				"label": "Item",
				"fieldname": "item",
				"options": "Item",
				"mandatory_depends_on": "eval:doc.link_existing_item==1",
				"depends_on": "eval:doc.link_existing_item==1"
			},
			{
				"fieldtype": "Data",
				"label": "Item Code",
				"fieldname": "item_code",
				"default": frm.doc.item_code,
				"mandatory_depends_on": "eval:doc.link_existing_item==0",
				"read_only": 1,
				"depends_on": "eval:doc.link_existing_item==0"
			},
			{
				"fieldtype": "Check",
				"label": "Link Existing Item",
				"fieldname": "link_existing_item",
				"default": 0
			}
		],
		primary_action: function() {
			if (d.get_value("link_existing_item") && d.get_value("item")) {
				frm.set_value("item", d.get_value("item"));
				frm.save();
			} else if (!d.get_value("link_existing_item") && d.get_value("item_code")) {
				frappe.call({
					"method": "create_service_unit_item",
					"doc": frm.doc,
					callback: function() {
						frm.reload_doc();
					}
				});
			}
			d.hide();
		},
		primary_action_label: __("Create/Link Code")
	});

	d.show();
	d.set_values({
		'Item Code': frm.doc.item_code
	});
};
