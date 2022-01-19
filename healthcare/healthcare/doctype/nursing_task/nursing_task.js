// Copyright (c) 2021, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on('Nursing Task', {

	onload: function(frm) {

		const task_document_field = frm.get_docfield("task_document_name");
		task_document_field.get_route_options_for_new_doc = () => {
			if (frm.is_new()) return;
			return {
				'company': frm.doc.company,
				'medical_department': frm.doc.medical_department,
				'service_unit': frm.doc.service_unit,
				'patient': frm.doc.patient,
			};
		};

		if (frm.doc.task_doctype) {
			// set description
			frm.set_df_property('task_document_name', 'description',
				`Create and link a new ${frm.doc.task_doctype} document to complete this task`);

			// set filters
			let filters = {};
			frappe.model.with_doctype(frm.doc.task_doctype, function() {
				if (frappe.meta.has_field(frm.doc.task_doctype, 'patient')) {
					filters['patient'] = frm.doc.patient;
				}

				frm.set_query('task_document_name', () => {
					return {
						filters: filters
					}
				});
			});
		}
	},

	refresh: function(frm) {

		// TODO: handle routing back to nursing task form
		// frm.trigger('show_form_route_button');

		if (frm.is_new()) {
			frm.set_value('status', 'Draft');
		}

		let status_list = ['Accepted', 'Received', 'Rejected',
			'Ready', 'Failed', 'Entered in Error', 'On Hold'];
		if (status_list.includes(frm.doc.status) || frm.doc.status == 'Requested') {

			// set primary action to start
			frm.page.set_primary_action(__('Start'), () => {
				frm.events.update_status(frm, 'In Progress');
			});

			// optionally allow updating other statuses
			status_list.filter(status => status != frm.doc.status).forEach(status => {

				frm.add_custom_button(__(`${status}`), () => {
					frm.events.update_status(frm, `${status}`);
				}, __('Update Status'));

			});
		}

		if (frm.doc.status == 'In Progress') {
			frm.page.set_primary_action(__('Complete'), () => {
				if (frm.doc.task_doctype){
					frm.set_df_property('task_document_name', 'reqd', 1);
				}
				frm.events.update_status(frm, 'Completed');
			});

			frm.add_custom_button(__('Hold'), () => {
				frm.set_df_property('task_document_name', 'reqd', 0);
				frm.events.update_status(frm, 'On Hold');
			});
		}
	},

	update_status(frm, status) {

		frm.set_value('status', status);
		frm.save('Update');
		frm.reload_doc();

	},

	show_form_route_button: function(frm) {

		// add custom button to route to new Task DocType form
		if (!frm.is_new() && !frm.is_dirty() && frm.doc.task_doctype) {

			frm.add_custom_button(__(`New ${frm.doc.task_doctype}`), () => {
				frappe.route_options = {
					'patient': frm.doc.patient,
					'medical_department': frm.doc.medical_department,
					'company': frm.doc.company,
					'service_unit': frm.doc.service_unit,
				};

				frappe.new_doc(frm.doc.task_doctype);
			});

		}
	}
});
