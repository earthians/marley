// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on("Observation Template", {
	refresh: function(frm) {
		frm.set_query("observation_component", function () {
			return {
				"filters": [
					["Observation Template", "has_component", "=", 0],
					["Observation Template", "name", "!=", frm.doc.name],
				]
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