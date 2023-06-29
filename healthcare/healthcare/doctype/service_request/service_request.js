// Copyright (c) 2020, earthians and contributors
// For license information, please see license.txt
// {% include "healthcare/public/js/service_request.js" %}

frappe.ui.form.on('Service Request', {
	refresh: function(frm) {
		frm.set_query('template_dt', function() {
			let order_template_doctypes = [
				"Therapy Type",
				"Lab Test Template",
				"Clinical Procedure Template",
				"Appointment Type",
				"Observation Template",
				"Healthcare Activity"];
			return {
				filters: {
					name: ['in', order_template_doctypes]
				}
			};
		});

		frm.trigger('setup_create_buttons');
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

		} else if (frm.doc.template_dt === "Appointment Type") {
			frm.add_custom_button(__("Appointment"), function() {
				frappe.route_options = {
					"patient": frm.doc.patient,
					"practitioner": frm.doc.referred_to_practitioner,
					"appointment_type": frm.doc.template_dn,
				}
				frappe.new_doc("Patient Appointment");
			}, __("Create"));

		} else if (frm.doc.template_dt === "Healthcare Activity") {
			frm.add_custom_button(__("Nursing Task"), function() {
				frappe.db.get_value("Nursing Task", {"service_request": frm.doc.name, "docstatus":["!=", 2]}, "name")
				.then(r => {
					if (Object.keys(r.message).length == 0) {
						frm.trigger('make_nursing_task');
					} else {
						if (r.message && r.message.name) {
							frappe.set_route("Form", "Nursing Task", r.message.name);
							frappe.show_alert({
								message: __(`Nursing Task is already created`),
								indicator: "info",
							});
						}
					}
				})
			}, __('Create'));

		} else if (frm.doc.template_dt === "Observation Template") {
			frm.add_custom_button(__('Observation'), function() {
				frappe.db.get_value("Sample Collection", {"service_request": frm.doc.name, "docstatus":["!=", 2]}, "name")
				.then(r => {
					if (Object.keys(r.message).length == 0) {
						frm.trigger('make_observation');
					} else {
						if (r.message && r.message.name) {
							frappe.set_route("Form", "Sample Collection", r.message.name);
							frappe.show_alert({
								message: __(`Sample Collection is already created`),
								indicator: "info",
							});
						}
					}
				})
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

	make_nursing_task: function(frm) {
		frappe.call({
			method: 'healthcare.healthcare.doctype.service_request.service_request.make_nursing_task',
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
				var doclist = frappe.model.sync(r.message);
				frappe.set_route('Form', doclist[0].doctype, doclist[0].name);
			}
		});
	},
});