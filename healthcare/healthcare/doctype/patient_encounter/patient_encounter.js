// Copyright (c) 2016, ESS LLP and contributors
// For license information, please see license.txt

frappe.ui.form.on('Patient Encounter', {
	onload: function(frm) {
		if (!frm.doc.__islocal && frm.doc.docstatus === 1 &&
			frm.doc.inpatient_status == 'Admission Scheduled') {
				frappe.db.get_value('Inpatient Record', frm.doc.inpatient_record,
					['admission_encounter', 'status']).then(r => {
						if (r.message) {
							if (r.message.admission_encounter == frm.doc.name &&
								r.message.status == 'Admission Scheduled') {
									frm.add_custom_button(__('Cancel Admission'), function() {
										cancel_ip_order(frm);
									});
								}
							if (r.message.status == 'Admitted') {
								frm.add_custom_button(__('Schedule Discharge'), function() {
									schedule_discharge(frm);
								});
							}
						}
				})
		}
	},

	setup: function(frm) {
		frm.get_field('therapies').grid.editable_fields = [
			{fieldname: 'therapy_type', columns: 8},
			{fieldname: 'no_of_sessions', columns: 2}
		];
		frm.get_field('drug_prescription').grid.editable_fields = [
			{fieldname: 'drug_code', columns: 2},
			{fieldname: 'drug_name', columns: 2},
			{fieldname: 'dosage', columns: 2},
			{fieldname: 'period', columns: 2},
			{fieldname: 'dosage_form', columns: 2}
		];
		if (frappe.meta.get_docfield('Drug Prescription', 'medication').in_list_view === 1) {
			frm.get_field('drug_prescription').grid.editable_fields.splice(0, 0, {fieldname: 'medication', columns: 3});
			frm.get_field('drug_prescription').grid.editable_fields.splice(2, 1); // remove item description
		}
	},

	refresh: function(frm) {
		refresh_field('drug_prescription');
		refresh_field('lab_test_prescription');

		if (!frm.doc.__islocal) {
			if (frm.doc.docstatus === 1) {
				if(!['Discharge Scheduled', 'Admission Scheduled', 'Admitted'].includes(frm.doc.inpatient_status)) {
					frm.add_custom_button(__('Schedule Admission'), function() {
						schedule_inpatient(frm);
					});
				}
			}

			frm.add_custom_button(__('Patient History'), function() {
				if (frm.doc.patient) {
					frappe.route_options = {'patient': frm.doc.patient};
					frappe.set_route('patient_history');
				} else {
					frappe.msgprint(__('Please select Patient'));
				}
			},__('View'));

			if (frm.doc.docstatus == 1 && frm.doc.drug_prescription && frm.doc.drug_prescription.length>0) {
				frm.add_custom_button(__('Medication Request'), function() {
					create_medication_request(frm);
				},__('Create'));
			}

			if (frm.doc.docstatus == 1 && (
				(frm.doc.lab_test_prescription && frm.doc.lab_test_prescription.length>0) ||
				(frm.doc.procedure_prescription && frm.doc.procedure_prescription.length>0) ||
				(frm.doc.therapies && frm.doc.therapies.length>0)
				)) {
				frm.add_custom_button(__('Service Request'), function() {
					create_service_request(frm);
				},__('Create'));
			}

			frm.add_custom_button(__('Vital Signs'), function() {
				create_vital_signs(frm);
			},__('Create'));

			frm.add_custom_button(__('Medical Record'), function() {
				create_medical_record(frm);
			},__('Create'));

			frm.add_custom_button(__('Clinical Procedure'), function() {
				create_procedure(frm);
			},__('Create'));

			frm.add_custom_button(__("Clinical Note"), function() {
				frappe.route_options = {
					"patient": frm.doc.patient,
					"reference_doc": "Patient Encounter",
					"reference_name": frm.doc.name}
						frappe.new_doc("Clinical Note");
			},__('Create'));


			if (frm.doc.drug_prescription && frm.doc.inpatient_record && frm.doc.inpatient_status === "Admitted") {
				frm.add_custom_button(__('Inpatient Medication Order'), function() {
					frappe.model.open_mapped_doc({
						method: 'healthcare.healthcare.doctype.patient_encounter.patient_encounter.make_ip_medication_order',
						frm: frm
					});
				},__('Create'));
			}

			frm.add_custom_button(__('Nursing Tasks'), function() {
				create_nursing_tasks(frm);
			},__('Create'));
		}

		frm.set_query('patient', function() {
			return {
				filters: {'status': 'Active'}
			};
		});

		frm.set_query('drug_code', 'drug_prescription', function() {
			return {
				filters: {
					is_stock_item: 1
				}
			};
		});

		frm.set_query('lab_test_code', 'lab_test_prescription', function() {
			return {
				filters: {
					is_billable: 1
				}
			};
		});

		frm.set_query('appointment', function() {
			return {
				filters: {
					//	Scheduled filter for demo ...
					status:['in',['Open','Scheduled']]
				}
			};
		});

		frm.set_query("code_value", "codification_table", function(doc, cdt, cdn) {
			let row = frappe.get_doc(cdt, cdn);
			if (row.code_system) {
				return {
					filters: {
						code_system: row.code_system
					}
				};
			}
		});

		frm.set_query("medication", "drug_prescription", function() {
			return {
				filters: {
					disabled: false
				}
			};
		})

		frm.set_df_property('patient', 'read_only', frm.doc.appointment ? 1 : 0);

		if (frm.doc.google_meet_link && frappe.datetime.now_date() <= frm.doc.encounter_date) {
			frm.dashboard.set_headline(
				__("Join video conference with {0}", [
					`<a target='_blank' href='${frm.doc.google_meet_link}'>Google Meet</a>`,
				])
			);
		}
		if (frappe.meta.get_docfield('Drug Prescription', 'medication').in_list_view === 1) {
			frm.set_query('drug_code', 'drug_prescription', function(doc, cdt, cdn) {
				let row = frappe.get_doc(cdt, cdn);
				return {
					query: 'healthcare.healthcare.doctype.patient_encounter.patient_encounter.get_medications_query',
					filters: { name: row.medication }
				};
			});
		}
		var table_list =  ["drug_prescription", "lab_test_prescription", "procedure_prescription", "therapies"]
		apply_code_sm_filter_to_child(frm, "priority", table_list, "Priority")
		apply_code_sm_filter_to_child(frm, "intent", table_list, "Intent")
		set_encounter_details(frm)
	},

	appointment: function(frm) {
		frm.events.set_appointment_fields(frm);
	},

	patient: function(frm) {
		frm.events.set_patient_info(frm);

		set_encounter_details(frm)
	},

	practitioner: function(frm) {
		if (!frm.doc.practitioner) {
			frm.set_value('practitioner_name', '');
		}
	},
	set_appointment_fields: function(frm) {
		if (frm.doc.appointment) {
			frappe.call({
				method: 'frappe.client.get',
				args: {
					doctype: 'Patient Appointment',
					name: frm.doc.appointment
				},
				callback: function(data) {
					let values = {
						'patient':data.message.patient,
						'type': data.message.appointment_type,
						'practitioner': data.message.practitioner,
						'invoiced': data.message.invoiced,
						'company': data.message.company
					};
					frm.set_value(values);
					frm.set_df_property('patient', 'read_only', 1);
				}
			});
		}
		else {
			let values = {
				'patient': '',
				'patient_name': '',
				'type': '',
				'practitioner': '',
				'invoiced': 0,
				'patient_sex': '',
				'patient_age': '',
				'inpatient_record': '',
				'inpatient_status': ''
			};
			frm.set_value(values);
			frm.set_df_property('patient', 'read_only', 0);
		}
	},

	set_patient_info: function(frm) {
		if (frm.doc.patient) {
			frappe.call({
				method: 'healthcare.healthcare.doctype.patient.patient.get_patient_detail',
				args: {
					patient: frm.doc.patient
				},
				callback: function(data) {
					let age = '';
					if (data.message.dob) {
						age = calculate_age(data.message.dob);
					}
					let values = {
						'patient_age': age,
						'patient_name':data.message.patient_name,
						'patient_sex': data.message.sex,
						'inpatient_record': data.message.inpatient_record,
						'inpatient_status': data.message.inpatient_status
					};
					frm.set_value(values);
				}
			});
		} else {
			let values = {
				'patient_age': '',
				'patient_name':'',
				'patient_sex': '',
				'inpatient_record': '',
				'inpatient_status': ''
			};
			frm.set_value(values);
		}
	},

	get_applicable_treatment_plans: function(frm) {
		frappe.call({
			method: 'get_applicable_treatment_plans',
			doc: frm.doc,
			args: {'encounter': frm.doc},
			freeze: true,
			freeze_message: __('Fetching Treatment Plans'),
			callback: function() {
				new frappe.ui.form.MultiSelectDialog({
					doctype: "Treatment Plan Template",
					target: this.cur_frm,
					setters: {
						medical_department: "",
					},
					action(selections) {
						frappe.call({
							method: 'set_treatment_plans',
							doc: frm.doc,
							args: selections,
						}).then(() => {
							frm.refresh_fields();
							frm.dirty();
						});
						cur_dialog.hide();
					}
				});


			}
		});
	},

});

