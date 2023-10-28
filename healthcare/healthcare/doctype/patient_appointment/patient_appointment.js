// Copyright (c) 2016, ESS LLP and contributors
// For license information, please see license.txt
frappe.provide('erpnext.queries');
frappe.ui.form.on('Patient Appointment', {
	setup: function(frm) {
		frm.custom_make_buttons = {
			'Vital Signs': 'Vital Signs',
			'Patient Encounter': 'Patient Encounter'
		};
	},

	onload: function(frm) {
		if (frm.is_new()) {
			frm.set_value('appointment_time', null);
			frm.disable_save();
		}
	},

	refresh: function(frm) {
		frm.set_query('patient', function() {
			return {
				filters: { 'status': 'Active' }
			};
		});

		frm.set_query('practitioner', function() {
			if (frm.doc.department) {
				return {
					filters: {
						'department': frm.doc.department
					}
				};
			}
		});

		frm.set_query('service_unit', function() {
			return {
				query: 'healthcare.controllers.queries.get_healthcare_service_units',
				filters: {
					company: frm.doc.company,
					inpatient_record: frm.doc.inpatient_record,
					allow_appointments: 1,
				}
			};
		});

		frm.set_query('therapy_plan', function() {
			return {
				filters: {
					'patient': frm.doc.patient
				}
			};
		});

		frm.set_query('service_request', function() {
			return {
				filters: {
					'patient': frm.doc.patient,
					'status': 'Active',
					'docstatus': 1,
					'template_dt': ['in', ['Clinical Procedure', 'Therapy Type']]
				}
			};
		});

		frm.trigger('set_therapy_type_filter');

		if (frm.is_new()) {
			frm.page.clear_primary_action();
			if (frm.doc.appointment_for) {
				frm.trigger('appointment_for');
			}
		} else {
			frm.page.set_primary_action(__('Save'), () => frm.save());
		}

		if (frm.doc.patient) {
			frm.add_custom_button(__('Patient History'), function() {
				frappe.route_options = { 'patient': frm.doc.patient };
				frappe.set_route('patient_history');
			}, __('View'));
		}

		if (["Open", "Checked In"].includes(frm.doc.status) || (frm.doc.status == 'Scheduled' && !frm.doc.__islocal)) {
			frm.add_custom_button(__('Cancel'), function() {
				update_status(frm, 'Cancelled');
			});
			frm.add_custom_button(__('Reschedule'), function() {
				check_and_set_availability(frm);
			});

			if (frm.doc.procedure_template) {
				frm.add_custom_button(__('Clinical Procedure'), function() {
					frappe.model.open_mapped_doc({
						method: 'healthcare.healthcare.doctype.clinical_procedure.clinical_procedure.make_procedure',
						frm: frm,
					});
				}, __('Create'));
			} else if (frm.doc.therapy_type) {
				frm.add_custom_button(__('Therapy Session'), function() {
					frappe.model.open_mapped_doc({
						method: 'healthcare.healthcare.doctype.therapy_session.therapy_session.create_therapy_session',
						frm: frm,
					})
				}, 'Create');
			} else {
				frm.add_custom_button(__('Patient Encounter'), function() {
					frappe.model.open_mapped_doc({
						method: 'healthcare.healthcare.doctype.patient_appointment.patient_appointment.make_encounter',
						frm: frm,
					});
				}, __('Create'));
			}

			frm.add_custom_button(__('Vital Signs'), function() {
				create_vital_signs(frm);
			}, __('Create'));
		}

		if (!frm.doc.__islocal && frm.doc.status=="Open" && frm.doc.appointment_based_on_check_in) {
			frm.add_custom_button(__('Check In'), () => {
				frm.set_value("status", "Checked In");
				frm.save();
			});
		}

		frm.trigger("make_invoice_button");
	},

	make_invoice_button: function (frm) {
		// add button to invoice when show_payment_popup enabled
		if (!frm.is_new() && !frm.doc.invoiced && frm.doc.status != "Cancelled") {
			frappe.db.get_single_value("Healthcare Settings", "show_payment_popup").then(async val => {
				let fee_validity = (await frappe.call(
					"healthcare.healthcare.doctype.fee_validity.fee_validity.get_fee_validity",
					{ "appointment_name": frm.doc.name, "date": frm.doc.appointment_date , "ignore_status": true })).message;

				if (val && !fee_validity.length) {
					frm.add_custom_button(__("Make Payment"), function () {
						make_payment(frm, val);
					});
				}
			});
        }
	},

	appointment_for: function(frm) {
		if (frm.doc.appointment_for == 'Practitioner') {
			if (!frm.doc.practitioner) {
				frm.set_value('department', '');
			}
			frm.set_value('service_unit', '');
			frm.trigger('set_check_availability_action');
		} else if (frm.doc.appointment_for == 'Service Unit') {
			frm.set_value({
				'practitioner': '',
				'practitioner_name': '',
				'department': '',
			});
			frm.trigger('set_book_action');
		} else if (frm.doc.appointment_for == 'Department') {
			frm.set_value({
				'practitioner': '',
				'practitioner_name': '',
				'service_unit': '',
			});
			frm.trigger('set_book_action');
		} else {
			if (frm.doc.appointment_for == 'Department') {
				frm.set_value('service_unit', '');
			}
			frm.set_value({
				'practitioner': '',
				'practitioner_name': '',
				'department': '',
				'service_unit': '',
			});
			frm.page.clear_primary_action();
		}
	},

	set_book_action: function(frm) {
		frm.page.set_primary_action(__('Book'), async function() {
			frm.enable_save();
			await frm.save();
			if (!frm.is_new()) {
				await frappe.db.get_single_value("Healthcare Settings", "show_payment_popup").then(val => {
					frappe.call({
						method: "healthcare.healthcare.doctype.fee_validity.fee_validity.check_fee_validity",
						args: { "appointment": frm.doc },
						callback: (r) => {
							if (val && !r.message && !frm.doc.invoiced) {
								make_payment(frm, val);
							}
						}
					});
				});
			}
		});
	},

	set_check_availability_action: function(frm) {
		frm.page.set_primary_action(__('Check Availability'), function() {
			if (!frm.doc.patient) {
				frappe.msgprint({
					title: __('Not Allowed'),
					message: __('Please select Patient first'),
					indicator: 'red'
				});
			} else {
				check_and_set_availability(frm);
			}
		});
	},

	patient: function(frm) {
		if (frm.doc.patient) {
			frm.trigger('toggle_payment_fields');
			frm.trigger('appointment_for');
			frappe.call({
				method: 'frappe.client.get',
				args: {
					doctype: 'Patient',
					name: frm.doc.patient
				},
				callback: function(data) {
					let age = null;
					if (data.message.dob) {
						age = calculate_age(data.message.dob);
					}
					frappe.model.set_value(frm.doctype, frm.docname, 'patient_age', age);
				}
			});
		} else {
			frm.set_value('patient_name', '');
			frm.set_value('patient_sex', '');
			frm.set_value('patient_age', '');
			frm.set_value('inpatient_record', '');
		}
	},

	practitioner: function(frm) {
		if (frm.doc.practitioner) {
			frm.events.set_payment_details(frm);
		}
	},

	appointment_type: function(frm) {
		if (frm.doc.appointment_type) {
			if (frm.doc.appointment_for && frm.doc[frappe.scrub(frm.doc.appointment_for)]) {
				frm.events.set_payment_details(frm);
			}
		}
	},

	department: function(frm) {
		if (frm.doc.department && frm.doc.appointment_for == 'Department') {
			frm.events.set_payment_details(frm);
		}
	},

	service_unit: function(frm) {
		if (frm.doc.service_unit && frm.doc.appointment_for == 'Service Unit') {
			frm.events.set_payment_details(frm);
		}
	},

	set_payment_details: function(frm) {
		frappe.db.get_single_value('Healthcare Settings', 'show_payment_popup').then(val => {
			if (val) {
				frappe.call({
					method: 'healthcare.healthcare.utils.get_appointment_billing_item_and_rate',
					args: {
						doc: frm.doc
					},
					callback: function(data) {
						if (data.message) {
							frappe.model.set_value(frm.doctype, frm.docname, 'paid_amount', data.message.practitioner_charge);
							frappe.model.set_value(frm.doctype, frm.docname, 'billing_item', data.message.service_item);
						}
					}
				});
			}
		});
	},

	therapy_plan: function(frm) {
		frm.trigger('set_therapy_type_filter');
	},

	set_therapy_type_filter: function(frm) {
		if (frm.doc.therapy_plan) {
			frm.call('get_therapy_types').then(r => {
				frm.set_query('therapy_type', function() {
					return {
						filters: {
							'name': ['in', r.message]
						}
					};
				});
			});
		}
	},

	therapy_type: function(frm) {
		if (frm.doc.therapy_type) {
			frappe.db.get_value('Therapy Type', frm.doc.therapy_type, 'default_duration', (r) => {
				if (r.default_duration) {
					frm.set_value('duration', r.default_duration)
				}
			});
		}
	},

	get_procedure_from_encounter: function(frm) {
		get_prescribed_procedure(frm);
	},

	toggle_payment_fields: function(frm) {
		frappe.call({
			method: 'healthcare.healthcare.doctype.patient_appointment.patient_appointment.check_payment_reqd',
			args: { 'patient': frm.doc.patient },
			callback: function(data) {
				if (data.message.fee_validity) {
					// if fee validity exists and show payment popup is enabled,
					// show payment fields as non-mandatory
					frm.toggle_display('mode_of_payment', 0);
					frm.toggle_display('paid_amount', 0);
					frm.toggle_display('billing_item', 0);
					frm.toggle_reqd('paid_amount', 0);
					frm.toggle_reqd('billing_item', 0);
				} else if (data.message) {
					frm.toggle_display('mode_of_payment', 1);
					frm.toggle_display('paid_amount', 1);
					frm.toggle_display('billing_item', 1);
					frm.toggle_reqd('paid_amount', 1);
					frm.toggle_reqd('billing_item', 1);
				} else {
					// if show payment popup is disabled, hide fields
					frm.toggle_display('mode_of_payment', data.message ? 1 : 0);
					frm.toggle_display('paid_amount', data.message ? 1 : 0);
					frm.toggle_display('billing_item', data.message ? 1 : 0);
					frm.toggle_reqd('paid_amount', data.message ? 1 : 0);
					frm.toggle_reqd('billing_item', data.message ? 1 : 0);
				}
			}
		});
	},

	get_prescribed_therapies: function(frm) {
		if (frm.doc.patient) {
			frappe.call({
				method: "healthcare.healthcare.doctype.patient_appointment.patient_appointment.get_prescribed_therapies",
				args: { patient: frm.doc.patient },
				callback: function(r) {
					if (r.message) {
						show_therapy_types(frm, r.message);
					} else {
						frappe.msgprint({
							title: __('Not Therapies Prescribed'),
							message: __('There are no Therapies prescribed for Patient {0}', [frm.doc.patient.bold()]),
							indicator: 'blue'
						});
					}
				}
			});
		}
	}
});

