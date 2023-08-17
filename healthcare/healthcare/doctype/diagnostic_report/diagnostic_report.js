// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on("Diagnostic Report", {
	refresh: function(frm) {
		show_diagnostic_report(frm);
	},
	before_save: function(frm) {
		if (!frm.doc.__islocal && frm.is_dirty()) {
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
