// Copyright (c) 2021, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on('Healthcare Activity', {
	onload: function(frm) {

		frm.set_query('role', function() {
			return {
				filters: {
					'disabled': false,
					'desk_access': true
				}
			};
		});

		frm.set_query('task_doctype', function() {
			return {
				filters: {
					'istable': false,
					'issingle': false
				}
			};
		});

	}
});
