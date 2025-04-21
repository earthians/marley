/*
(c) ESS 2015-16
*/
frappe.listview_settings["Patient Appointment"] = {
	filters: [["status", "=", "Open"]],
	get_indicator: function(doc) {
		var colors = {
			"Open": "orange",
			"Scheduled": "yellow",
			"Closed": "grey",
			"Cancelled": "red",
			"Expired": "grey",
			"Checked In": "blue",
			"Checked Out": "orange",
			"Confirmed": "green",
			"No Show": "pink"
		};
		return [__(doc.status), colors[doc.status], "status,=," + doc.status];
	}
};
