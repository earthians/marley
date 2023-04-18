// Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Inpatient Record', {
	setup: function(frm) {
		frm.get_field('drug_prescription').grid.editable_fields = [
			{fieldname: 'drug_code', columns: 2},
			{fieldname: 'drug_name', columns: 2},
			{fieldname: 'dosage', columns: 2},
			{fieldname: 'period', columns: 2},
			{fieldname: 'dosage_form', columns: 2}
		];
	},
	refresh: function(frm) {
		frm.set_query('admission_service_unit_type', function() {
			return {
				filters: {
					'inpatient_occupancy': 1,
					'allow_appointments': 0
				}
			};
		});

		frm.set_query('primary_practitioner', function() {
			return {
				filters: {
					'department': frm.doc.medical_department
				}
			};
		});
		if (!frm.doc.__islocal) {
			if (frm.doc.status == 'Admitted') {
				frm.add_custom_button(__('Schedule Discharge'), function() {
					schedule_discharge(frm);
				});
			} else if (frm.doc.status == 'Admission Scheduled') {
				frm.add_custom_button(__('Cancel Admission'), function() {
					cancel_ip_order(frm)
				})
				frm.add_custom_button(__('Admit'), function() {
					admit_patient_dialog(frm);
				} );
			} else if (frm.doc.status == 'Discharge Scheduled') {
				frm.add_custom_button(__('Discharge'), function() {
					discharge_patient(frm);
				} );
			}
		}
	},
	btn_transfer: function(frm) {
		transfer_patient_dialog(frm);
	}
});

let discharge_patient = function(frm) {
	frappe.call({
		doc: frm.doc,
		method: 'discharge',
		callback: function(data) {
			if (!data.exc) {
				frm.reload_doc();
			}
		},
		freeze: true,
		freeze_message: __('Processing Inpatient Discharge')
	});
};

let admit_patient_dialog = function(frm) {
	let dialog = new frappe.ui.Dialog({
		title: 'Admit Patient',
		width: 100,
		fields: [
			{fieldtype: 'Link', label: 'Service Unit Type', fieldname: 'service_unit_type',
				options: 'Healthcare Service Unit Type', default: frm.doc.admission_service_unit_type
			},
			{fieldtype: 'Link', label: 'Service Unit', fieldname: 'service_unit',
				options: 'Healthcare Service Unit', reqd: 1
			},
			{fieldtype: 'Datetime', label: 'Admission Datetime', fieldname: 'check_in',
				reqd: 1, default: frappe.datetime.now_datetime()
			},
			{fieldtype: 'Date', label: 'Expected Discharge', fieldname: 'expected_discharge',
				default: frm.doc.expected_length_of_stay ? frappe.datetime.add_days(frappe.datetime.now_datetime(), frm.doc.expected_length_of_stay) : ''
			}
		],
		primary_action_label: __('Admit'),
		primary_action : function(){
			let service_unit = dialog.get_value('service_unit');
			let check_in = dialog.get_value('check_in');
			let expected_discharge = null;
			if (dialog.get_value('expected_discharge')) {
				expected_discharge = dialog.get_value('expected_discharge');
			}
			if (!service_unit && !check_in) {
				return;
			}
			frappe.call({
				doc: frm.doc,
				method: 'admit',
				args:{
					'service_unit': service_unit,
					'check_in': check_in,
					'expected_discharge': expected_discharge
				},
				callback: function(data) {
					if (!data.exc) {
						frm.reload_doc();
					}
				},
				freeze: true,
				freeze_message: __('Processing Patient Admission')
			});
			frm.refresh_fields();
			dialog.hide();
		}
	});

	dialog.fields_dict['service_unit_type'].get_query = function() {
		return {
			filters: {
				'inpatient_occupancy': 1,
				'allow_appointments': 0
			}
		};
	};
	dialog.fields_dict['service_unit'].get_query = function() {
		return {
			filters: {
				'is_group': 0,
				'company': frm.doc.company,
				'service_unit_type': dialog.get_value('service_unit_type'),
				'occupancy_status' : 'Vacant'
			}
		};
	};

	dialog.show();
};

