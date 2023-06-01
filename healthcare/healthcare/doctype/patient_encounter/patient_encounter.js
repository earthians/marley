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
		show_clinical_notes(frm);
		show_orders(frm);
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
					"reference_name": frm.doc.name,
					"practitioner": frm.doc.practitioner
				}
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
	},

	appointment: function(frm) {
		frm.events.set_appointment_fields(frm);
	},

	patient: function(frm) {
		frm.events.set_patient_info(frm);
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

	set_patient_info: async function(frm) {
		if (frm.doc.patient) {
			let me = frm
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

					frappe.run_serially([
						()=>frm.set_value(values),
						()=>show_clinical_notes(frm),
						()=>show_orders(frm),
					]);
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

var show_clinical_notes = async function(frm) {
	if (frm.doc.docstatus == 0 && frm.doc.patient) {
		const clinical_notes = new healthcare.ClinicalNotes({
			frm: frm,
			notes_wrapper: $(frm.fields_dict.clinical_notes.wrapper),
		});
		clinical_notes.refresh();
	}
}

var show_orders = async function(frm) {
	if (frm.doc.docstatus == 0 && frm.doc.patient) {
		const orders = new healthcare.Orders({
			frm: frm,
			open_activities_wrapper: $(frm.fields_dict.order_history_html.wrapper),
			form_wrapper: $(frm.wrapper),
			create_orders: true,
		});
		orders.refresh();
	}
}
