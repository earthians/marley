// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on("Observation Template", {
	onload: function(frm) {
		set_select_field_options(frm);
	},
	refresh: function(frm) {
		frm.set_query("observation_component", function () {
			return {
				"filters": [
					["Observation Template", "has_component", "=", 0],
					["Observation Template", "name", "!=", frm.doc.name],
				]
			};
		});
		frm.set_query("method", function () {
			return {
				"filters": {
					"value_set": "Observation Method"
				}
			};
		});
	},
	permitted_data_type: function(frm) {
		set_observation_reference_range(frm);
	}
});

frappe.ui.form.on("Observation Reference Range", {
	observation_reference_range_add: function(frm) {
		set_observation_reference_range(frm);
	}
})

var set_observation_reference_range = function(frm) {
	$.each(frm.doc.observation_reference_range, function(i, value) {
		frappe.model.set_value(value.doctype, value.name, "permitted_data_type", frm.doc.permitted_data_type)
	})
}

var set_select_field_options = function(frm) {
	if (frm.doc.permitted_data_type == "Select") {
		var normal_df = frappe.meta.get_docfield("Observation Reference Range","normal_select", cur_frm.doc.name);
		var abnormal_df = frappe.meta.get_docfield("Observation Reference Range","abnormal_select", cur_frm.doc.name);
		var critical_df = frappe.meta.get_docfield("Observation Reference Range","critical_select", cur_frm.doc.name);
		normal_df.options = abnormal_df.options = critical_df.options = frm.doc.options;
	}
}