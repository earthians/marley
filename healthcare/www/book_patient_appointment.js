frappe.ready(async () => {
	initialise_select_date();
})

async function initialise_select_date() {
	hide_book_btn();
	await get_global_variables();
	setup_timezone_selector();
}

async function get_global_variables() {
	window.timezones = (await frappe.call({
		method:'erpnext.www.book_appointment.index.get_timezones'
	})).message;
}

function on_date_or_timezone_select() {
	let date_picker = document.getElementById('appointment-date');
	let timezone = document.getElementById('appointment-timezone');
	let patient_id = document.getElementById('patient-list');
	if (date_picker.value === '') {
		clear_slots();
		hide_book_btn();
		frappe.show_alert({
			message: __("Please select a date"),
			indicator: "info"
		  });
		  return
	}
	if (date_picker.value && patient_id.value === '') {
		clear_slots();
		hide_book_btn();
		frappe.show_alert({
			message: __("Please select a patient"),
			indicator: "info"
		  });
		  return
	}
	window.selected_date = date_picker.value;
	window.selected_timezone = timezone.value;
	update_time_slots(date_picker.value, timezone.value);
	let head_text = document.getElementById('head');
	head_text.innerHTML = "Choose Slot"
}

function setup_timezone_selector() {
	let timezones_element = document.getElementById('appointment-timezone');
	let local_timezone = moment.tz.guess()
	window.timezones.forEach(timezone => {
		let opt = document.createElement('option');
		opt.value = timezone;
		if (timezone == local_timezone) {
			opt.selected = true;
		}
		opt.innerHTML = timezone;
		timezones_element.appendChild(opt)
	});
}

async function get_time_slots(date, timezone) {
	let slots = (await frappe.call({
		method: 'healthcare.healthcare.doctype.patient_appointment.patient_appointment.get_availability_data',
		args: {
			practitioner: selected_practitioner,
			date: date,
			to_tz: timezone
		}
	})).message;
	return slots;
}

function hide_book_btn() {
    let book_button = document.getElementById('book-button');
    book_button.disabled = true;
    // book_button.onclick = () => frappe.msgprint(__("Please select a date and time"));
}

function show_book_btn(selected_slot) {
	window.selected_slot = selected_slot
	let book_button = document.getElementById('book-button');
    book_button.disabled = false;
	if (window.tele_conf)  {
		if (parseInt(window.tele_conf)) {
			$(".opt-out-conf-div").removeClass("hide-sec");
		} else {
			$(".opt-out-conf-div").addClass("hide-sec");
		}
	}
    book_button.onclick = book_appointment;
}

async function update_time_slots(selected_date, selected_timezone) {
	let timeslot_container = document.getElementById('fh-slot-container');
	window.slots = await get_time_slots(selected_date, selected_timezone);
	clear_slots();
	if (window.slots.length <= 0) {
		let message_div = document.createElement('p');
		message_div.innerHTML = "There are no slots available on this date";
		timeslot_container.appendChild(message_div);
		return
	}
		let slot_html = get_slots(window.slots.slot_details);
		let timeslot_div = document.createElement('p');
		timeslot_div.innerHTML = slot_html
		timeslot_container.appendChild(timeslot_div);
}

function clear_slots() {
	let timeslot_container = document.getElementById('fh-slot-container');
	while (timeslot_container.firstChild) {
		timeslot_container.removeChild(timeslot_container.firstChild);
	}
}