let check_and_set_availability = function(frm) {
	let selected_slot = null;
	let service_unit = null;
	let duration = null;
	let add_video_conferencing = null;
	let overlap_appointments = null;
	let appointment_based_on_check_in = false;

	show_availability();

	function show_empty_state(practitioner, appointment_date) {
		frappe.msgprint({
			title: __('Not Available'),
			message: __('Healthcare Practitioner {0} not available on {1}', [practitioner.bold(), appointment_date.bold()]),
			indicator: 'red'
		});
	}

	function show_availability() {
		let selected_practitioner = '';
		let d = new frappe.ui.Dialog({
			title: __('Available slots'),
			fields: [
				{ fieldtype: 'Link', options: 'Medical Department', reqd: 1, fieldname: 'department', label: 'Medical Department' },
				{ fieldtype: 'Column Break' },
				{ fieldtype: 'Link', options: 'Healthcare Practitioner', reqd: 1, fieldname: 'practitioner', label: 'Healthcare Practitioner' },
				{ fieldtype: 'Column Break' },
				{ fieldtype: 'Date', reqd: 1, fieldname: 'appointment_date', label: 'Date', min_date: new Date(frappe.datetime.get_today()) },
				{ fieldtype: 'Section Break' },
				{ fieldtype: 'HTML', fieldname: 'available_slots' },
			],
			primary_action_label: __('Book'),
			primary_action: async function() {
				frm.set_value('appointment_time', selected_slot);
				add_video_conferencing = add_video_conferencing && !d.$wrapper.find(".opt-out-check").is(":checked")
					&& !overlap_appointments

				frm.set_value('add_video_conferencing', add_video_conferencing);
				if (!frm.doc.duration) {
					frm.set_value('duration', duration);
				}
				let practitioner = frm.doc.practitioner;

				frm.set_value('practitioner', d.get_value('practitioner'));
				frm.set_value('department', d.get_value('department'));
				frm.set_value('appointment_date', d.get_value('appointment_date'));
				frm.set_value('appointment_based_on_check_in', appointment_based_on_check_in)

				if (service_unit) {
					frm.set_value('service_unit', service_unit);
				}

				d.hide();
				frm.enable_save();
				await frm.save();
				if (!frm.is_new() && (!practitioner || practitioner == d.get_value('practitioner'))) {
					await frappe.db.get_single_value("Healthcare Settings", "show_payment_popup").then(val => {
						frappe.call({
							method: "healthcare.healthcare.doctype.fee_validity.fee_validity.check_fee_validity",
							args: { "appointment": frm.doc },
							callback: (r) => {
								if (val && !r.message && !frm.doc.invoiced) {
									make_payment(frm, val);
								} else {
									frappe.call({
										method: "healthcare.healthcare.doctype.patient_appointment.patient_appointment.update_fee_validity",
										args: { "appointment": frm.doc }
									});
								}
							}
						});
					});
				}
				d.get_primary_btn().attr('disabled', true);
			}
		});

		d.set_values({
			'department': frm.doc.department,
			'practitioner': frm.doc.practitioner,
			'appointment_date': frm.doc.appointment_date,
		});

		let selected_department = frm.doc.department;

		d.fields_dict['department'].df.onchange = () => {
			if (selected_department != d.get_value('department')) {
				d.set_values({
					'practitioner': ''
				});
				selected_department = d.get_value('department');
			}
			if (d.get_value('department')) {
				d.fields_dict.practitioner.get_query = function() {
					return {
						filters: {
							'department': selected_department
						}
					};
				};
			}
		};

		// disable dialog action initially
		d.get_primary_btn().attr('disabled', true);

		// Field Change Handler

		let fd = d.fields_dict;

		d.fields_dict['appointment_date'].df.onchange = () => {
			show_slots(d, fd);
		};
		d.fields_dict['practitioner'].df.onchange = () => {
			if (d.get_value('practitioner') && d.get_value('practitioner') != selected_practitioner) {
				selected_practitioner = d.get_value('practitioner');
				show_slots(d, fd);
			}
		};

		d.show();
	}

	function show_slots(d, fd) {
		if (d.get_value('appointment_date') && d.get_value('practitioner')) {
			fd.available_slots.html('');
			frappe.call({
				method: 'healthcare.healthcare.doctype.patient_appointment.patient_appointment.get_availability_data',
				args: {
					practitioner: d.get_value('practitioner'),
					date: d.get_value('appointment_date'),
					appointment: frm.doc
				},
				callback: (r) => {
					let data = r.message;
					if (data.slot_details.length > 0) {
						let $wrapper = d.fields_dict.available_slots.$wrapper;

						// make buttons for each slot
						let slot_html = get_slots(data.slot_details, data.fee_validity, d.get_value('appointment_date'));

						$wrapper
							.css('margin-bottom', 0)
							.addClass('text-center')
							.html(slot_html);

						// highlight button when clicked
						$wrapper.on('click', 'button', function() {
							let $btn = $(this);
							$wrapper.find('button').removeClass('btn-outline-primary');
							$btn.addClass('btn-outline-primary');
							selected_slot = $btn.attr('data-name');
							service_unit = $btn.attr('data-service-unit');
							appointment_based_on_check_in = $btn.attr('data-day-appointment');
							duration = $btn.attr('data-duration');
							add_video_conferencing = parseInt($btn.attr('data-tele-conf'));
							overlap_appointments = parseInt($btn.attr('data-overlap-appointments'));
							// show option to opt out of tele conferencing
							if ($btn.attr('data-tele-conf') == 1) {
								if (d.$wrapper.find(".opt-out-conf-div").length) {
									d.$wrapper.find(".opt-out-conf-div").show();
								} else {
									overlap_appointments ?
										d.footer.prepend(
											`<div class="opt-out-conf-div ellipsis text-muted" style="vertical-align:text-bottom;">
												<label>
													<span class="label-area">
													${__("Video Conferencing disabled for group consultations")}
													</span>
												</label>
											</div>`
										)
									:
										d.footer.prepend(
											`<div class="opt-out-conf-div ellipsis" style="vertical-align:text-bottom;">
											<label>
												<input type="checkbox" class="opt-out-check"/>
												<span class="label-area">
												${__("Do not add Video Conferencing")}
												</span>
											</label>
										</div>`
										);
								}
							} else {
								d.$wrapper.find(".opt-out-conf-div").hide();
							}

							// enable primary action 'Book'
							d.get_primary_btn().attr('disabled', null);
						});

					} else {
						//	fd.available_slots.html('Please select a valid date.'.bold())
						show_empty_state(d.get_value('practitioner'), d.get_value('appointment_date'));
					}
				},
				freeze: true,
				freeze_message: __('Fetching Schedule...')
			});
		} else {
			fd.available_slots.html(__('Appointment date and Healthcare Practitioner are Mandatory').bold());
		}
	}

	function get_slots(slot_details, fee_validity, appointment_date) {
		let slot_html = '';
		let appointment_count = 0;
		let disabled = false;
		let start_str, slot_start_time, slot_end_time, interval, count, count_class, tool_tip, available_slots;

		slot_details.forEach((slot_info) => {
			slot_html += `<div class="slot-info">`;
			if (fee_validity && fee_validity != 'Disabled') {
				slot_html += `
					<span style="color:green">
					${__('Patient has fee validity till')} <b>${moment(fee_validity.valid_till).format('DD-MM-YYYY')}</b>
					</span><br>`;
			} else if (fee_validity != 'Disabled') {
				slot_html += `
					<span style="color:red">
					${__('Patient has no fee validity')}
					</span><br>`;
			}

			slot_html += `
				<span><b>
				${__('Practitioner Schedule: ')} </b> ${slot_info.slot_name}
					${slot_info.tele_conf && !slot_info.allow_overlap ? '<i class="fa fa-video-camera fa-1x" aria-hidden="true"></i>' : ''}
				</span><br>
				<span><b> ${__('Service Unit: ')} </b> ${slot_info.service_unit}</span>`;
				if (slot_info.service_unit_capacity) {
					slot_html += `<br><span> <b> ${__('Maximum Capacity:')} </b> ${slot_info.service_unit_capacity} </span>`;
				}

				slot_html += '</div><br>';

				slot_html += slot_info.avail_slot.map(slot => {
						appointment_count = 0;
						disabled = false;
						count_class = tool_tip = '';
						start_str = slot.from_time;
						slot_start_time = moment(slot.from_time, 'HH:mm:ss');
						slot_end_time = moment(slot.to_time, 'HH:mm:ss');
						interval = (slot_end_time - slot_start_time) / 60000 | 0;

						// restrict past slots based on the current time.
						let now = moment();
						let booked_moment = ""
						if((now.format("YYYY-MM-DD") == appointment_date) && (slot_start_time.isBefore(now) && !slot.maximum_appointments)){
							disabled = true;
						} else {
							// iterate in all booked appointments, update the start time and duration
							slot_info.appointments.forEach((booked) => {
								booked_moment = moment(booked.appointment_time, 'HH:mm:ss');
								let end_time = booked_moment.clone().add(booked.duration, 'minutes');

								// to get apointment count for all day appointments
								if (slot.maximum_appointments) {
									if (booked.appointment_date == appointment_date) {
										appointment_count++;
									}
								}
								// Deal with 0 duration appointments
								if (booked_moment.isSame(slot_start_time) || booked_moment.isBetween(slot_start_time, slot_end_time)) {
									if (booked.duration == 0) {
										disabled = true;
										return false;
									}
								}

								// Check for overlaps considering appointment duration
								if (slot_info.allow_overlap != 1) {
									if (slot_start_time.isBefore(end_time) && slot_end_time.isAfter(booked_moment)) {
										// There is an overlap
										disabled = true;
										return false;
									}
								} else {
									if (slot_start_time.isBefore(end_time) && slot_end_time.isAfter(booked_moment)) {
										appointment_count++;
									}
									if (appointment_count >= slot_info.service_unit_capacity) {
										// There is an overlap
										disabled = true;
										return false;
									}
								}
							});
						}
						if (slot_info.allow_overlap == 1 && slot_info.service_unit_capacity > 1) {
							available_slots = slot_info.service_unit_capacity - appointment_count;
							count = `${(available_slots > 0 ? available_slots : __('Full'))}`;
							count_class = `${(available_slots > 0 ? 'badge-success' : 'badge-danger')}`;
							tool_tip =`${available_slots} ${__('slots available for booking')}`;
						}

						if (slot.maximum_appointments) {
							if (appointment_count >= slot.maximum_appointments) {
								disabled = true;
							}
							else {
								disabled = false;
							}
							available_slots = slot.maximum_appointments - appointment_count;
							count = `${(available_slots > 0 ? available_slots : __('Full'))}`;
							count_class = `${(available_slots > 0 ? 'badge-success' : 'badge-danger')}`;
							return `<button class="btn btn-secondary" data-name=${start_str}
								data-service-unit="${slot_info.service_unit || ''}"
								data-day-appointment=${1}
								data-duration=${slot.duration}
								${disabled ? 'disabled="disabled"' : ""}>${slot.from_time} -
								${slot.to_time} ${slot.maximum_appointments ?
								`<br><span class='badge ${count_class}'>${count} </span>` : ''}</button>`
						} else {

						return `
							<button class="btn btn-secondary" data-name=${start_str}
								data-duration=${interval}
								data-service-unit="${slot_info.service_unit || ''}"
								data-tele-conf="${slot_info.tele_conf || 0}"
								data-overlap-appointments="${slot_info.service_unit_capacity || 0}"
								style="margin: 0 10px 10px 0; width: auto;" ${disabled ? 'disabled="disabled"' : ""}
								data-toggle="tooltip" title="${tool_tip || ''}">
								${start_str.substring(0, start_str.length - 3)}
								${slot_info.service_unit_capacity ? `<br><span class='badge ${count_class}'> ${count} </span>` : ''}
							</button>`;

				}
			}).join("");

				if (slot_info.service_unit_capacity) {
					slot_html += `<br/><small>${__('Each slot indicates the capacity currently available for booking')}</small>`;
				}
				slot_html += `<br/><br/>`;

		});

		return slot_html;
	}
};

