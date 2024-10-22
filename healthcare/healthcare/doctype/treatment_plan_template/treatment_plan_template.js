// Copyright (c) 2021, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Treatment Plan Template", {
	refresh: function (frm) {
		frm.set_query("type", "items", function () {
			return {
				filters: {
					"name": ["in", [
						'Lab Test Template',
						'Clinical Procedure Template',
						'Therapy Type',
						'Observation Template',
					]],
				}
			};
		});

		frm.set_query('drug_code', 'drugs', function(doc, cdt, cdn) {
			let row = frappe.get_doc(cdt, cdn);
			if (row.medication) {
				return {
					query: 'healthcare.healthcare.doctype.patient_encounter.patient_encounter.get_medications_query',
					filters: { name: row.medication }
				};
			} else {
				return {
					filters: {
						is_stock_item: 1
					}
				};
			}
		});
	},
});