function get_slots(slot_details) {
	let slot_html = '';
	let appointment_count = 0;
	let disabled = false;
	let start_str, slot_start_time, slot_end_time, interval, count, count_class, tool_tip, available_slots;

	slot_details.forEach((slot_info) => {
		slot_html += `<style></style><div class="slot-info">`
			slot_html += `
			<span><b>${slot_info.service_unit}</b></span>`;

		if (slot_info.service_unit_capacity) {
			slot_html += `<br><span> <b> ${__('Maximum Capacity:')} </b> ${slot_info.service_unit_capacity} </span>`;
		}

		slot_html += '</div><br>';

		slot_html += slot_info.avail_slot.map(slot => {
			if (slot.display_time_slot) {
			display_time_slot = slot.display_time_slot
			appointment_count = 0;
			disabled = false;
			count_class = tool_tip = '';
			appointment_date = slot.system_date;
			start_str = slot.from_time;
			slot_start_time = moment(slot.from_time, 'HH:mm:ss');
			slot_end_time = moment(slot.to_time, 'HH:mm:ss');
			interval = (slot_end_time - slot_start_time) / 60000 | 0;

			// iterate in all booked appointments, update the start time and duration
			slot_info.appointments.forEach((booked) => {
				let booked_moment = moment(booked.appointment_time, 'HH:mm:ss');
				let end_time = booked_moment.clone().add(booked.duration, 'minutes');

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

			let slot_time = moment(display_time_slot, 'HH:mm:ss');
			let now_time = moment(frappe.datetime.now_time(), 'HH:mm:ss');

			if (window.selected_date==frappe.datetime.now_date() && slot_time.isBefore(now_time)) {
				disabled = true;
			}

			if (slot_info.allow_overlap == 1 && slot_info.service_unit_capacity > 1) {
				available_slots = slot_info.service_unit_capacity - appointment_count;
				count = `${(available_slots > 0 ? available_slots : __('Full'))}`;
				count_class = `${(available_slots > 0 ? 'badge-success' : 'badge-danger')}`;
				tool_tip =`${available_slots} ${__('slots available for booking')}`;
			}
			return `
			<button class="btn btn-secondary btn-appointment" data-name='${start_str}'
				data-duration=${interval}
				data-service-unit="${slot_info.service_unit || ''}"
				data-tele-conf="${slot_info.tele_conf || 0}"
				${disabled ? 'disabled="disabled"' : ""}
				data-toggle="tooltip" title="${tool_tip || ''}" onclick="slot_btn_on_click(
					'${start_str}', '${appointment_date}', '${slot_info.service_unit || ''}',
					'${interval}', '${slot_info.tele_conf || 0}')">
				${display_time_slot.substring(0, display_time_slot.length - 3)}
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

function slot_btn_on_click(selected_slot, selected_date, service_unit, duration, tele_conf){
	window.selected_date = selected_date
	window.service_unit = service_unit
	window.duration = duration
	window.tele_conf = tele_conf
	show_book_btn(selected_slot)
}


function book_appointment(){
	$(".portal-full-section").addClass("freeze-div");
	frappe.show_alert({
		message: __("Booking Appointment..."),
		indicator: "info"
	  });
	let patient_id = document.getElementById('patient-list');
	let opt_out_vconf = 1
	if (parseInt(window.tele_conf)==1 && !$(".opt-out-check").is(":checked")) {
		opt_out_vconf = 0
	}
	frappe.call({
		method: 'healthcare.www.book_patient_appointment.book_appointment',
		args: {
			practitioner: selected_practitioner,
			patient: patient_id.value,
			date: window.selected_date,
			time: window.selected_slot,
			duration: window.duration,
			service_unit : window.service_unit,
			opt_out_vconf: opt_out_vconf,
		},
		callback: (r) => {
			if(!r.exc && r.message) {
				$('#book-appointment-sec').hide();
				$('#appointment-success-sec').show();
				document.getElementById(
					"success-practitioner"
				).innerHTML = `
					Date : <b>${window.selected_date}</b><br>
					Time : <b>${window.selected_slot}</b><br>
					Practitioner : <b>${r.message[1] ? r.message[1] : selected_practitioner}</b>
					`;
					let url = success_url;
					if (success_url == "None") {
						url = "/";
					}
					frappe.utils.setup_timer(5, 0, $(".time"));
					setTimeout(() => {
						window.location.href = url;
					}, 5000);
			}
			$(".portal-full-section").removeClass("freeze-div");
		}
	})
}