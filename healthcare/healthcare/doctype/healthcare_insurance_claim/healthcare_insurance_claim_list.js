frappe.listview_settings['Healthcare Insurance Claim'] = {
	add_fields: ['name', 'status'],
	filters: [['docstatus', '=', '1']],
	get_indicator: function(doc) {
		return [__(doc.status), {
			'Draft': 'red',
			'Approved': 'blue',
			'Invoiced': 'orange',
			'Partially Invoiced': 'orange',
			'Paid': 'green',
			'Partially Paid': 'orange',
			'Resubmitted': 'blue',
			'Rejected': 'grey',
			'Payment Rejected': 'grey'
		}[doc.status], 'status,=,' + doc.status];
	}
};