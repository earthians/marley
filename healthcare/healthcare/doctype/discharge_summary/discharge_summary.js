// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on("Discharge Summary", {
	refresh: function (frm){
		frm.set_query('inpatient_record', function(doc) {
			return {
				filters: {
					"status": "Discharge Scheduled",
				}
			};
		});
	},

	onload: function (frm) {
		show_orders(frm);
	},

	inpatient_record: function(frm) {
		show_orders(frm);
	}
});

var show_orders = function(frm) {
	const orders = new healthcare.Orders({
		frm: frm,
		open_activities_wrapper: $(frm.fields_dict.orders_html.wrapper),
		form_wrapper: $(frm.wrapper),
		show_encounter: true,
	});
	orders.refresh();
}
