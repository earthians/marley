// Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Insurance Payor', {
	refresh: function(frm) {
		frappe.dynamic_link = {doc: frm.doc, fieldname: 'name', doctype: 'Insurance Payor'};

		if (frm.doc.__islocal) {
			hide_field(['address_html', 'contact_html', 'address_contacts']);
			frappe.contacts.clear_address_and_contact(frm);
		} else {
			unhide_field(['address_html', 'contact_html', 'address_contacts']);
			frappe.contacts.render_address_and_contact(frm);
		}

		frm.set_query('account', 'claims_receivable_accounts', function(doc, cdt, cdn) {
			var child = locals[cdt][cdn];
			return {
				filters: {
					'account_type': 'Receivable',
					'is_group': 0,
					'disabled' : 0,
					'company': child.company,
				}
			};
		});
		frm.set_query('account', 'rejected_claims_expense_accounts', function(doc, cdt, cdn) {
			var child  = locals[cdt][cdn];
			return {
				filters: {
					'root_type': 'Expense',
					'is_group': 0,
					'disabled' : 0,
					'company': child.company
				}
			};
		});
	}
});
