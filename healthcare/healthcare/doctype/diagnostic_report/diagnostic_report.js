// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on("Diagnostic Report", {
	refresh: function(frm) {
		show_diagnostic_report(frm);
		if (!frm.is_new()) {
			frm.add_custom_button(__(`Get PDF`), function () {
				generate_pdf_with_print_format(frm)
			})
		}
	},
	before_save: function(frm) {
		if (!frm.doc.is_new() && frm.is_dirty()) {
			this.diagnostic_report.save_action("save")
		}
	},
	after_workflow_action: function(frm) {
		frappe.call({
			"method": "healthcare.healthcare.doctype.diagnostic_report.diagnostic_report.set_observation_status",
			args: {
				docname: frm.doc.name
			},
		})
	}
});

var show_diagnostic_report = function(frm) {
	frm.fields_dict.observation.html("");
	if (frm.doc.patient) {
		this.diagnostic_report = new healthcare.Diagnostic.DiagnosticReport({
			frm: frm,
			observation_wrapper: $(frm.fields_dict.observation.wrapper),
			create_observation: false,
		});
		this.diagnostic_report.refresh();
	}
}

var generate_pdf_with_print_format = function(frm) {
	const letterheads = get_letterhead_options();
	const dialog = new frappe.ui.Dialog({
		title: __('Print {0}', [frm.doc.name]),
		fields: [
			{
				fieldtype: "Select",
				label: __("Letter Head"),
				fieldname: "letter_sel",
				options: letterheads,
				default: letterheads[0],
			},
			{
				fieldtype: "Select",
				label: __("Print Format"),
				fieldname: "print_sel",
				options: frappe.meta.get_print_formats(frm.doc.doctype),
				default: frappe.get_meta(frm.doc.doctype).default_print_format,
			}
		],
	});

	dialog.set_primary_action(__("Print"), (args) => {
		if (!args) return;
		const default_print_format = frappe.get_meta(frm.doc.doctype).default_print_format;
		const with_letterhead = args.letter_sel == __("No Letterhead") ? 0 : 1;
		const print_format = args.print_sel ? args.print_sel : default_print_format;
		const doc_names = JSON.stringify([
			frm.doc.name,
			]);
		const letterhead = args.letter_sel;

		let pdf_options = JSON.stringify({
			"page-size": "A4",
			"margin-top": "60mm",
			"margin-bottom": "60mm",
			"margin-left": "0mm",
			"margin-right": "0mm",
		});

		if (letterhead == __("No Letterhead")) {
			pdf_options = JSON.stringify({
				"page-size": "A4",
				"margin-top": "5mm",
				"margin-bottom": "5mm",
				"margin-left": "0mm",
				"margin-right": "0mm",
			});
		}

		const w = window.open(
			"/api/method/frappe.utils.print_format.download_multi_pdf?" +
				"doctype=" +
				encodeURIComponent(frm.doc.doctype) +
				"&name=" +
				encodeURIComponent(doc_names) +
				"&format=" +
				encodeURIComponent(print_format) +
				"&no_letterhead=" +
				(with_letterhead ? "0" : "1") +
				"&letterhead=" +
				encodeURIComponent(letterhead) +
				"&options=" +
				encodeURIComponent(pdf_options)
		);

		if (!w) {
			frappe.msgprint(__("Please enable pop-ups"));
			return;
		}
	});

	dialog.show();
}

var get_letterhead_options = () => {
	const letterhead_options = [__("No Letterhead")];
	frappe.call({
		method: "frappe.client.get_list",
		args: {
			doctype: "Letter Head",
			fields: ["name", "is_default"],
			filters: { disabled: 0 },
			limit_page_length: 0,
		},
		async: false,
		callback(r) {
			if (r.message) {
				r.message.forEach((letterhead) => {
					letterhead_options.push(letterhead.name);
				});
			}
		},
	});
	return letterhead_options;
};