// Copyright (c) 2025, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Healthcare Payment Record", {
	refresh: function (frm) {
		if (frm.doc.status === "Pending") {
			frm.add_custom_button(__("Sync"), function () {
				frm.call({
					doc: frm.doc,
					method: "sync",
					freeze: true,
					freeze_message: __("Syncing Documents ..."),
					callback: (r) => {
						frm.refresh();
					},
				});
			});
		}
	},
});
