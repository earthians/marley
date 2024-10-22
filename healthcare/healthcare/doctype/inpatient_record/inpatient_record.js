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

		frm.set_indicator_formatter("service_unit", (doc) => {
			if (doc.left == 0){
			  return "green";
			}
		});
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

		frm.set_query('price_list', function() {
			return {
				filters: {
					"currency": frm.doc.currency
				}
			};
		});

		frm.set_query('warehouse', function() {
			return {
				filters: {
					'company': frm.doc.company
				}
			};
		});

		if (!frm.doc.__islocal) {
			if (frm.doc.status == 'Admitted') {
				frm.add_custom_button(__('Schedule Discharge'), function() {
					frappe.run_serially([
						()=>schedule_discharge(frm),
						()=>generate_billables(frm),
					]);
				});
				frm.add_custom_button(__("Normal"), function() {
					transfer_patient_dialog(frm);
				},__('Transfer'));
				frm.add_custom_button(__("Generate Billables"), function() {
					generate_billables(frm);
				});
				if (!frm.doc.inpatient_occupancies.some(
					e => e.transferred_for_procedure == 1 && e.left != 1)) {
						frm.add_custom_button(__("For Procedure"), function() {
							transfer_for_procedure_dialog(frm);
						},__('Transfer'));
				}
			} else if (frm.doc.status == 'Admission Scheduled') {
				frm.add_custom_button(__('Cancel Admission'), function() {
					cancel_ip_order(frm)
				})
				frm.add_custom_button(__('Admit'), function() {
					admit_patient_dialog(frm);
				} );
			} else if (frm.doc.status == 'Discharge Scheduled') {
				frappe.db.get_value('Discharge Summary', {'docstatus': ["<", 2], 'inpatient_record': frm.doc.name}, 'name')
				.then(r => {
					if (!r.message.name) {
						frm.add_custom_button(__("Discharge Summary"), function() {
							make_discharge_summary(frm);
						}, "Create");
					}
				})
				frm.add_custom_button(__('Discharge'), function() {
					frappe.db.get_value('Discharge Summary', {'docstatus': 1, 'inpatient_record': frm.doc.name}, 'name')
					.then(r => {
						if (r.message.name) {
								discharge_patient(frm);
						} else {
							frappe.msgprint({
								title: __("Discharge Summary Required"),
								message: __("Discharge Summary is Required to Discharge"),
								indicator: 'red'
							});
						}
					})
				});
			}

			if (!["Discharge Scheduled", "Cancelled", "Discharged"].includes(frm.doc.status)) {
				frm.add_custom_button(__("Treatment Counselling"), function() {
					create_cancel_treatment_counselling(frm);
				}, "Create");
			}
		}

		frm.add_custom_button(__("Clinical Note"), function() {
			frappe.route_options = {
				"patient": frm.doc.patient,
				"reference_doc": "Inpatient Record",
				"reference_name": frm.doc.name}
					frappe.new_doc("Clinical Note");
		},__('Create'));
	},

	onload: function(frm) {
		frm.get_field("inpatient_occupancies").grid.cannot_add_rows = true;
	},

	btn_transfer: function(frm) {
		transfer_patient_dialog(frm);
	}
});

