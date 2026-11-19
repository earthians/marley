// Copyright (c) 2020, earthians and contributors
// For license information, please see license.txt
// {% include "healthcare/public/js/service_request.js" %}

frappe.ui.form.on('Service Request', {
	refresh: function(frm) {
		frm.set_query('template_dt', function() {
			// Keep in sync with healthcare.api.common.get_service_request_template_types()
			let order_template_doctypes = [
				"Therapy Type",
				"Lab Test Template",
				"Clinical Procedure Template",
				"Appointment Type",
				"Observation Template",
				"Healthcare Activity",
				"Healthcare Service Template"
			];
			return {
				filters: {
					name: ['in', order_template_doctypes]
				}
			};
		});

		frm.set_query("status", function () {
			return {
				"filters": {
					"code_system": "Request Status",
				}
			};
		});

		frm.trigger('setup_create_buttons');
		frm.trigger('setup_cascade_delete_button');
	},

	setup_cascade_delete_button: function(frm) {
		if (frm.is_new() || frm.doc.docstatus === 2) {
			return;
		}
		frm.add_custom_button(__('Delete with Linked Docs'), function() {
			frm.trigger('cascade_delete_service_request');
		}, __('Actions')).addClass('btn-danger');
	},

	cascade_delete_service_request: function(frm) {
		frappe.call({
			method: 'healthcare.api.service_request.preview_cascade_delete_service_request',
			args: { name: frm.doc.name },
			freeze: true,
			freeze_message: __('Checking linked documents...'),
			callback: function(r) {
				const data = r.message || {};
				const message = (data.message || '').replace(/\n/g, '<br>');
				frappe.confirm(
					message,
					function() {
						frappe.call({
							method: 'healthcare.api.service_request.cascade_delete_service_request',
							args: { name: frm.doc.name },
							freeze: true,
							freeze_message: __('Deleting Service Request and linked documents...'),
							callback: function(res) {
								const result = res.message || {};
								frappe.show_alert({
									message: __('Deleted {0}').format(frm.doc.name),
									indicator: 'green',
								});
								if (result.deleted_lab_tests && result.deleted_lab_tests.length) {
									frappe.show_alert({
										message: __('Removed {0} Lab Test(s)').format(result.deleted_lab_tests.length),
										indicator: 'green',
									});
								}
								frappe.set_route('List', 'Service Request');
							},
						});
					}
				);
			},
		});
	},

	setup_create_buttons: function(frm) {
		if (frm.doc.docstatus !== 1 || frm.doc.status === 'Completed') return;

		if (frm.doc.template_dt === 'Clinical Procedure Template') {

			frm.add_custom_button(__('Clinical Procedure'), function() {
				frappe.db.get_value("Clinical Procedure", {"service_request": frm.doc.name, "docstatus":["!=", 2]}, "name")
				.then(r => {
					if (Object.keys(r.message).length == 0) {
						frm.trigger('make_clinical_procedure');
					} else {
						if (r.message && r.message.name) {
							frappe.set_route("Form", "Clinical Procedure", r.message.name);
							frappe.show_alert({
								message: __(`Clinical Procedure is already created`),
								indicator: "info",
							});
						}
					}
				})
			}, __('Create'));


		} else if (frm.doc.template_dt === 'Lab Test Template') {
			// Booked Lab: patient accepted cost → forward to lab and reflect approved amount on visit
			if (frm.doc.patient_accepted_cost && !frm.doc.booked) {
				frm.add_custom_button(__('Booked Lab'), function() {
					frm.trigger('book_lab_and_forward');
				}, __('Actions')).addClass('btn-primary');
			}
			frm.add_custom_button(__('Lab Test'), function() {
				frappe.db.get_value("Lab Test", {"service_request": frm.doc.name, "docstatus":["!=", 2]}, "name")
				.then(r => {
					if (Object.keys(r.message).length == 0) {
						frm.trigger('make_lab_test');
					} else {
						if (r.message && r.message.name) {
							frappe.set_route("Form", "Lab Test", r.message.name);
							frappe.show_alert({
								message: __(`Lab Test is already created`),
								indicator: "info",
							});
						}
					}
				})
			}, __('Create'));


		} else if (frm.doc.template_dt === 'Therapy Type') {
			frm.add_custom_button(__("Therapy Session"), function() {
				frappe.db.get_value("Therapy Session", {"service_request": frm.doc.name, "docstatus":["!=", 2]}, "name")
				.then(r => {
					if (Object.keys(r.message).length == 0) {
						frm.trigger('make_therapy_session');
					} else {
						if (r.message && r.message.name) {
							frappe.set_route("Form", "Therapy Session", r.message.name);
							frappe.show_alert({
								message: __(`Therapy Session is already created`),
								indicator: "info",
							});
						}
					}
				})
			}, __('Create'));

		} else if (frm.doc.template_dt === "Observation Template") {
			frm.add_custom_button(__('Observation'), function() {
				frm.trigger('make_observation');
			}, __('Create'));

		} else if (frm.doc.template_dt === "Appointment Type") {
			frm.add_custom_button(__("Appointment"), function () {
				frappe.db.get_value("Patient Appointment", { service_request: frm.doc.name, status: ["!=", "Cancelled"] }, "name")
					.then(r => {
						if (Object.keys(r.message).length == 0) {
							frappe.model.open_mapped_doc({
								method: "healthcare.healthcare.doctype.service_request.service_request.make_appointment",
								frm: frm,
							});
						} else {
							if (r.message && r.message.name) {
								frappe.set_route("Form", "Patient Appointment", r.message.name);
								frappe.show_alert({
									message: __("Patient Appointment is already created"),
									indicator: "info",
								});
							}
						}
					})
			}, __("Create"));
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

	book_lab_and_forward: function(frm) {
		frappe.confirm(
			__('Forward this lab request to the laboratory and add the approved amount to the patient visit?'),
			function() {
				frappe.call({
					method: 'healthcare.healthcare.doctype.service_request.service_request.book_lab_and_forward',
					args: { service_request_name: frm.doc.name },
					freeze: true,
					callback: function(r) {
						if (r.message && r.message.lab_test) {
							frm.reload_doc();
							frappe.show_alert({ message: __('Forwarded to laboratory'), indicator: 'green' });
							frappe.set_route('Form', 'Lab Test', r.message.lab_test);
						}
					}
				});
			}
		);
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

	make_observation: function(frm) {
		frappe.call({
			method: 'healthcare.healthcare.doctype.service_request.service_request.make_observation',
			args: { service_request: frm.doc },
			freeze: true,
			callback: function(r) {
				if (r.message) {
					var title = "";
					var indicator =  "info";
					if (r.message[2]) {
						title = `${r.message[0]} is already created`
					} else {
						title = `${r.message[0]} is created`
						indicator = "green"
					}
					frappe.show_alert({
						message: __("{0}", [title]),
						indicator: indicator,
					});
					frappe.set_route('Form', r.message[1], r.message[0]);
				}
			}
		});
	},
});