var schedule_inpatient = function(frm) {
	var dialog = new frappe.ui.Dialog({
		title: 'Patient Admission',
		fields: [
			{fieldtype: 'Link', label: 'Medical Department', fieldname: 'medical_department', options: 'Medical Department', reqd: 1},
			{fieldtype: 'Link', label: 'Healthcare Practitioner (Primary)', fieldname: 'primary_practitioner', options: 'Healthcare Practitioner', reqd: 1},
			{fieldtype: 'Link', label: 'Healthcare Practitioner (Secondary)', fieldname: 'secondary_practitioner', options: 'Healthcare Practitioner'},
			{fieldtype: 'Link', label: 'Nursing Checklist Template', fieldname: 'admission_nursing_checklist_template', options: 'Nursing Checklist Template'},
			{fieldtype: 'Column Break'},
			{fieldtype: 'Date', label: 'Admission Ordered For', fieldname: 'admission_ordered_for', default: 'Today'},
			{fieldtype: 'Link', label: 'Service Unit Type', fieldname: 'service_unit_type', options: 'Healthcare Service Unit Type'},
			{fieldtype: 'Int', label: 'Expected Length of Stay', fieldname: 'expected_length_of_stay'},
			{fieldtype: 'Section Break'},
			{fieldtype: 'Long Text', label: 'Admission Instructions', fieldname: 'admission_instruction'}
		],
		primary_action_label: __('Order Admission'),
		primary_action : function() {
			var args = {
				patient: frm.doc.patient,
				admission_encounter: frm.doc.name,
				referring_practitioner: frm.doc.practitioner,
				company: frm.doc.company,
				medical_department: dialog.get_value('medical_department'),
				primary_practitioner: dialog.get_value('primary_practitioner'),
				secondary_practitioner: dialog.get_value('secondary_practitioner'),
				admission_ordered_for: dialog.get_value('admission_ordered_for'),
				admission_service_unit_type: dialog.get_value('service_unit_type'),
				expected_length_of_stay: dialog.get_value('expected_length_of_stay'),
				admission_instruction: dialog.get_value('admission_instruction'),
				admission_nursing_checklist_template: dialog.get_value('admission_nursing_checklist_template')
			}
			frappe.call({
				method: 'healthcare.healthcare.doctype.inpatient_record.inpatient_record.schedule_inpatient',
				args: {
					args: args
				},
				callback: function(data) {
					if (!data.exc) {
						frm.reload_doc();
					}
				},
				freeze: true,
				freeze_message: __('Scheduling Patient Admission')
			});
			frm.refresh_fields();
			dialog.hide();
		}
	});

	dialog.set_values({
		'medical_department': frm.doc.medical_department,
		'primary_practitioner': frm.doc.practitioner,
	});

	dialog.fields_dict['service_unit_type'].get_query = function() {
		return {
			filters: {
				'inpatient_occupancy': 1,
				'allow_appointments': 0
			}
		};
	};

	dialog.show();
	dialog.$wrapper.find('.modal-dialog').css('width', '800px');
};

