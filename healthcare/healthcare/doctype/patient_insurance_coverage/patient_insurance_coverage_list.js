frappe.listview_settings['Patient Insurance Coverage'] = {
	add_fields: ['name', 'status'],
	filters: [['docstatus', '=', '1']],
	get_indicator: function(doc) {
		return [__(doc.status), {
			'Draft': 'orange',
			'Approved': 'blue',
			'Cancelled': 'grey',
			'Rejected': 'darkgrey',
			'Invoiced': 'light-blue',
			'Partly Invoiced': 'light-blue',
			'Claim Submitted': 'blue',
			'Claim Approved': 'blue',
			'Claim Error': 'red',
			'Claim Rejected': 'red',
			'Completed': 'green'
		}[doc.status], 'status,=,' + doc.status];
	}
};
