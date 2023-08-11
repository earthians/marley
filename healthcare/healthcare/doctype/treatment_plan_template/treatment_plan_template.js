// Copyright (c) 2021, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Treatment Plan Template", {
	refresh: function (frm) {
		frm.set_query("type", "items", function () {
			return {
				filters: {
					"name": ["in", [
						"Lab Test Template",
						"Clinical Procedure Template",
						"Therapy Type",
						"Medication",
						"Healthcare Service Unit",
						"Observation Template"
					]],
				}
			};
		});
	},
});

frappe.ui.form.on('Treatment Plan Template Item', {
	template: function(frm, cdt, cdn){
		let child = locals[cdt][cdn];
		if (child.type == "Medication") {
		frappe.call({
			"method": "frappe.client.get",
			args: {
				doctype: "Operation",
				name: d.operation
			},
		})
	}
	}
})
