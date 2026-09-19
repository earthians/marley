// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Commission Payslip", {
	refresh(frm) {
		if (frm.is_new()) return;

		if (healthcare_dcs) {
			frm.add_custom_button(
				__("View Statement"),
				() => show_payslip_statement(frm),
				__("View")
			);

			frm.add_custom_button(
				__("Print Statement"),
				() => {
					load_payslip_statement(frm, (data) => healthcare_dcs.print_statement(data));
				},
				__("View")
			);
		}

		// Due Payment sheet for this doctor — services still awaiting payment.
		frm.add_custom_button(
			__("Due Payment"),
			() => {
				frappe.utils.print("Commission Payslip", frm.doc.name, "Doctor Due Payment Payslip");
			},
			__("Print")
		);
	},
});

function show_payslip_statement(frm) {
	const dialog = new frappe.ui.Dialog({
		title: __("Commission Statement"),
		size: "extra-large",
		fields: [{ fieldname: "view_html", fieldtype: "HTML" }],
		secondary_action_label: __("Close"),
		secondary_action() {
			dialog.hide();
		},
	});

	dialog.add_custom_action(
		__("Print"),
		() => {
			if (!dialog._statement) {
				frappe.msgprint(__("Load the statement first."));
				return;
			}
			healthcare_dcs.print_statement(dialog._statement);
		},
		"btn-default"
	);

	dialog.show();
	load_payslip_statement(frm, (data) => {
		dialog._statement = data;
		dialog.fields_dict.view_html.$wrapper.html(healthcare_dcs.render_statement(data, false));
	});
}

function load_payslip_statement(frm, on_load) {
	frm.call({
		doc: frm.doc,
		method: "view_statement",
		freeze: true,
		freeze_message: __("Loading doctor commission statement..."),
		callback(r) {
			if (!r.message) return;
			on_load(r.message);
		},
	});
}
