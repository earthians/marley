frappe.listview_settings['Insurance Claim'] = {
	add_fields: ['status'],
	get_indicator: function(doc) {
		return [__(doc.status), {
			'Draft': 'light-blue',
			'Submitted': 'blue',
            'Completed': 'green',
			'Cancelled': 'darkgrey',
			'Error': 'red',
		}[doc.status], 'status,=,' + doc.status];
	}
};
