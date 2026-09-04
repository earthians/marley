// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Medication Interaction", {
	interactant_a_type: function (frm) {
		frm.set_value("interactant_a", "");
	},

	interactant_b_type: function (frm) {
		frm.set_value("interactant_b", "");
	},
});
