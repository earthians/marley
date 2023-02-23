// Copyright (c) 2016, ESS LLP and contributors
// For license information, please see license.txt

frappe.ui.form.on('Diagnosis', {
    refresh : function(frm) {
		frm.set_query("medical_code", "codification_table", function(doc, cdt, cdn) {
			let row = frappe.get_doc(cdt, cdn);
			if (row.medical_code_standard) {
				return {
					filters: {
						medical_code_standard: row.medical_code_standard
					}
				};
			}
		});
	},
});
