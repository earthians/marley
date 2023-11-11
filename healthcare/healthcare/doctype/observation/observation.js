// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on("Observation", {
	onload_post_render: function(frm) {
		frm.trigger("set_options");
	},

	permitted_data_type: function(frm) {
		frm.trigger("set_options");
	},

	options: function(frm) {
		frm.trigger("set_options");
	},

	set_options: function(frm) {
		if (frm.doc.permitted_data_type == "Select") {
			frm.set_df_property('result_select', 'options', frm.doc.options);
		} else if (frm.doc.permitted_data_type == "Boolean") {
			frm.set_df_property('result_boolean', 'options', frm.doc.options);
		}
	},

	observation_template: function(frm) {
		get_medical_codes(frm);
	},
});

var get_medical_codes = function(frm) {
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
						if (val.code_value) {
							var child = frm.add_child("codification_table");
							child.code_value = val.code_value
							child.code_system = val.code_system
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