frappe.listview_settings['Patient Insurance Coverage'] = {
	add_fields: ['name', 'status'],
	filters: [['docstatus', '=', '1']],
	get_indicator: function(doc) {
		return [__(doc.status), {
			'Draft': 'red',
			'Approved': 'blue',
			'Cancelled': 'grey',
			'Rejected': 'darkgrey',
			'Invoiced': 'lightblue',
			'Partially Invoiced': 'lightblue',
			'Claim Processing': 'blue',
			'Payment Approved': 'green',
			'Completed': 'green',
			'Claim Error': 'red',
			'Payment Rejected': 'darkgrey'
		}[doc.status], 'status,=,' + doc.status];
	}
};
