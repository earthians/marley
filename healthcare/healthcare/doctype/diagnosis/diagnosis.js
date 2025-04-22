// Copyright (c) 2016, ESS LLP and contributors
// For license information, please see license.txt

frappe.ui.form.on('Diagnosis', {
    refresh : function(frm) {
		frm.set_query("code_value", "codification_table", function(doc, cdt, cdn) {
			let row = frappe.get_doc(cdt, cdn);
			if (row.code_system) {
				return {
					filters: {
						code_system: row.code_system
					}
				};
			}
		});
	},
});