var schedule_discharge = function(frm) {
	var dialog = new frappe.ui.Dialog ({
		title: 'Inpatient Discharge',
		fields: [
			{fieldtype: 'Date', label: 'Discharge Ordered Date', fieldname: 'discharge_ordered_date', default: 'Today', read_only: 1},
			{fieldtype: 'Date', label: 'Followup Date', fieldname: 'followup_date'},
			{fieldtype: 'Link', label: 'Nursing Checklist Template', options: 'Nursing Checklist Template', fieldname: 'discharge_nursing_checklist_template'},
			{fieldtype: 'Column Break'},
			{fieldtype: 'Small Text', label: 'Discharge Instructions', fieldname: 'discharge_instructions'},
			{fieldtype: 'Section Break', label:'Discharge Summary'},
			{fieldtype: 'Long Text', label: 'Discharge Note', fieldname: 'discharge_note'}
		],
		primary_action_label: __('Order Discharge'),
		primary_action : function() {
			var args = {
				patient: frm.doc.patient,
				discharge_encounter: frm.doc.name,
				discharge_practitioner: frm.doc.practitioner,
				discharge_ordered_date: dialog.get_value('discharge_ordered_date'),
				followup_date: dialog.get_value('followup_date'),
				discharge_instructions: dialog.get_value('discharge_instructions'),
				discharge_note: dialog.get_value('discharge_note'),
				discharge_nursing_checklist_template: dialog.get_value('discharge_nursing_checklist_template')
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

let create_medical_record = function(frm) {
	if (!frm.doc.patient) {
		frappe.throw(__('Please select patient'));
	}
	frappe.route_options = {
		'patient': frm.doc.patient,
		'status': 'Open',
		'reference_doctype': 'Patient Medical Record',
		'reference_owner': frm.doc.owner
	};
	frappe.new_doc('Patient Medical Record');
};

let create_vital_signs = function(frm) {
	if (!frm.doc.patient) {
		frappe.throw(__('Please select patient'));
	}
	frappe.route_options = {
		'patient': frm.doc.patient,
		'encounter': frm.doc.name,
		'company': frm.doc.company
	};
	frappe.new_doc('Vital Signs');
};

let create_procedure = function(frm) {
	if (!frm.doc.patient) {
		frappe.throw(__('Please select patient'));
	}
	frappe.route_options = {
		'patient': frm.doc.patient,
		'medical_department': frm.doc.medical_department,
		'company': frm.doc.company
	};
	frappe.new_doc('Clinical Procedure');
};

let create_nursing_tasks = function(frm) {
	const d = new frappe.ui.Dialog({

		title: __('Create Nursing Tasks'),

		fields: [
			{
				label: __('Nursing Checklist Template'),
				fieldtype: 'Link',
				options: 'Nursing Checklist Template',
				fieldname: 'template',
				reqd: 1,
			},
			{
				label: __('Start Time'),
				fieldtype: 'Datetime',
				fieldname: 'start_time',
				default: frappe.datetime.now_datetime(),
				reqd: 1,
			},
		],

		primary_action_label: __('Create Nursing Tasks'),

		primary_action: () => {

			let values = d.get_values();
			frappe.call({
				method: 'healthcare.healthcare.doctype.nursing_task.nursing_task.create_nursing_tasks_from_template',
				args: {
					'template': values.template,
					'doc': frm.doc,
					'start_time': values.start_time
				},
				callback: (r) => {
					if (r && !r.exc) {
						frappe.show_alert({
							message: __('Nursing Tasks Created'),
							indicator: 'success'
						});
					}
				}
			});

			d.hide();		frm.set_query('lab_test_code', 'lab_test_prescription', function() {
				return {
					filters: {
						is_billable: 1
					}
				};
			});
		}
	});

	d.show();
};

let calculate_age = function(birth) {
	let ageMS = Date.parse(Date()) - Date.parse(birth);
	let age = new Date();
	age.setTime(ageMS);
	let years =  age.getFullYear() - 1970;
	return `${years} ${__('Years(s)')} ${age.getMonth()} ${__('Month(s)')} ${age.getDate()} ${__('Day(s)')}`;
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
				inpatient_record: frm.doc.inpatient_record,
				reason: data.reason_for_cancellation,
				encounter: frm.doc.name
			},
			callback: function(r) {
				if (!r.exc) {
					frm.reload_doc();
				}
			}
		});
	}, __('Reason for Cancellation'), __('Submit'));
}

