// Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Practitioner Schedule', {
	refresh: function(frm) {
		cur_frm.fields_dict["time_slots"].grid.wrapper.find('.grid-add-row').hide();
		cur_frm.fields_dict["time_slots"].grid.add_custom_button(__('Add Time Slots'), () => {
			let d = new frappe.ui.Dialog({
				fields: [
					{
						fieldname: 'days', label: __('Select Days'), fieldtype: 'MultiSelect',
						options:[
							{value:'Sunday', label:__('Sunday')},
							{value:'Monday', label:__('Monday')},
							{value:'Tuesday', label:__('Tuesday')},
							{value:'Wednesday', label:__('Wednesday')},
							{value:'Thursday', label:__('Thursday')},
							{value:'Friday', label:__('Friday')},
							{value:'Saturday', label:__('Saturday')},
						], reqd: 1
					},
					{
						fieldname: 'from_time', label: __('From'), fieldtype: 'Time',
						'default': '09:00:00', reqd: 1
					},
					{
						fieldname: 'to_time', label: __('To'), fieldtype: 'Time',
						'default': '12:00:00', reqd: 1
					},
					{
						fieldname: 'duration', label: __('Appointment Duration (mins)'),
						fieldtype:'Int', 'default': 15,
					},
					{
						fieldname: 'create_slots', label: __('Create Slots'), fieldtype: 'Check',
						'default': 1
					},
					{
						fieldname: 'maximum_appointments', label: __('Maximum Number of Appointments (Nos)'),
						fieldtype:'Int', mandatory_depends_on: "eval:doc.create_slots==0",
						depends_on: "eval:doc.create_slots==0"
					},
				],
				primary_action_label: __('Add'),
				primary_action: () => {
					let values = d.get_values();
					if (values) {
						let slot_added = false;
						values.days.split(',').forEach(function(day){
							day = $.trim(day);
							if (['Sunday', 'Monday', 'Tuesday', 'Wednesday',
							'Thursday', 'Friday', 'Saturday'].includes(day)){
								add_slots(day);
							}
						});

						function check_overlap_or_add_slot(week_day, cur_time, end_time, add_slots_to_child){
							let overlap = false;
							if (values.create_slots) {
								while (cur_time < end_time) {
										let add_to_child = true;
										let to_time = cur_time.clone().add(values.duration, 'minutes');
										if (to_time <= end_time) {
											if (frm.doc.time_slots){
												frm.doc.time_slots.forEach(function(slot) {
													if (slot.day == week_day){
														let slot_from_moment = moment(slot.from_time, 'HH:mm:ss');
														let slot_to_moment = moment(slot.to_time, 'HH:mm:ss');
														if (cur_time.isSame(slot_from_moment)	||	cur_time.isBetween(slot_from_moment, slot_to_moment)	||
														to_time.isSame(slot_to_moment)	||	to_time.isBetween(slot_from_moment, slot_to_moment)) {
															overlap = true;
															if (add_slots_to_child) {
																frappe.show_alert({
																	message:__('Time slot skiped, the slot {0} to {1} overlap exisiting slot {2} to {3}',
																		[cur_time.format('HH:mm:ss'),	to_time.format('HH:mm:ss'),	slot.from_time,	slot.to_time]),
																	indicator:'orange'
																});
																add_to_child = false;
															}
														}
													}
												});
											}
											// add a new timeslot
											if (add_to_child && add_slots_to_child) {
												frm.add_child('time_slots', {
													from_time: cur_time.format('HH:mm:ss'),
													to_time: to_time.format('HH:mm:ss'),
													day: week_day
												});
												slot_added = true;
											}
										}
										cur_time = to_time;
								}
							} else {
								// appointment for day
								let add_to_child = true;
								if (add_slots_to_child && frm.doc.time_slots){
									frm.doc.time_slots.forEach(function(slot) {
										if (slot.day == week_day){
											let slot_from_moment = moment(slot.from_time, 'HH:mm:ss');
											let slot_to_moment = moment(slot.to_time, 'HH:mm:ss');
											if (cur_time.isSame(slot_from_moment)	||	cur_time.isBetween(slot_from_moment, slot_to_moment)	||
											end_time.isSame(slot_to_moment)	||	end_time.isBetween(slot_from_moment, slot_to_moment)) {
												overlap = true;
												if (add_slots_to_child) {
													frappe.show_alert({
														message:__('Time slot skiped, the slot {0} to {1} overlap exisiting slot {2} to {3}',
															[cur_time.format('HH:mm:ss'),	end_time.format('HH:mm:ss'),	slot.from_time,	slot.to_time]),
														indicator:'orange'
													});
													add_to_child = false;
												}
											}
										}
									});
								}
								if (add_slots_to_child && add_to_child) {
									frm.add_child('time_slots', {
										from_time: cur_time.format('HH:mm:ss'),
										to_time: end_time.format('HH:mm:ss'),
										day: week_day,
										maximum_appointments: values.maximum_appointments,
										duration: values.duration,
									});
								}
							}
							return overlap;
						}

						function add_slots(week_day) {
							let cur_time = moment(values.from_time, 'HH:mm:ss');
							let end_time = moment(values.to_time, 'HH:mm:ss');
							if (check_overlap_or_add_slot(week_day, cur_time, end_time, false)) {
								frappe.confirm(__('Schedules for {0} overlaps, do you want to proceed after skipping overlapped slots ?',	[week_day]),
									function() {
										// if Yes
										check_overlap_or_add_slot(week_day, cur_time, end_time, true);
									},
									function() {
										// if No
										frappe.show_alert({
											message: __('Slots for {0} are not added to the schedule',	[week_day]),
											indicator: 'red'
										});
									}
								);
							} else {
								check_overlap_or_add_slot(week_day, cur_time, end_time, true);
							}
						}

						frm.refresh_field('time_slots');

						if (slot_added) {
							frappe.show_alert({
								message: __('Time slots added'),
								indicator: 'green'
							});
						}
					}
				},
			});
			d.fields_dict['create_slots'].df.onchange = () => {
				set_maximum_no_of_appointments(d)
			}
			d.fields_dict['from_time'].df.onchange = () => {
				set_maximum_no_of_appointments(d)
			}
			d.fields_dict['to_time'].df.onchange = () => {
				set_maximum_no_of_appointments(d)
			}
			d.fields_dict['duration'].df.onchange = () => {
				set_maximum_no_of_appointments(d)
			}
			d.show();
		});
	}
});

var set_maximum_no_of_appointments = function(d) {
	if (!d.get_value("create_slots")) {
		let interval = 0;
		let max_apps = 0;
		if (d.get_value("from_time") && d.get_value("to_time")) {
			interval = (moment(d.get_value("from_time"), 'HH:mm:ss') - moment(d.get_value("to_time"), 'HH:mm:ss')) / 60000 | 0;
			max_apps = Math.abs(interval) / d.get_value("duration")
			d.set_value("maximum_appointments", Math.floor(max_apps))
		}
	} else {
		d.set_value("maximum_appointments", 0)
	}
}