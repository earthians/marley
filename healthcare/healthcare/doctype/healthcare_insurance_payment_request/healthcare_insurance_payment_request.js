// Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Healthcare Insurance Payment Request', {
	onload: function(frm) {
		frm.set_indicator_formatter('insurance_claim', (claim) => {
			return {
				'Draft': 'red',
				'Submitted': 'blue',
				'Payment Approved': 'green',
				'Payment Error': 'orange',
				'Payment Rejected': 'red',
				'Completed': 'green',
				'Cancelled': 'grey'
			}[claim.status];
		});
	},

	refresh: function(frm) {
		frm.set_query('insurance_company', function() {
			return {
				filters: {
					'company': frm.doc.company
				}
			};
		});

		frm.set_query('insurance_subscription', function() {
			return {
				filters: {
					'patient': frm.doc.patient,
					'insurance_company': frm.doc.insurance_company
				}
			};
		});

		frm.fields_dict["claims"].grid.wrapper.find('.grid-add-row').hide();
		frm.fields_dict["claims"].grid.clear_custom_buttons();

		if (frm.doc.docstatus == 1 && frm.doc.status == 'Verified') {

			frm.add_custom_button(__('Edit'), () => {
				frm.set_value('status', 'Submitted');
				frm.save('Update');
			});
			if (frm.doc.outstanding_amount > 0) {
				frm.add_custom_button(__('Create Payment Entry'), () => frm.trigger('make_payment_entry'));
			}
		}

		if (frm.doc.docstatus == 1 && frm.doc.status == 'Submitted') {

			frm.add_custom_button(__('Mark as Verified'), () => {
				frm.set_value('status', 'Verified');
				frm.save('Update');
			});

			frm.fields_dict["claims"].grid.add_custom_button(__('Update Status'), () => {

				let claims = frm.get_field('claims').grid.get_selected_children();

				if (claims.length <= 0) {
					frappe.show_alert({
						message: __('Please first select the rows you want to update'),
						indicator: 'warning'
					});

				} else {

					let d = new frappe.ui.Dialog({
						fields: [
							{
								label: __('Status'),
								fieldname: 'status',
								fieldtype: 'Select',
								options: 'Payment Approved\nPayment Error\nPayment Rejected',
								reqd: 1,
								onchange: () => {
									if (cur_dialog.fields_dict.status.value == 'Payment Approved') {
										cur_dialog.set_df_property('payment_error_reason', 'hidden', true);
										cur_dialog.set_df_property('payment_error_reason', 'reqd', false);
									} else {
										cur_dialog.set_df_property('payment_error_reason', 'hidden', false);
										cur_dialog.set_df_property('payment_error_reason', 'reqd', true);
									}
								}
							},
							{
								label: __('Payment Error / Reject Reason'),
								fieldname: 'payment_error_reason',
								fieldtype: 'Small Text'
							}
						],
						primary_action_label: __('Update'),
						primary_action: () => {
							let values = d.get_values();

							claims.forEach(claim => {
								frappe.model.set_value(claim.doctype, claim.name, {
									'status': values.status,
									'approved_amount': values.status == 'Payment Approved' ? claim.claim_amount : 0,
									'rejected_amount': values.status == 'Payment Approved' ? 0 : claim.claim_amount,
									'payment_error_reason': values.payment_error_reason
								});
							});
							frm.save('Update');

							d.hide();
						}
					});
					d.show();
				}
			});
		}
	},


	from_date: function(frm) {
		frm.trigger('get_insurance_claims');
	},

	to_date: function(frm) {
		frm.trigger('get_insurance_claims');
	},

	insurance_company: function(frm) {
		frm.trigger('get_insurance_claims');
	},

	fetch_claims_based_on: function(frm) {
		frm.trigger('get_insurance_claims');
	},

	get_insurance_claims: function(frm) {
		frm.doc.claims = [];

		frappe.call({
			method: 'get_claims',
			doc: frm.doc,
			freeze: true,
			freeze_message: __('Fetching Claims'),
			callback: function() {
				frm.refresh_field('claims');
				frm.trigger('set_totals');
			}
		});
	},

	set_totals: function(frm) {
		let payment_request_amount = 0;
		let approved_amount = 0;
		let rejected_amount = 0;

		$.each(frm.doc.claims || [], (_i, claim) => {
			payment_request_amount += flt(claim.claim_amount);
			approved_amount += flt(claim.approved_amount);
			rejected_amount += flt(claim.rejected_amount);
		});

		frm.set_values({
			'payment_request_amount': payment_request_amount,
			'approved_amount': approved_amount,
			'rejected_amount': rejected_amount,
			'outstanding_amount': approved_amount - frm.doc.paid_amount
		});

		frm.refresh_fields();
	},

	make_payment_entry: function(frm) {
		return frappe.call({
			method: 'erpnext.healthcare.doctype.healthcare_insurance_payment_request.healthcare_insurance_payment_request.create_payment_entry',
			args: { 'doc': frm.doc },
			callback: function(r) {
				let doc = frappe.model.sync(r.message);
				frappe.set_route('Form', doc[0].doctype, doc[0].name);
			}
		});
	}
});

frappe.ui.form.on('Healthcare Insurance Payment Request Item', {
	before_claims_remove: function(frm) {
		if (frm.doc.docstatus != 0) {
			frappe.throw(__('Not Allowed to delete claim after submission, please mark the claim as Payment Error / Payment Rejected'));
		}
	}
});