let make_discharge_summary = function(frm) {
	frappe.model.open_mapped_doc({
		method: "healthcare.healthcare.doctype.inpatient_record.inpatient_record.make_discharge_summary",
		frm: frm
	})
};


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
			{fieldtype: 'Section Break', fieldname: 'sb1'
			},
			{fieldtype: 'Link', label: 'Currency', fieldname: 'currency',
				options: 'Currency', reqd: 1
			},
			{fieldtype: 'Column Break', fieldname: 'cb1'
			},
			{fieldtype: 'Link', label: 'Price List', fieldname: 'price_list',
				options: 'Price List', reqd: 1,
				"get_query": function () {
					return {
						filters: [
							["Price List", "currency", "=", dialog.get_value("currency")]
						]
					};
				},
			},
			{fieldtype: 'Section Break', fieldname: 'sb2'
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
					"service_unit": service_unit,
					"check_in": check_in,
					"expected_discharge": expected_discharge,
					"currency": dialog.get_value('currency'),
					"price_list": dialog.get_value('price_list')
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
	frappe.db.get_value("Patient", frm.doc.patient, ["default_currency", "default_price_list"])
		.then(r => {
			let values = r.message;
			dialog.set_value("currency", values.default_currency)
			dialog.set_value("price_list", values.default_price_list)
		})

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

	let transferred_for_procedure = frm.doc.inpatient_occupancies.some(
		e => e.transferred_for_procedure == 1 && e.left != 1)
	let not_left_service_unit = null;
	let leave_to_service_unit = null;
	if (transferred_for_procedure) {
		var field = dialog.get_field("leave_from");
		field.df.read_only = 0;
		field.refresh();
		for (let inpatient_occupancy in frm.doc.inpatient_occupancies) {
			if (frm.doc.inpatient_occupancies[inpatient_occupancy].transferred_for_procedure == 1
				&& frm.doc.inpatient_occupancies[inpatient_occupancy].left != 1) {
				not_left_service_unit = frm.doc.inpatient_occupancies[inpatient_occupancy].service_unit;
			}
			if (frm.doc.inpatient_occupancies[inpatient_occupancy].transferred_for_procedure == 0
				&&frm.doc.inpatient_occupancies[inpatient_occupancy].left != 1) {
				leave_to_service_unit = frm.doc.inpatient_occupancies[inpatient_occupancy].service_unit;
			}
		}
	} else {
		var field = dialog.get_field("leave_from");
		field.df.read_only = 1;
		field.refresh();
		for (let inpatient_occupancy in frm.doc.inpatient_occupancies) {
			if (frm.doc.inpatient_occupancies[inpatient_occupancy].left != 1) {
				not_left_service_unit = frm.doc.inpatient_occupancies[inpatient_occupancy].service_unit;
			}
		}
	}

	dialog.set_values({
		'leave_from': not_left_service_unit
	});
	if (leave_to_service_unit) {
		dialog.set_values({
			'service_unit': leave_to_service_unit
		});
	}
};


let transfer_for_procedure_dialog = function(frm) {
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
					'txred': 1
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
				'allow_appointments': 0,
				'is_ot': 1
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

var create_cancel_treatment_counselling = function(frm) {
	var dialog = new frappe.ui.Dialog({
		title: "Patient Admission",
		fields: [
			{fieldtype: "Link", label: "Treatment Plan Template", fieldname: "treatment_plan_template", options: "Treatment Plan Template"},
		],
		primary_action_label: __("Create Treatment Counselling"),
		primary_action : function() {
			var args = {
				patient: frm.doc.patient,
				inpatient_record: frm.doc.name,
				admission_encounter: frm.doc.admission_encounter,
				referring_practitioner: frm.doc.practitioner,
				company: frm.doc.company,
				medical_department: frm.doc.medical_department,
				primary_practitioner: frm.doc.primary_practitioner,
				secondary_practitioner: frm.doc.secondary_practitioner,
				admission_ordered_for: frm.doc.admission_ordered_for,
				admission_service_unit_type: frm.doc.service_unit_type,
				treatment_plan_template: dialog.get_value("treatment_plan_template"),
				expected_length_of_stay: frm.doc.expected_length_of_stay,
				admission_instruction: frm.doc.admission_instruction,
				admission_nursing_checklist_template: frm.doc.admission_nursing_checklist_template,
			}
			frappe.db.get_value("Treatment Counselling", {
				"status": "Active",
				"admission_encounter": frm.doc.admission_encounter,
				"docstatus": 1,
				"name": ["!=", frm.doc.name],
				}, "name")
				.then(r => {
					let values = r.message;
					if (values.name) {
						frappe.confirm(`Treatment Counselling already exist<br>
						Proceed to Cancel?`,
							() => {
								frappe.call({
								method: "healthcare.healthcare.doctype.inpatient_record.inpatient_record.cancel_amend_treatment_counselling",
									args: {
										args: args,
										treatment_counselling: values.name
									},
									callback: function(data) {
										if (!data.exc) {
											frm.reload_doc();
										}
									}
								})
							})
					} else {
						create_treatment_counselling(frm, args)
					}
			})
			frm.refresh_fields();
			dialog.hide();
		}
	});


	dialog.fields_dict["treatment_plan_template"].get_query = function() {
		return {
			filters: {
				"treatment_counselling_required_for_ip": 1,
			}
		};
	};

	dialog.show();
	dialog.$wrapper.find(".modal-dialog").css("width", "800px");
};

var create_treatment_counselling = function(frm, args) {
	frappe.call({
		method: "healthcare.healthcare.doctype.inpatient_record.inpatient_record.create_treatment_counselling",
		args: {
			ip_order: args
		},
		freeze: true,
		freeze_message: __("Creating Treatment Counselling"),
		callback: function(data) {
			if (!data.exc) {
				frm.reload_doc();
			}
		},
	});
}

var generate_billables = function(frm) {
	frappe.call({
		doc: frm.doc,
		method: 'add_service_unit_rent_to_billable_items',
		callback: function() {
			frm.refresh();
		}
	})
}