frappe.listview_settings['Service Request'] = {
	add_fields: ['name', 'status'],
	filters: [['docstatus', '=', '1']],
	has_indicator_for_cancelled: 1,
	get_indicator: function (doc) {
		return [__(doc.status), {
			'draft-Request Status': 'orange',
			'active-Request Status': 'green',
			'on-hold-Request Status': 'yellow',
			'completed-Request Status': 'blue',
			'revoked-Request Status': 'grey',
			'replaced-Request Status': 'grey',
			'unknown-Request Status': 'grey',
			'entered-in-error-Request Status': 'red',
		}[doc.status], 'status,=,' + doc.status];
	}
};
