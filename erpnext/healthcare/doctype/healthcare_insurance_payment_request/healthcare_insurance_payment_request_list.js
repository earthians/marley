frappe.listview_settings['Healthcare Insurance Payment Request'] = {
	add_fields: ['status'],
	get_indicator: function(doc) {
		return [__(doc.status), {
			'Draft': 'red',
			'Submitted': 'blue',
			'Verified': 'lightblue',
            'Completed': 'green',
			'Cancelled': 'darkgrey'
		}[doc.status], 'status,=,' + doc.status];
	}
};
