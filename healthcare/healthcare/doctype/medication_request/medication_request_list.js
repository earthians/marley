frappe.listview_settings[('Medication Request')] = {
	add_fields: ['name', 'status'],
	filters: [['docstatus', '=', '1']],
	has_indicator_for_cancelled: 1,
	get_indicator: function (doc) {
		return [__(doc.status), {
			'active-Medication Request Status': 'green',
			'on-hold-Medication Request Status': 'yellow',
			'stopped-Medication Request Status': 'orange',
			'ended-Medication Request Status': 'grey',
			'completed-Medication Request Status': 'blue',
			'cancelled-Medication Request Status': 'yellow',
			'entered-in-error-Medication Request Status': 'red',
			'draft-Medication Request Status': 'orange',
			'unknown-Medication Request Status': 'grey',
		}[doc.status], 'status,=,' + doc.status];
	}
};
