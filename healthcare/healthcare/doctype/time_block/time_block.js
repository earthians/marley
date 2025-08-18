// Copyright (c) 2025, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Time Block", {
	block_end_time: function (frm) {
		frm.events.set_duration(frm);
	},

	block_start_time: function (frm) {
		frm.events.set_duration(frm);
	},

	set_duration: function (frm) {
		if (frm.doc.block_end_time && frm.doc.block_start_time) {
			console.log(frm.doc.block_end_time - frm.doc.block_start_time)
			frm.set_value(
				"block_duration",
				(moment(frm.doc.block_end_time, "HH:mm:ss") - moment(frm.doc.block_start_time, "HH:mm:ss")) / 60000 | 0,
			);
		}
	},
});
