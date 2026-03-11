/*
(c) ESS 2015-16
*/
frappe.listview_settings["Lab Test"] = {
	add_fields: ["name", "status", "invoiced"],
	filters: [["docstatus", "=", "1"]],
	get_indicator: function (doc) {
		if (doc.status === "Approved") {
			return [__("Approved"), "green", "status, =, Approved"];
		} else if (doc.status === "Rejected") {
			return [__("Rejected"), "orange", "status, =, Rejected"];
		} else if (doc.status === "Completed") {
			return [__("Completed"), "green", "status, =, Completed"];
		} else if (doc.status === "Cancelled") {
			return [__("Cancelled"), "red", "status, =, Cancelled"];
		}
	},
	onload: function (listview) {
		listview.page.add_menu_item(__("Create Multiple"), function () {
			create_multiple_dialog(listview);
		});
	},
};

var create_multiple_dialog = function (listview) {
	var dialog = new frappe.ui.Dialog({
		title: "Create Multiple Lab Tests",
		width: 100,
		fields: [
			{
				fieldtype: "Link",
				label: "Patient",
				fieldname: "patient",
				options: "Patient",
				reqd: 1,
			},
			{
				fieldtype: "Select",
				label: "Invoice / Patient Encounter",
				fieldname: "doctype",
				options: "\nSales Invoice\nPatient Encounter",
				reqd: 1,
			},
			{
				fieldtype: "Dynamic Link",
				fieldname: "docname",
				options: "doctype",
				reqd: 1,
				get_query: function () {
					return {
						filters: {
							patient: dialog.get_value("patient"),
							docstatus: 1,
						},
					};
				},
				onchange: function () {
					var doctype = dialog.get_value("doctype");
					var docname = dialog.get_value("docname");
					if (doctype && docname) {
						frappe.call({
							method: "healthcare.healthcare.doctype.lab_test.lab_test.get_lab_test_count_for_doc",
							args: { doctype: doctype, docname: docname },
							callback: function (r) {
								if (r.message !== undefined) {
									var count = r.message;
									dialog.set_df_property('docname', 'description', __(`Uncreated Lab Tests: ${count}`));

									if (dialog.custom_btn_multi) {
										dialog.custom_btn_multi.remove();
										dialog.custom_btn_multi = null;
									}

									if (count === 1) {

										dialog.set_primary_action(__('Create Single'), function () {
											create_lab_tests('single', dialog, listview);
										});

									} else if (count > 1) {

										dialog.set_primary_action(__('Create Single'), function () {
											create_lab_tests('single', dialog, listview);
										});

										dialog.add_custom_action(__('Create Bundle'), function () {
											create_lab_tests('bundle', dialog, listview);
										});

										// When none
									} else {

										dialog.set_primary_action(__('Create'), function () {
											frappe.msgprint(__("No Lab Tests to create"));
										});

									}
								}
							}
						});
					} else {
						dialog.set_df_property('docname', 'description', '');
						if (dialog.custom_btn_multi) {
							dialog.custom_btn_multi.remove();
							dialog.custom_btn_multi = null;
						}
						dialog.set_primary_action(__('Create'), function () {
							frappe.msgprint(__("Select Patient and Invoice/Encounter First"));
						});
					}
				}
			},
		],
		primary_action_label: __("Create"),
		primary_action: function () {
			frappe.msgprint(__("Select Patient and Invoice/Encounter First"));
		},
	});

	dialog.show();
};

var create_lab_tests = function (mode, dialog, listview) {
	var method = mode === 'single'
		? "healthcare.healthcare.doctype.lab_test.lab_test.create_multiple"
		: "healthcare.healthcare.doctype.lab_test.lab_test.create_lab_test_bundle";

	frappe.call({
		method: method,
		args: {
			doctype: dialog.get_value("doctype"),
			docname: dialog.get_value("docname"),
		},
		callback: function (data) {
			if (!data.exc) {
				if (!data.message) {
					frappe.msgprint(__("No Lab Tests created"));
				}
				listview.refresh();
			}
		},
		freeze: true,
		freeze_message: __("Creating Lab Tests..."),
	});
	dialog.hide();
};

