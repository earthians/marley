// Copyright (c) 2020, earthians and contributors
// For license information, please see license.txt

frappe.ui.form.on('Service Request', {
	onload: function(frm) {
		if (frm.doc.__islocal) {
			frm.set_value('order_time', frappe.datetime.now_time())
		}
	},

	refresh: function(frm) {
		if (!frm.is_new() && !frm.doc.insurance_policy && frm.doc.billing_status == 'Pending') {
			frm.add_custom_button(__("Create Insurance Coverage"), function() {
				var d = new frappe.ui.Dialog({
					title: __("Select Insurance Policy"),
					fields: [
						{
							'fieldname': 'Patient Insurance Policy',
							'fieldtype': 'Link',
							'label': __('Patient Insurance Policy'),
							'options': 'Patient Insurance Policy',
							"get_query": function () {
								return {
									filters: {
										'patient': frm.doc.patient,
										'docstatus': 1
									}
								};
							},
							'reqd': 1
						}
					],
				});
				d.set_primary_action(__('Create'), function() {
					d.hide();
					var data = d.get_values();
					frm.set_value('insurance_policy', data['Patient Insurance Policy'])
					frm.save("Update")
				});
				d.show();
			});
		}
		frm.set_query('order_group', function () {
			return {
				filters: {
					'docstatus': 1,
					'patient': frm.doc.patient,
					'practitioner': frm.doc.ordered_by
				}
			};
		});

		frm.set_query('template_dt', function() {
			let order_template_doctypes = ['Medication', 'Therapy Type', 'Lab Test Template',
				'Clinical Procedure Template'];
			return {
				filters: {
					name: ['in', order_template_doctypes]
				}
			};
		});

		frm.set_query('patient', function () {
			return {
				filters: {
					'status': 'Active'
				}
			};
		});

		frm.set_query('staff_role', function () {
			return {
				filters: {
					'restrict_to_domain': 'Healthcare'
				}
			};
		});

		frm.set_query('insurance_policy', function() {
			return {
				filters: {
					'patient': frm.doc.patient,
					'docstatus': 1
				}
			};
		});

		frm.trigger('setup_status_buttons');
		frm.trigger('setup_create_buttons');
	},

	setup_status_buttons: function(frm) {
		if (frm.doc.docstatus === 1) {

			if (frm.doc.status === 'Active') {
				frm.add_custom_button(__('On Hold'), function() {
					frm.events.set_status(frm, 'On Hold');
				}, __('Status'));

				// frm.add_custom_button(__('Completed'), function() {
				// 	frm.events.set_status(frm, 'Completed');
				// }, __('Status'));
			}

			if (frm.doc.status === 'On Hold') {
				frm.add_custom_button(__('Active'), function() {
					frm.events.set_status(frm, 'Active');
				}, __('Status'));

				// frm.add_custom_button(__('Completed'), function() {
				// 	frm.events.set_status(frm, 'Completed');
				// }, __('Status'));
			}

		} else if (frm.doc.docstatus === 2) {

			frm.add_custom_button(__('Revoked'), function() {
				frm.events.set_status(frm, 'Revoked');
			}, __('Status'));

			frm.add_custom_button(__('Replaced'), function() {
				frm.events.set_status(frm, 'Replaced');
			}, __('Status'));

			frm.add_custom_button(__('Entered in Error'), function() {
				frm.events.set_status(frm, 'Entered in Error');
			}, __('Status'));

			frm.add_custom_button(__('Unknown'), function() {
				frm.events.set_status(frm, 'Unknown');
			}, __('Status'));

		}
	},

	set_status: function(frm, status) {
		frappe.call({
			method: 'healthcare.healthcare.doctype.service_request.service_request.set_service_request_status',
			async: false,
			freeze: true,
			args: {
				service_request: frm.doc.name,
				status: status
			},
			callback: function(r) {
				if (!r.exc) frm.reload_doc();
			}
		});
	},

	setup_create_buttons: function(frm) {
		if (frm.doc.docstatus !== 1 || frm.doc.status === 'Completed') return;

		if (frm.doc.template_dt === 'Clinical Procedure Template') {

			frm.add_custom_button(__('Clinical Procedure'), function() {
				frm.trigger('make_clinical_procedure');
			}, __('Create'));


		} else if (frm.doc.template_dt === 'Lab Test Template') {

			frm.add_custom_button(__('Lab Test'), function() {
				frm.trigger('make_lab_test');
			}, __('Create'));

		} else if (frm.doc.template_dt === 'Therapy Type') {

			frm.add_custom_button(__('Therapy Session'), function() {
				frm.trigger('make_therapy_session');
			}, __('Create'));
		}

		frm.page.set_inner_btn_group_as_primary(__('Create'));
	},

	make_clinical_procedure: function(frm) {
		frappe.call({
			method: 'healthcare.healthcare.doctype.service_request.service_request.make_clinical_procedure',
			args: { service_request: frm.doc },
			freeze: true,
			callback: function(r) {
				var doclist = frappe.model.sync(r.message);
				frappe.set_route('Form', doclist[0].doctype, doclist[0].name);
			}
		});
	},

	make_lab_test: function(frm) {
		frappe.call({
			method: 'healthcare.healthcare.doctype.service_request.service_request.make_lab_test',
			args: { service_request: frm.doc },
			freeze: true,
			callback: function(r) {
				var doclist = frappe.model.sync(r.message);
				frappe.set_route('Form', doclist[0].doctype, doclist[0].name);
			}
		});
	},

	make_therapy_session: function(frm) {
		frappe.call({
			method: 'healthcare.healthcare.doctype.service_request.service_request.make_therapy_session',
			args: { service_request: frm.doc },
			freeze: true,
			callback: function(r) {
				var doclist = frappe.model.sync(r.message);
				frappe.set_route('Form', doclist[0].doctype, doclist[0].name);
			}
		});
	},

	after_cancel: function(frm) {
		frappe.prompt([
			{
				fieldname: 'reason_for_cancellation',
				label: __('Reason for Cancellation'),
				fieldtype: 'Select',
				options: ['Revoked', 'Replaced', 'Entered in Error', 'Unknown'],
				reqd: 1
			}
		],
		function(data) {
			frm.events.set_status(frm, data.reason_for_cancellation);
		}, __('Reason for Cancellation'), __('Submit'));
	},

	patient: function(frm) {
		if (!frm.doc.patient) {
			frm.set_values ({
				'patient_name': '',
				'gender': '',
				'patient_age': '',
				'mobile': '',
				'email': '',
				'inpatient_record': '',
				'inpatient_status': '',
			});
		}
	},

	birth_date: function(frm) {
		let age_str = calculate_age(frm.doc.birth_date);
		frm.set_value('patient_age', age_str);
	}
});


let calculate_age = function(birth) {
	let ageMS = Date.parse(Date()) - Date.parse(birth);
	let age = new Date();
	age.setTime(ageMS);
	let years =  age.getFullYear() - 1970;
	return `${years} ${__('Years(s)')} ${age.getMonth()} ${__('Month(s)')} ${age.getDate()} ${__('Day(s)')}`;
};
