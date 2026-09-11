frappe.listview_settings["Fee Validity"] = {
	add_fields: ["practitioner", "patient", "status", "valid_till"],
	filters: [["status", "=", "Active"]],
	get_indicator: function (doc) {
		const color = {
			Active: "green",
			Completed: "grey",
			Expired: "orange",
			Cancelled: "red",
		};
		return [__(doc.status), color[doc.status], "status,=," + doc.status];
	},
};
