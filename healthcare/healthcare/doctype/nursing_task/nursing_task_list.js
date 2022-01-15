// Copyright (c) 2021, healthcare and contributors
// For license information, please see license.txt

frappe.listview_settings['Nursing Task'] = {
	filters: [['status', 'not in', ['Failed', 'Cancelled', 'Completed']]],
	hide_name_column: true,
	has_indicator_for_draft: true,
	get_indicator: function (doc) {
		if (doc.status === 'Draft') {
			return [__('Draft'), 'orange', 'status, =, Draft'];

		} else if (doc.status === 'Requested') {
			return [__('Requested'), 'blue', 'status, =, Requested'];

		} else if (doc.status === 'Rejected') {
			return [__('Rejected'), 'red', 'status, =, Rejected'];

		} else if (doc.status === 'Entered in Error') {
			return [__('Entered in Error'), 'red', 'status, =, Entered In Error'];

		} else if (doc.status === 'Completed') {
			return [__('Completed'), 'green', 'status, =, Completed'];

		} else if (doc.status === 'Cancelled') {
			return [__('Cancelled'), 'grey', 'status, =, Cancelled'];

		}  else if (doc.status === 'Failed') {
			return [__('Failed'), 'red', 'status, =, Failed'];

		} else { // Received, On Hold, Accepted, Ready, In Progress
			return [__(doc.status), 'lightblue', `status, =, ${doc.status}`];
		}
	}
};