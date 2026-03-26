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

		frappe.require('assets/healthcare/js/utils.js', function() {
			healthcare.utils.set_codification_table_query(frm);
		});
	},

	before_save: async function(frm) {
		await new Promise(function(resolve) {
			frappe.require('assets/healthcare/js/utils.js', resolve);
		});
		await healthcare.utils.before_save_check(frm);
	},

});


frappe.ui.form.on('Codification Table', {
	code_value_set: function(frm, cdt, cdn){
		frappe.require('assets/healthcare/js/utils.js', function() {
			healthcare.utils.set_codification_table_query(frm);
		});
	},
	code_system: function(frm, cdt, cdn){
		frappe.require('assets/healthcare/js/utils.js', function() {
			healthcare.utils.set_codification_table_query(frm);
		});
	},
	code_value: function(frm, cdt, cdn){
		var row = locals[cdt][cdn];
		if (!row.code_value_set) {
			frappe.require('assets/healthcare/js/utils.js', function() {
				healthcare.utils.auto_table_code_val_set(frm, cdt, cdn);
			});
		}
		frappe.require('assets/healthcare/js/utils.js', function() {
			healthcare.utils.set_codification_table_query(frm);
		});
	}
});
