frappe.listview_settings["OT Booking"] = {
	add_fields: ["status"],
	get_indicator: function (doc) {
		var colors = {
			Tentative: "gray",
			Scheduled: "blue",
			"In Progress": "orange",
			Completed: "green",
			Postponed: "yellow",
			Cancelled: "red",
		};
		return [__(doc.status), colors[doc.status], "status,=," + doc.status];
	},
};