let get_prescribed_procedure = function(frm) {
	if (frm.doc.patient) {
		frappe.call({
			method: 'healthcare.healthcare.doctype.patient_appointment.patient_appointment.get_procedure_prescribed',
			args: { patient: frm.doc.patient },
			callback: function(r) {
				if (r.message && r.message.length) {
					show_procedure_templates(frm, r.message);
				} else {
					frappe.msgprint({
						title: __('Not Found'),
						message: __('No Prescribed Procedures found for the selected Patient')
					});
				}
			}
		});
	} else {
		frappe.msgprint({
			title: __('Not Allowed'),
			message: __('Please select a Patient first')
		});
	}
};

let show_procedure_templates = function(frm, result) {
	let d = new frappe.ui.Dialog({
		title: __('Prescribed Procedures'),
		fields: [
			{
				fieldtype: 'HTML', fieldname: 'procedure_template'
			}
		]
	});
	let html_field = d.fields_dict.procedure_template.$wrapper;
	html_field.empty();
	$.each(result, function(x, y) {
		let row = $(repl('<div class="col-xs-12" style="padding-top:12px; text-align:center;" >\
		<div class="col-xs-5"> %(encounter)s <br> %(consulting_practitioner)s <br> %(encounter_date)s </div>\
		<div class="col-xs-5"> %(procedure_template)s <br>%(practitioner)s  <br> %(date)s</div>\
		<div class="col-xs-2">\
		<a data-name="%(name)s" data-procedure-template="%(procedure_template)s"\
		data-encounter="%(encounter)s" data-practitioner="%(practitioner)s"\
		data-date="%(date)s"  data-department="%(department)s">\
		<button class="btn btn-default btn-xs">Add\
		</button></a></div></div><div class="col-xs-12"><hr/><div/>', {
			name: y[0], procedure_template: y[1],
			encounter: y[2], consulting_practitioner: y[3], encounter_date: y[4],
			practitioner: y[5] ? y[5] : '', date: y[6] ? y[6] : '', department: y[7] ? y[7] : ''
		})).appendTo(html_field);
		row.find("a").click(function() {
			frm.doc.procedure_template = $(this).attr('data-procedure-template');
			frm.doc.procedure_prescription = $(this).attr('data-name');
			frm.doc.practitioner = $(this).attr('data-practitioner');
			frm.doc.appointment_date = $(this).attr('data-date');
			frm.doc.department = $(this).attr('data-department');
			refresh_field('procedure_template');
			refresh_field('procedure_prescription');
			refresh_field('appointment_date');
			refresh_field('practitioner');
			refresh_field('department');
			d.hide();
			return false;
		});
	});
	if (!result) {
		let msg = __('There are no procedure prescribed for ') + frm.doc.patient;
		$(repl('<div class="col-xs-12" style="padding-top:20px;" >%(msg)s</div></div>', { msg: msg })).appendTo(html_field);
	}
	d.show();
};

