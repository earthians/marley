// Copyright (c) 2022, healthcare and contributors
// For license information, please see license.txt
{% include "healthcare/public/js/service_request.js" %}

frappe.ui.form.on('Medication Request', {
	refresh: function(frm) {
		if (frm.doc.status != "Completed") {
			frm.add_custom_button(__('Nursing Task'), function() {
				frappe.db.get_value("Nursing Task", {"service_name": frm.doc.name, "docstatus":["!=", 2]}, "name")
					.then(r => {
						if (Object.keys(r.message).length == 0) {
							frm.trigger('make_nursing_task');
						} else {
							if (r.message && r.message.name) {
								frappe.set_route("Form", "Nursing Task", r.message.name);
								frappe.show_alert({
									message: __(`Nursing Task is already created`),
									indicator: "info",
								});
							}
						}
					})
			},__('Create'));
		}
	},

	make_nursing_task: function(frm) {
		if (!frm.doc.healthcare_activity) {
			var dialog = new frappe.ui.Dialog ({
				title: "Create Healthcare Activity",
				fields: [
					{fieldtype: "Link", label: "Healthcare Activity", options: "Healthcare Activity", fieldname: "healthcare_activity", reqd: 1},
				],
				primary_action_label: __("Create"),
				primary_action : function() {
					frappe.call({
						method: 'healthcare.healthcare.doctype.medication_request.medication_request.make_nursing_task',
						args: {
							medication_request: frm.doc,
							healthcare_activity: dialog.get_value("healthcare_activity")
						},
						freeze: true,
						callback: function(r) {
							var doclist = frappe.model.sync(r.message);
							frappe.set_route('Form', doclist[0].doctype, doclist[0].name);
						}
					});
				}
			});
			dialog.show();
		} else {
			frappe.call({
				method: 'healthcare.healthcare.doctype.medication_request.medication_request.make_nursing_task',
				args: { medication_request: frm.doc },
				freeze: true,
				callback: function(r) {
					var doclist = frappe.model.sync(r.message);
					frappe.set_route('Form', doclist[0].doctype, doclist[0].name);
				}
			});
		}
	},
})