let create_service_request = function(frm) {
	frappe.call({
		method: "healthcare.healthcare.doctype.patient_encounter.patient_encounter.create_service_request",
		freeze: true,
		args: {
			encounter: frm.doc.name
		},
		callback: function(r) {
			if (r && !r.exc) {
				frm.reload_doc();
				frappe.show_alert({
					message: __('Service Request(s) Created'),
					indicator: 'success'
				});
			}
		}
	});
};

let create_medication_request = function(frm) {
	frappe.call({
		method: "healthcare.healthcare.doctype.patient_encounter.patient_encounter.create_medication_request",
		freeze: true,
		args: {
			encounter: frm.doc.name
		},
		callback: function(r) {
			if (r && !r.exc) {
				frm.reload_doc();
				frappe.show_alert({
					message: __('Medicaiton Request(s) Created'),
					indicator: 'success'
				});
			}
		}
	});
};


frappe.ui.form.on('Drug Prescription', {
	dosage: function(frm, cdt, cdn){
		frappe.model.set_value(cdt, cdn, 'update_schedule', 1);
		let child = locals[cdt][cdn];
		if (child.dosage) {
			frappe.model.set_value(cdt, cdn, 'interval_uom', 'Day');
			frappe.model.set_value(cdt, cdn, 'interval', 1);
		}
	},

	period: function(frm, cdt, cdn) {
		frappe.model.set_value(cdt, cdn, 'update_schedule', 1);
	},

	interval_uom: function(frm, cdt, cdn) {
		frappe.model.set_value(cdt, cdn, 'update_schedule', 1);
		let child = locals[cdt][cdn];
		if (child.interval_uom == 'Hour') {
			frappe.model.set_value(cdt, cdn, 'dosage', null);
		}
	},

	medication:function(frm, cdt, cdn) {
		// to set drug_code(item) if Medication Item table have only one item
		let child = locals[cdt][cdn];
		if (!child.medication) {
			return;
		}

		frappe.call({
			method: "healthcare.healthcare.doctype.patient_encounter.patient_encounter.get_medications",
			freeze: true,
			args: {
				medication: child.medication
			},
			callback: function(r) {
				if (r && !r.exc && r.message) {
					let data = r.message
					if (data.length == 1) {
						if (data[0].item) {
							frappe.model.set_value(cdt, cdn, 'drug_code', data[0].item);
						}
					} else {
						frappe.model.set_value(cdt, cdn, 'drug_code', "");
					}
				}
			}
		});
	}
});