let show_therapy_types = function(frm, result) {
	var d = new frappe.ui.Dialog({
		title: __('Prescribed Therapies'),
		fields: [
			{
				fieldtype: 'HTML', fieldname: 'therapy_type'
			}
		]
	});
	var html_field = d.fields_dict.therapy_type.$wrapper;
	$.each(result, function(x, y) {
		var row = $(repl('<div class="col-xs-12" style="padding-top:12px; text-align:center;" >\
		<div class="col-xs-5"> %(encounter)s <br> %(practitioner)s <br> %(date)s </div>\
		<div class="col-xs-5"> %(therapy)s </div>\
		<div class="col-xs-2">\
		<a data-therapy="%(therapy)s" data-therapy-plan="%(therapy_plan)s" data-name="%(name)s"\
		data-encounter="%(encounter)s" data-practitioner="%(practitioner)s"\
		data-date="%(date)s"  data-department="%(department)s">\
		<button class="btn btn-default btn-xs">Add\
		</button></a></div></div><div class="col-xs-12"><hr/><div/>', {
			therapy: y[0],
			name: y[1], encounter: y[2], practitioner: y[3], date: y[4],
			department: y[6] ? y[6] : '', therapy_plan: y[5]
		})).appendTo(html_field);

		row.find("a").click(function() {
			frm.doc.therapy_type = $(this).attr("data-therapy");
			frm.doc.practitioner = $(this).attr("data-practitioner");
			frm.doc.department = $(this).attr("data-department");
			frm.doc.therapy_plan = $(this).attr("data-therapy-plan");
			frm.refresh_field("therapy_type");
			frm.refresh_field("practitioner");
			frm.refresh_field("department");
			frm.refresh_field("therapy-plan");
			frappe.db.get_value('Therapy Type', frm.doc.therapy_type, 'default_duration', (r) => {
				if (r.default_duration) {
					frm.set_value('duration', r.default_duration)
				}
			});
			d.hide();
			return false;
		});
	});
	d.show();
};

