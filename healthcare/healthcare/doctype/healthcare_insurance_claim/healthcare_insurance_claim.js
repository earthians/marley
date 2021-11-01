// Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Healthcare Insurance Claim', {
	refresh: function(frm) {
		frm.ignore_doctypes_on_cancel_all = [frm.doc.service_doctype];

		frm.set_query('healthcare_insurance_coverage_plan', function() {
			return {
				filters: {
					'is_active': 1
				}
			};
		});

		frm.set_query('insurance_subscription', function() {
			return {
				filters: {
					'patient': frm.doc.patient,
					'docstatus': 1
				}
			};
		});

		frm.set_query('template_dt', function() {
			let service_templates = ['Appointment Type', 'Clinical Procedure Template', 'Therapy Type',
				'Medication', 'Lab Test Template', 'Healthcare Service Unit Type'];
			return {
				filters: {
					name: ['in', service_templates],
				}
			};
		});

		frm.set_query('template_dn', function() {
			if (frm.doc.template_dt != 'Appointment Type') {
				return {
					filters: { is_billable: 1 }
				};
			}
		});

		frm.set_query('item_code', function() {
			return {
				filters: {
					'is_sales_item': 1,
					'disabled': 0,
					'is_fixed_asset': 0
				}
			};
		});

		frm.set_query('patient', function() {
			return {
				filters: {
					'status': 'Active'
				}
			};
		});

		if (!frm.is_new() && frm.doc.docstatus === 0 && frm.doc.status == 'Draft') {

			frm.add_custom_button(__('Mark Approved'), () => {
				frm.set_value('status', 'Approved');
				frm.save();
			});

			frm.add_custom_button(__('Mark Rejected'), () => {
				frm.set_value('status', 'Rejected');
				frm.save();
			});

		} else if (!frm.is_new() && frm.doc.docstatus === 0 && ['Approved', 'Rejected'].includes(frm.doc.status) && frm.doc.mode_of_approval == 'Manual') {

			frm.add_custom_button(__('Mark Draft'), () => {
				frm.set_value('status', 'Draft');
				frm.save();
			});

		}

		// Allow creating coverage if claim does not link a coverage
		if (!frm.doc.coverage && frm.doc.docstatus === 1) {
			frm.add_custom_button(__('Create Coverage'), () => {
				frappe.call({
					method: 'healthcare.healthcare.doctype.healthcare_insurance_claim.healthcare_insurance_claim.create_insurance_coverage',
					args: { doc: frm.doc },
					freeze: true,
					callback: function(r) {
						var doclist = frappe.model.sync(r.message);
						frappe.set_route('Form', doclist[0].doctype, doclist[0].name);
					}
				});
			});

			frm.add_custom_button(__(frm.doc.service_doctype), () => {
				frappe.db.get_value(frm.doc.service_doctype, { 'insurance_claim': frm.doc.name }, 'name', (r) => {
					if (r && r.name) {
						frappe.set_route('Form', frm.doc.service_doctype, r.name);
					}
				});
			}, __('View'));
		}
	},

	template_dt: function(frm) {
		frm.set_value('template_dn', '');
	},

	qty: function(frm) {
		frm.trigger('calculate_claim_amount');
	},

	price_list_rate: function(frm) {
		frm.trigger('calculate_claim_amount');
	},

	discount: function(frm) {
		frm.trigger('calculate_claim_amount');
	},

	coverage: function(frm) {
		frm.trigger('calculate_claim_amount');
	},

	calculate_claim_amount: function(frm) {
		if (frm.doc.price_list_rate && frm.doc.qty) {
			// discount
			if (frm.doc.discount > 0) {
				frm.set_value('discount_amount', flt(frm.doc.price_list_rate) * flt(frm.doc.discount) * 0.01 * frm.doc.qty);
			} else {
				frm.set_value('discount_amount', 0);
			}
			// amount
			frm.set_value('amount', (flt(frm.doc.qty) * flt(frm.doc.price_list_rate)) - frm.doc.discount_amount);
		}
		// coverage amount
		if (frm.doc.amount > 0 && frm.doc.coverage > 0) {
			frm.set_value('claim_amount', flt(frm.doc.amount) * flt(frm.doc.coverage) * 0.01);
		} else {
			frm.set_value('claim_amount', 0);
		}

		// patient payable
		frm.set_value('patient_payable', flt(frm.doc.amount) - frm.doc.claim_amount);
	}
});
