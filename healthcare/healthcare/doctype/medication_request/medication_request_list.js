frappe.listview_settings["Medication Request"] = {
	add_fields: ["name", "status"],
	filters: [["docstatus", "=", "1"]],
	has_indicator_for_cancelled: 1,
	get_indicator: function (doc) {
		if (doc.status == "draft-Medication Request Status") {
			return [__("Draft"), "orange", "status,=,Draft"];
		} else if (doc.status == "stopped-Medication Request Status") {
			return [__("Stopped"), "orange", "status,=,Stopped"];
		} else if (doc.status == "active-Medication Request Status") {
			return [__("Active"), "green", "status,=,Active"];
		} else if (doc.status == "on-hold-Medication Request Status") {
			return [__("On Hold"), "yellow", "status,=,On Hold"];
		} else if (doc.status == "completed-Medication Request Status") {
			return [__("Completed"), "blue", "status,=,Completed"];
		} else if (doc.status == "ended-Medication Request Status") {
			return [__("Ended"), "grey", "status,=,Ended"];
		} else if (doc.status == "cancelled-Medication Request Status") {
			return [__("Cancelled"), "grey", "status,=,Cancelled"];
		} else if (doc.status == "entered-in-error-Medication Request Status") {
			return [__("Entered In Error"), "red", "status,=,Entered In Error"];
		} else {
			//if (doc.status == "unknown-Medication Request Status") {
			return [__("Unknown"), "grey", "status,=,Unknown"];
		}
	},
};
