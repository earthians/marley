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
	if (date_picker.value === '') {
		clear_slots();
		hide_book_btn();
		frappe.throw(__('Please select a date'));
	}
	// window.selected_date = date_picker.value;
	window.selected_timezone = timezone.value;
	update_time_slots(date_picker.value, timezone.value);
	let lead_text = document.getElementById('lead-text');
	lead_text.innerHTML = "Select Time"
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
	// let local_timezone = moment.tz.guess()
	// if (local_timezone == timezone) {
	// 	timezone = ''
	// }
	
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
    book_button.onclick = book_appointment;
}

async function update_time_slots(selected_date, selected_timezone) {
	let timeslot_container = document.getElementById('slot_container');
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
	let timeslot_container = document.getElementById('slot_container');
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
		slot_html += `<div class="slot-info">
			<span> <b> ${__('Practitioner Schedule:')} </b> ${slot_info.slot_name} </span><br>
			<span> <b> ${__('Service Unit:')} </b> ${slot_info.service_unit} </span>`;

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
			console.log(slot.system_date)
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

			if (slot_info.allow_overlap == 1 && slot_info.service_unit_capacity > 1) {
				available_slots = slot_info.service_unit_capacity - appointment_count;
				count = `${(available_slots > 0 ? available_slots : __('Full'))}`;
				count_class = `${(available_slots > 0 ? 'badge-success' : 'badge-danger')}`;
				tool_tip =`${available_slots} ${__('slots available for booking')}`;
			}
			return `
				<button class="btn btn-secondary" data-name='${start_str}'
					data-duration=${interval}
					data-service-unit="${slot_info.service_unit || ''}"
					style="margin: 0 10px 10px 0; width: auto;" ${disabled ? 'disabled="disabled"' : ""}
					data-toggle="tooltip" title="${tool_tip || ''}" onclick="slot_btn_on_click('${start_str}', '${appointment_date}')">
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

function slot_btn_on_click(selected_slot, selected_date){
	window.selected_date = selected_date
	show_book_btn(selected_slot)
}


function book_appointment(){
	frappe.call({
		method: 'healthcare.www.book_patient_appointment.book_appointment',
		args: {
			practitioner: selected_practitioner,
			date: window.selected_date,
			time: window.selected_slot
		},
		callback: (r) => {
			if(!r.exc && r.message.appointment) {
				setTimeout(window.location.href = "/", 5000);
				frappe.msgprint(__("Appointment Booked"));
			}
		}
	})
}