var apply_code_sm_filter_to_child = function(frm, field, table_list, code_system) {
	table_list.forEach(function(table) {
		frm.set_query(field, table, function() {
			return {
				filters: {
					code_system: code_system
				}
			};
		});
	});
};

var set_encounter_details = function(frm) {
	if (frm.doc.docstatus == 0 && frm.doc.patient) {
		frappe.call({
			method: "healthcare.healthcare.doctype.patient_encounter.patient_encounter.get_encounter_details",
			freeze: true,
			args: {
				patient: frm.doc.patient
			},
			callback: function(r) {
				if (r && !r.exc) {
					if (r.message[0].length || r.message[1].length) {
						var encounter_details = `
							<div class="encounter_details">
							<style>
								.encounter_details {
										background-color:#f4f5f6;
									float:left;
									padding-left: 5px;
									padding-right: 5px;
									border: 1px solid rgb(228, 223, 223);
									min-height: 200px;
								}
								@media (min-width: 1200px) {
									.encounter_details {
											min-width: 900px;
										}
									}
								.encounter-cards {
									background-color: rgb(255, 255, 255);
									cursor:pointer;
									border: 1px solid rgb(228, 223, 223);
									box-shadow: 0px 1px 2px rgba(25, 39, 52, 0.05), 0px 0px 4px rgba(25, 39, 52, 0.1);
									margin: 7px;
									min-height: 115px;
									height: fit-content;
									border-radius: 5px;
								}
								.card-body {
									font-size:11px;
								}
								.card-head {
									padding-left:20px;
									padding-top:5px;
									width: 80%;
									font-size:15px;
									float:left;
									height: fit-content;
								}
								.enc-cell {
									padding-left:15px;
								}
								.lab-result {
									font-size:10px;
									padding-left:60px;
									padding-right:60px;
								}
								</style>
								`
							if (r.message[0] && r.message[0].length > 0) {
								encounter_details += `
									<span style="color:#646566;">Medication Requests</span>`
										r.message[0].forEach(function(element) {
											encounter_details += `
												<div class="page-card encounter-cards" id="card">
													<div class="colo-sm-12">
														<div class="card-head colo-sm-10"><b>${element.medication}</b>
														</div>
														<div class="colo-sm-2" style="float:right; padding-right:10px; padding-top:10px;">
														<button data-toggle="dropdown" aria-haspopup="true" aria-expanded="true" class="btn btn-xs btn-secondary">
															${element.status}
															</button>
															<ul class="dropdown-menu dropdown-menu-right" style="position: absolute; will-change: transform; top: 0px; left: 0px; transform: translate3d(-172px, 26px, 0px);" x-placement="bottom-end">`
																	if (element.status == "Active") {
																			encounter_details += `<li><a class="dropdown-item" data-action="on-hold" onclick="medication_status_change('On Hold', '${element.name}', 'Medication Request')">On Hold</a></li>`
																	} else if (element.status == "On Hold") {
																			encounter_details += `<li><a class="dropdown-item" data-action="active" onclick="medication_status_change('Active', '${element.name}', 'Medication Request')">Active</a></li>`
																	}
																	if (element.docstatus == 1) {
																			encounter_details += `<li><a class="dropdown-item" data-action="active" onclick="medication_status_change('Cancel', '${element.name}', 'Medication Request')">Cancel</a></li>`
																	} else if (element.docstatus == 2) {
																			encounter_details += `<li><a class="dropdown-item" data-action="revoke" onclick="medication_status_change('Revoked', '${element.name}', 'Medication Request')">Revoked</a></li>`
																			encounter_details += `<li><a class="dropdown-item" data-action="replace" onclick="medication_status_change('Replaced', '${element.name}', 'Medication Request')">Replaced</a></li>`
																			encounter_details += `<li><a class="dropdown-item" data-action="entered_in_error" onclick="medication_status_change('Entered in Error', '${element.name}', 'Medication Request')">Entered in Error</a></li>`
																			encounter_details += `<li><a class="dropdown-item" data-action="unknown" onclick="medication_status_change('Unknown', '${element.name}', 'Medication Request')">Unknown</a></li>`
																	}
															encounter_details += `</ul>
														</div>
														<div class="card-body colo-sm-12">
															<div class="card-body colo-sm-12" style="float:left">
																<table>
																	<tr>
																		<td>Status:</td>
																		<td><b>${element.status?element.status:""}</b></td>
																		<td class="enc-cell">Order Date:</td>
																		<td><b>${element.order_date?frappe.format(element.order_date, { fieldtype: 'Date' }):""}</b></td>
																		<td class="enc-cell">Ordered By:</td>
																		<td><b>${element.practitioner_name?element.practitioner_name:""}</b></td>
																		<td class="enc-cell">Billing Status:</td>
																		<td><b>${element.billing_status?element.billing_status:""}</b></td>
																	</tr>
																	<tr>
																		<td>Quantity:</td>
																		<td class="enc-cell"><b>${element.quantity?element.quantity:""}</b></td>
																		<td class="enc-cell">Order Time:</td>
																		<td><b>${element.order_time?element.order_time:""}</b></td>
																		<td class="enc-cell">Period:</td>
																		<td><b>${element.period?element.period:""}</b></td>
																		<td class="enc-cell">Dosage Form:</td>
																		<td><b>${element.dosage_form?element.dosage_form:""}</b></td>
																	</tr>
																</table>
															</div>
														</div>
													</div>
												</div>`
										})
							}

							if (r.message[1] && r.message[1].length > 0) {
								encounter_details += `
									<span style="color:#646566;">Service Requests</span>`
									r.message[1].forEach(function(element) {
										encounter_details += `
											<div class="page-card encounter-cards" id="card">
												<div class="colo-sm-12">
													<div class="card-head colo-sm-10"><b>${element.template_dn}</b><span style="color:#dedfe0;"><span>
													</div>
													<div class="colo-sm-2" style="float:right; padding-right:10px; padding-top:10px;">
														<button data-toggle="dropdown" aria-haspopup="true" aria-expanded="true" class="btn btn-xs btn-secondary">
																${element.status}
														</button>
														<ul class="dropdown-menu dropdown-menu-right" style="position: absolute; will-change: transform; top: 0px; left: 0px; transform: translate3d(-172px, 26px, 0px);" x-placement="bottom-end">`
																if (element.status == "Active") {
																		encounter_details += `<li><a class="dropdown-item" data-action="on-hold" onclick="medication_status_change('On Hold', '${element.name}', 'Service Request')">On Hold</a></li>`
																} else if (element.status == "On Hold") {
																		encounter_details += `<li><a class="dropdown-item" data-action="active" onclick="medication_status_change('Active', '${element.name}', 'Service Request')">Active</a></li>`
																}
																if (element.docstatus == 1) {
																		encounter_details += `<li><a class="dropdown-item" data-action="active" onclick="medication_status_change('Cancel', '${element.name}', 'Service Request')">Cancel</a></li>`
																} else if (element.docstatus == 2) {
																		encounter_details += `<li><a class="dropdown-item" data-action="revoke" onclick="medication_status_change('Revoked', '${element.name}', 'Service Request')">Revoked</a></li>`
																		encounter_details += `<li><a class="dropdown-item" data-action="replace" onclick="medication_status_change('Replaced', '${element.name}', 'Service Request')">Replaced</a></li>`
																		encounter_details += `<li><a class="dropdown-item" data-action="entered_in_error" onclick="medication_status_change('Entered in Error', '${element.name}', 'Service Request')">Entered in Error</a></li>`
																		encounter_details += `<li><a class="dropdown-item" data-action="unknown" onclick="medication_status_change('Unknown', '${element.name}', 'Service Request')">Unknown</a></li>`
																}
																	encounter_details += `
														</ul>
													</div>
													<div class="card-body colo-sm-12">
														<div class="card-body colo-sm-12">
															<table>
																<tr>
																	<td>Status:</td>
																	<td><b>${element.status?element.status:""}</b></td>
																	<td class="enc-cell">Order Date:</td>
																	<td><b>${element.order_date?frappe.format(element.order_date, { fieldtype: 'Date' }):""}</b></td>
																	<td class="enc-cell">Ordered By:</td>
																	<td><b>${element.practitioner_name?element.practitioner_name:""}</b></td>
																	<td class="enc-cell">Billing Status:</td>
																	<td><b>${element.billing_status?element.billing_status:""}</b></td>
																</tr>
																<tr>
																	<td>Quantity:</td>
																	<td class="enc-cell"><b>${element.quantity?element.quantity:""}</b></td>
																	<td class="enc-cell">Order Time:</td>
																	<td><b>${element.order_time?element.order_time:""}</b></td>
																	<td class="enc-cell">Order Type:</td>
																	<td><b>${element.template_dt?element.template_dt:""}</b></td>
																	`
																	if (element.referred_to_practitioner) {
																		encounter_details += `
																			</tr><tr>
																				<td>Referred To:</td>
																				<td><b>${element.referred_to_practitioner?element.referred_to_practitioner:""}</b></td>
																				</tr>
																			`
																	} else {
																		encounter_details += `</tr>`
																	}
																		encounter_details += `
															</table>
														</div>`
													if (element.lab_details) {
														encounter_details += `
															<div class="colo-sm-12 lab-result">
																${element.lab_details}
															</div>`
													}
												encounter_details += `
											</div>
										</div>
										</div>`
									})
							}

							if (r.message[2] && r.message[2].length > 0) {
								encounter_details += `
									<span style="color:#646566;">Clinical Notes</span>`
									r.message[2].forEach(function(element) {
										encounter_details += `
											<div class="page-card encounter-cards" id="card">
												<div class="colo-sm-12">
													<div class="card-body colo-sm-12">
														<div class="card-body colo-sm-12">
															<table>
																<tr>
																	<td>Date:</td>
																	<td><b>${element.posting_date?`${element.posting_date.slice(0, element.posting_date.lastIndexOf(":"))}`:""}</b></td>
																</tr>
															</table>
															<span class="colo-sm-10" style="font-size:10px; padding-left:10px;">
																${element.note?element.note:""}
															</span>
														</div>`
												encounter_details += `
											</div>
										</div>
										</div>`
									})
							}



							encounter_details += `<script>
								function medication_status_change(status, request, doctype) {
									if (status == 'Cancel') {
										frappe.call({
											method: "healthcare.healthcare.doctype.patient_encounter.patient_encounter.cancel_request",
												freeze: true,
												args: {
													doctype: doctype,
													request: request
												},
										})
									} else {
										frappe.call({
											method: "healthcare.healthcare.doctype.patient_encounter.patient_encounter.set_service_request_status",
											freeze: true,
											args: {
													doctype: doctype,
													request: request,
													status: status,
													encounter: "${frm.doc.name}",
											},
											callback: function(r) {
													if (r && !r.exc) {
															}
											}
										})
									}
								}
							</script>
						</div>`
						frm.fields_dict.encounter_details.html(encounter_details);
					} else {
						frm.fields_dict.encounter_details.html("");
					}
				}
			}
		})
	}
}
