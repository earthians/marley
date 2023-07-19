// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on("Diagnostic Report", {
	onload: function(frm) {
		show_observations(frm);
	},
	validate: function(frm) {
		if (!frm.doc.__islocal && frm.is_dirty()) {
			this.observation.save_action("save")
		}
	},
});

var show_observations = function(frm) {
	if (frm.doc.patient) {
		frm.fields_dict.observation.html("");
		this.observation = new healthcare.Diagnostic.Observation({
			frm: frm,
			observation_wrapper: $(frm.fields_dict.observation.wrapper),
			create_observation: false,
		});
		this.observation.refresh();
	}
}
