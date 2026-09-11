// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Allergy", {
	substance_type: function (frm) {
		frm.set_value("substance", "");
	},
});
