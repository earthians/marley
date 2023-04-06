
frappe.ui.form.on(cur_frm.doctype, { // nosemgrep
    onload: function(frm) {
        if (frm.doc.__islocal) {
			frm.set_value('order_time', frappe.datetime.now_time())
		}
    },

    refresh: function(frm) {
		frm.set_query('order_group', function () {
			return {
				filters: {
					'docstatus': 1,
					'patient': frm.doc.patient,
					'practitioner': frm.doc.ordered_by
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

		frm.trigger('setup_status_buttons');
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
			method: 'healthcare.controllers.service_request_controller.set_request_status',
			async: false,
			freeze: true,
			args: {
				doctype: frm.doctype,
				request: frm.doc.name,
				status: status
			},
			callback: function(r) {
				if (!r.exc) frm.reload_doc();
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