let create_vital_signs = function(frm) {
	if (!frm.doc.patient) {
		frappe.throw(__('Please select patient'));
	}
	frappe.route_options = {
		'patient': frm.doc.patient,
		'appointment': frm.doc.name,
		'company': frm.doc.company
	};
	frappe.new_doc('Vital Signs');
};

let update_status = function(frm, status) {
	let doc = frm.doc;
	frappe.confirm(__('Are you sure you want to cancel this appointment?'),
		function() {
			frappe.call({
				method: 'healthcare.healthcare.doctype.patient_appointment.patient_appointment.update_status',
				args: { appointment_id: doc.name, status: status },
				callback: function(data) {
					if (!data.exc) {
						frm.reload_doc();
					}
				}
			});
		}
	);
};

let calculate_age = function(birth) {
	let ageMS = Date.parse(Date()) - Date.parse(birth);
	let age = new Date();
	age.setTime(ageMS);
	let years =  age.getFullYear() - 1970;
	return `${years} ${__('Years(s)')} ${age.getMonth()} ${__('Month(s)')} ${age.getDate()} ${__('Day(s)')}`;
};

let make_payment = function (frm, automate_invoicing) {
	if (automate_invoicing) {
		make_registration (frm, automate_invoicing);
	}

	function make_registration (frm, automate_invoicing) {
		if (automate_invoicing == true && !frm.doc.paid_amount) {
			frappe.throw({
				title: __("Not Allowed"),
				message: __("Please set the Paid Amount first"),
			});
		}

		let fields = [
			{
				label: "Patient",
				fieldname: "patient",
				fieldtype: "Data",
				read_only: true,
			},
			{
				label: "Mode of Payment",
				fieldname: "mode_of_payment",
				fieldtype: "Link",
				options: "Mode of Payment",
				reqd: 1,
			},
			{
				label: "Consultation Charge",
				fieldname: "consultation_charge",
				fieldtype: "Currency",
				read_only: true,
			},
			{
				label: "Discount Amount",
				fieldname: "discount_amount",
				fieldtype: "Currency",
				default: 0,
			}
		];

		if (frm.doc.appointment_for == "Practitioner") {
			let pract_dict = {
				label: "Practitioner",
				fieldname: "practitioner",
				fieldtype: "Data",
				read_only: true,
			};
			fields.splice(1, 0, pract_dict);
		} else if (frm.doc.appointment_for == "Service Unit") {
			let su_dict = {
				label: "Service Unit",
				fieldname: "service_unit",
				fieldtype: "Data",
				read_only: true,
			};
			fields.splice(1, 0, su_dict);
		} else if (frm.doc.appointment_for == "Department") {
			let dept_dict = {
				label: "Department",
				fieldname: "department",
				fieldtype: "Data",
				read_only: true,
			};
			fields.splice(1, 0, dept_dict);
		}

		if (automate_invoicing) {
			show_payment_dialog(frm, fields);
		}
	}

	function show_payment_dialog(frm, fields) {
		let d = new frappe.ui.Dialog({
			title: "Enter Payment Details",
			fields: fields,
			primary_action_label: "Create Invoice",
			primary_action: async function(values) {
				await frm.save();
				if (values.consultation_charge >= values.discount_amount) {
					frappe.call({
						method: "healthcare.healthcare.doctype.patient_appointment.patient_appointment.invoice_appointment",
						args: {
							"appointment_name": frm.doc.name,
							"discount_amount": values.discount_amount
						},
						callback: async function (data) {
							if (!data.exc) {
								await frm.reload_doc();
								if (frm.doc.ref_sales_invoice) {
									d.get_field("mode_of_payment").$input.prop("disabled", true);
									d.get_field("discount_amount").$input.prop("disabled", true);
									d.get_primary_btn().attr("disabled", true);
									d.get_secondary_btn().attr("disabled", false);
								}
							}
						}
					});
				} else {
					frappe.throw(__("Discount Amount should be less than or equal to Consultation Charge"))
				}
			},
			secondary_action_label: __(`<svg class="icon  icon-sm" style="">
				<use class="" href="#icon-printer"></use>
			</svg>`),
			secondary_action() {
				window.open("/app/print/Sales Invoice/" + frm.doc.ref_sales_invoice, "_blank");
				d.hide();
			}
		});
		d.fields_dict["mode_of_payment"].df.onchange = () => {
			if (d.get_value("mode_of_payment")) {
				frm.set_value("mode_of_payment", d.get_value("mode_of_payment"));
			}
		};
		d.get_secondary_btn().attr("disabled", true);
		d.set_values({
			"patient": frm.doc.patient_name,
			"consultation_charge": frm.doc.paid_amount,
		});

		if (frm.doc.appointment_for == "Practitioner") {
			d.set_value("practitioner", frm.doc.practitioner_name);
		} else if (frm.doc.appointment_for == "Service Unit") {
			d.set_value("service_unit", frm.doc.service_unit);
		} else if (frm.doc.appointment_for == "Department") {
			d.set_value("department", frm.doc.department);
		}

		if (frm.doc.mode_of_payment) {
			d.set_value("mode_of_payment", frm.doc.mode_of_payment);
		}
		d.show();
	}
};
