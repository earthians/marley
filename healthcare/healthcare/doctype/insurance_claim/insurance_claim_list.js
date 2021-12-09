frappe.listview_settings['Insurance Claim'] = {
	add_fields: ['status'],
	get_indicator: function(doc) {
		return [__(doc.status), {
			'Draft': 'red',
			'Submitted': 'blue',
            'Completed': 'green',
			'Cancelled': 'darkgrey'
		}[doc.status], 'status,=,' + doc.status];
	}
};
