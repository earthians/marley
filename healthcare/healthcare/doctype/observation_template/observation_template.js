// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on("Observation Template", {
	onload: function(frm) {
		set_select_field_options(frm);
	},

	observation: function(frm) {
		if (!frm.doc.observation_code) {
			frm.set_value('item_code', frm.doc.observation);
		}
		if (!frm.doc.has_component && !frm.doc.abbr) {
			frm.set_value("abbr", frappe.get_abbr(frm.doc.observation).toUpperCase());
		}
	},

	preferred_display_name: function(frm) {
		if (!frm.doc.has_component && !frm.doc.abbr) {
			frm.set_value("abbr", frappe.get_abbr(frm.doc.preferred_display_name).toUpperCase())
		}
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
					"code_system": "Observation Method",
				}
			};
		});
		frm.set_query("reference_type", "observation_reference_range", function() {
			return {
				filters: {
					"code_system": "Reference Type",
				}
			};
		})
	},

	permitted_data_type: function(frm) {
		set_observation_reference_range(frm);
	},

	observation_name: function(frm) {
		frm.set_value("change_in_item", 1)
	},

	rate: function(frm) {
		frm.set_value("change_in_item", 1)
	},

	item_group: function(frm) {
		frm.set_value("change_in_item", 1)
	},

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
		var normal_df = frappe.meta.get_docfield("Observation Reference Range", "options", frm.doc.name);
		normal_df.options = frm.doc.options;
	}
}
