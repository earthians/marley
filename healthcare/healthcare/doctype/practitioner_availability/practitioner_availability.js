// Copyright (c) 2025, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Practitioner Availability", {
	end_time: function (frm) {
		frm.events.set_duration(frm);
	},

	start_time: function (frm) {
		frm.events.set_duration(frm);
	},

	set_duration: function (frm) {
		if (frm.doc.end_time && frm.doc.start_time) {
			end_date = frm.doc.end_date || frm.doc.start_date

			start = new Date(`${frm.doc.start_date} ${frm.doc.start_time}`)
			end = new Date(`${frm.doc.end_date} ${frm.doc.end_time}`)

			frm.set_value(
				"duration",
				parseInt(end - start) / 60000 | 0,
			);
		}
	},

	validate: function (frm) {
		if (frm.doc.type == "Available") {
			frm.set_value("reason", "");
		}
	}
});
