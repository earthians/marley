frappe.listview_settings['Healthcare Insurance Claim'] = {
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
			'Payment Requested': 'blue',
			'Payment Approved': 'green',
			'Completed': 'green',
			'Payment Error': 'red',
			'Payment Rejected': 'darkgrey'
		}[doc.status], 'status,=,' + doc.status];
	}
};