let transfer_patient_dialog = function(frm) {
	let dialog = new frappe.ui.Dialog({
		title: 'Transfer Patient',
		width: 100,
		fields: [
			{fieldtype: 'Link', label: 'Leave From', fieldname: 'leave_from', options: 'Healthcare Service Unit', reqd: 1, read_only:1},
			{fieldtype: 'Link', label: 'Service Unit Type', fieldname: 'service_unit_type', options: 'Healthcare Service Unit Type'},
			{fieldtype: 'Link', label: 'Transfer To', fieldname: 'service_unit', options: 'Healthcare Service Unit', reqd: 1},
			{fieldtype: 'Datetime', label: 'Check In', fieldname: 'check_in', reqd: 1, default: frappe.datetime.now_datetime()}
		],
		primary_action_label: __('Transfer'),
		primary_action : function() {
			let service_unit = null;
			let check_in = dialog.get_value('check_in');
			let leave_from = null;
			if(dialog.get_value('leave_from')){
				leave_from = dialog.get_value('leave_from');
			}
			if(dialog.get_value('service_unit')){
				service_unit = dialog.get_value('service_unit');
			}
			if(check_in > frappe.datetime.now_datetime()){
				frappe.msgprint({
					title: __('Not Allowed'),
					message: __('Check-in time cannot be greater than the current time'),
					indicator: 'red'
				});
				return;
			}
			frappe.call({
				doc: frm.doc,
				method: 'transfer',
				args:{
					'service_unit': service_unit,
					'check_in': check_in,
					'leave_from': leave_from
				},
				callback: function(data) {
					if (!data.exc) {
						frm.reload_doc();
					}
				},
				freeze: true,
				freeze_message: __('Process Transfer')
			});
			frm.refresh_fields();
			dialog.hide();
		}
	});

	dialog.fields_dict['leave_from'].get_query = function(){
		return {
			query : 'healthcare.healthcare.doctype.inpatient_record.inpatient_record.get_leave_from',
			filters: {docname:frm.doc.name}
		};
	};
	dialog.fields_dict['service_unit_type'].get_query = function(){
		return {
			filters: {
				'inpatient_occupancy': 1,
				'allow_appointments': 0
			}
		};
	};
	dialog.fields_dict['service_unit'].get_query = function(){
		return {
			filters: {
				'is_group': 0,
				'service_unit_type': dialog.get_value('service_unit_type'),
				'occupancy_status' : 'Vacant'
			}
		};
	};

	dialog.show();

	let not_left_service_unit = null;
	for (let inpatient_occupancy in frm.doc.inpatient_occupancies) {
		if (frm.doc.inpatient_occupancies[inpatient_occupancy].left != 1) {
			not_left_service_unit = frm.doc.inpatient_occupancies[inpatient_occupancy].service_unit;
		}
	}
	dialog.set_values({
		'leave_from': not_left_service_unit
	});
};

var schedule_discharge = function(frm) {
	var dialog = new frappe.ui.Dialog ({
		title: 'Inpatient Discharge',
		fields: [
			{
				fieldtype: 'Link',
				label: 'Discharge Practitioner',
				fieldname: 'discharge_practitioner',
				options: 'Healthcare Practitioner'
			},
			{
				fieldtype: 'Datetime',
				label: 'Discharge Ordered DateTime',
				fieldname: 'discharge_ordered_datetime',
				default: frappe.datetime.now_datetime()
			},
			{
				fieldtype: 'Date',
				label: 'Followup Date',
				fieldname: 'followup_date'
			},
			{
				fieldtype: 'Column Break'
			},
			{
				fieldtype: 'Small Text',
				label: 'Discharge Instructions',
				fieldname: 'discharge_instructions'
			},
			{
				fieldtype: 'Section Break',
				label:'Discharge Summary'
			},
			{
				fieldtype: 'Long Text',
				label: 'Discharge Note',
				fieldname: 'discharge_note'
			}
		],
		primary_action_label: __('Order Discharge'),
		primary_action : function() {
			var args = {
				patient: frm.doc.patient,
				discharge_practitioner: dialog.get_value('discharge_practitioner'),
				discharge_ordered_datetime: dialog.get_value('discharge_ordered_datetime'),
				followup_date: dialog.get_value('followup_date'),
				discharge_instructions: dialog.get_value('discharge_instructions'),
				discharge_note: dialog.get_value('discharge_note')
			}
			frappe.call ({
				method: 'healthcare.healthcare.doctype.inpatient_record.inpatient_record.schedule_discharge',
				args: {args},
				callback: function(data) {
					if(!data.exc){
						frm.reload_doc();
					}
				},
				freeze: true,
				freeze_message: 'Scheduling Inpatient Discharge'
			});
			frm.refresh_fields();
			dialog.hide();
		}
	});

	dialog.show();
	dialog.$wrapper.find('.modal-dialog').css('width', '800px');
};

let cancel_ip_order = function(frm) {
	frappe.prompt([
		{
			fieldname: 'reason_for_cancellation',
			label: __('Reason for Cancellation'),
			fieldtype: 'Small Text',
			reqd: 1
		}
	],
	function(data) {
		frappe.call({
			method: 'healthcare.healthcare.doctype.inpatient_record.inpatient_record.set_ip_order_cancelled',
			async: false,
			freeze: true,
			args: {
				inpatient_record: frm.doc.name,
				reason: data.reason_for_cancellation
			},
			callback: function(r) {
				if (!r.exc) frm.reload_doc();
			}
		});
	}, __('Reason for Cancellation'), __('Submit'));
}
