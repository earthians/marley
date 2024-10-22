// Copyright (c) 2017, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Code Value', {
	setup: function(frm) {
		frm.set_query("version", function () {
			return {
				"filters": {
					"code_system": "FHIRVersion",
				}
			};
		});
	}
});
