// Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Insurance Claim', {
	onload: function(frm) {
		frm.set_indicator_formatter('insurance_coverage', (coverage) => {
			return {
				'Draft': 'red',
				'Submitted': 'blue',
				'Approved': 'green',
				'Error': 'orange',
				'Rejected': 'red',
				'Completed': 'green',
				'Cancelled': 'grey'
			}[coverage.status];
		});

		if (frm.is_new()) {
			frm.set_value('from_date', frappe.datetime.add_months(get_today(), -1))
		}
	},

	refresh: function(frm) {
		frm.set_query('insurance_payor', function() {
			return {
				filters: {
					'disabled': 0
				}
			};
		});

		frm.set_query('insurance_policy', function() {
			return {
				filters: {
					'patient': frm.doc.patient,
					'insurance_payor': frm.doc.insurance_payor
				}
			};
		});

		frm.fields_dict["coverages"].grid.wrapper.find('.grid-add-row').hide();
		frm.fields_dict["coverages"].grid.clear_custom_buttons();

		if (frm.doc.docstatus == 1) {
			if (frm.doc.outstanding_amount > 0) {
				frm.add_custom_button(__('Create Payment Entry'), () => {
					frm.events.make_payment_entry(frm);
				});
			}
		}

		if (frm.doc.docstatus == 1 && ['Submitted', 'Error'].includes(frm.doc.status)) {
			frm.page.set_primary_action(__('Update Claim Status'), () => {
				frm.events.update_status(frm);
			});
		}
	},

	patient: function(frm) {
		frm.set_value({
			'insurance_policy': '',
			'insurance_plan': ''
		});
	},

	insurance_policy: function(frm) {
		frm.trigger('get_insurance_coverages');
	},

	posting_date_based_on: function(frm) {
		frm.trigger('get_insurance_coverages');
	},

	from_date: function(frm) {
		frm.trigger('get_insurance_coverages');
	},

	to_date: function(frm) {
		frm.trigger('get_insurance_coverages');
	},

	insurance_payor: function(frm) {
		if (frm.doc.insurance_payor) {
			frappe.db.get_value('Insurance Payor', frm.doc.insurance_payor, 'insurance_claim_credit_days')
			.then(r => {
				frm.set_value({
					'due_date': frappe.datetime.add_days(frm.doc.posting_date, r.message.insurance_claim_credit_days)
				});
			})
		}
		frm.trigger('get_insurance_coverages');
	},

	fetch_coverages_based_on: function(frm) {
		frm.trigger('get_insurance_coverages');
	},

	get_insurance_coverages: function(frm) {
		if (frm.doc.insurance_payor && frm.doc.from_date && frm.doc.to_date && frm.doc.insurance_policy) {
			frm.clear_table('coverages');

			frappe.call({
				method: 'get_coverages',
				doc: frm.doc,
				freeze: true,
				freeze_message: __('Fetching Coverages'),
				callback: function() {
					frm.refresh_field('coverages');
					frm.trigger('set_totals');
				}
			});
		}
	},


	update_status: function(frm) {
		let coverages = frm.get_field('coverages').grid.get_selected_children();

		if (coverages.length <= 0) {
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
						options: 'Approved\nError\nRejected',
						reqd: 1,
						onchange: () => {
							if (cur_dialog.fields_dict.status.value == 'Approved') {
								cur_dialog.set_df_property('payment_error_reason', 'hidden', true);
								cur_dialog.set_df_property('payment_error_reason', 'reqd', false);
							} else {
								cur_dialog.set_df_property('payment_error_reason', 'hidden', false);
								cur_dialog.set_df_property('payment_error_reason', 'reqd', true);
							}
						}
					},
					{
						label: __('Claim Error / Reject Reason'),
						fieldname: 'payment_error_reason',
						fieldtype: 'Small Text'
					}
				],
				primary_action_label: __('Update'),
				primary_action: () => {
					let values = d.get_values();

					coverages.forEach(coverage => {
						frappe.model.set_value(coverage.doctype, coverage.name, {
							'status': values.status,
							'approved_amount': values.status == 'Approved' ? coverage.claim_amount : 0,
							'rejected_amount': values.status == 'Approved' ? 0 : coverage.claim_amount,
							'payment_error_reason': values.payment_error_reason
						});
					});
					frm.save('Update');

					d.hide();
				}
			});
			d.show();
		}
	},

	set_totals: function(frm) {
		let insurance_claim_amount = 0;
		let approved_amount = 0;
		let rejected_amount = 0;

		$.each(frm.doc.coverages || [], (_i, coverage) => {
			insurance_claim_amount += flt(coverage.claim_amount);
			approved_amount += flt(coverage.approved_amount);
			rejected_amount += flt(coverage.rejected_amount);
		});

		frm.set_value({
			'insurance_claim_amount': insurance_claim_amount,
			'approved_amount': approved_amount,
			'rejected_amount': rejected_amount,
			'outstanding_amount': approved_amount - frm.doc.paid_amount
		});

		frm.refresh_fields();
	},

	make_payment_entry: function(frm) {
		return frappe.call({
			method: 'healthcare.healthcare.doctype.insurance_claim.insurance_claim.create_payment_entry',
			args: { 'doc': frm.doc },
			callback: function(r) {
				let doc = frappe.model.sync(r.message);
				frappe.set_route('Form', doc[0].doctype, doc[0].name);
			}
		});
	},

	mode_of_payment: function(frm) {
		if (frm.doc.mode_of_payment) {
			frappe.call({
				method: 'erpnext.accounts.doctype.sales_invoice.sales_invoice.get_bank_cash_account',
				args: {
					'mode_of_payment': frm.doc.mode_of_payment,
					'company': frm.doc.company
				},
				callback: function(r) {
					frm.set_value('payment_account', r.message.account)
				}
			});
		}
	}
});

frappe.ui.form.on('Insurance Claim Coverage', {
	before_coverages_remove: function(frm) {
		if (frm.doc.docstatus != 0) {
			frappe.throw(__('Not Allowed to delete coverage after submission, please update the Coverage status instead'));
		}
	}
});
