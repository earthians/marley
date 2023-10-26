frappe.listview_settings['Sample Collection'] = {
	get_indicator: function(doc) {
		var colors = {
            "Pending": "red",
            "Partly Collected": "orange",
            "Collected": "green",
		};
		return [__(doc.status), colors[doc.status], "status,=," + doc.status];
	}
};
