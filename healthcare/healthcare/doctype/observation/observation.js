// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on("Observation", {
	observation_template: function(frm) {
		observation_template(frm);
	},
});

var observation_template = function(frm) {
	if (frm.doc.observation_template) {
		frappe.call({
			"method": "healthcare.healthcare.utils.get_medical_codes",
			args: {
				template_dt: "Observation Template",
				template_dn: frm.doc.observation_template,
			},
			callback: function(r) {
				if (!r.exc && r.message) {
					frm.doc.codification_table = []
					$.each(r.message, function(k, val) {
						if (val.medical_code) {
							var child = cur_frm.add_child("codification_table");
							child.medical_code = val.medical_code
							child.medical_code_standard = val.medical_code_standard
							child.code = val.code
							child.description = val.description
							child.system = val.system
						}
					});
					frm.refresh_field("codification_table");
				} else {
					frm.clear_table("codification_table")
					frm.refresh_field("codification_table");
				}
			}
		})
	} else {
		frm.clear_table("codification_table")
		frm.refresh_field("codification_table");
	}
}