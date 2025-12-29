frappe.listview_settings["Service Request"] = {
	add_fields: ["name", "status"],
	filters: [["docstatus", "=", "1"]],
	has_indicator_for_cancelled: 1,
	get_indicator: function (doc) {
		if (doc.status == "draft-Request Status") {
			return [__("Draft"), "orange", "status,=,Draft"];
		} else if (doc.status == "active-Request Status") {
			return [__("Active"), "green", "status,=,Active"];
		} else if (doc.status == "on-hold-Request Status") {
			return [__("On Hold"), "yellow", "status,=,On Hold"];
		} else if (doc.status == "completed-Request Status") {
			return [__("Completed"), "blue", "status,=,Completed"];
		} else if (doc.status == "revoked-Request Status") {
			return [__("Revoked"), "grey", "status,=,Revoked"];
		} else if (doc.status == "replaced-Request Status") {
			return [__("Replaced"), "grey", "status,=,Replaced"];
		} else if (doc.status == "entered-in-error-Request Status") {
			return [__("Entered In Error"), "red", "status,=,Entered In Error"];
		} else {
			//if (doc.status == "unknown-Request Status") {
			return [__("Unknown"), "grey", "status,=,Unknown"];
		}
	},
};
