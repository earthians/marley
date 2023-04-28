// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on("OT Schedule", {
	refresh: function (frm) {
		if (!frm.doc.schedule_date) {
			frm.set_value("schedule_date", frappe.datetime.add_days(frappe.datetime.nowdate(), 1))
		}

		if (frm.doc.docstatus == 0) {
			frm.add_custom_button(__("Get Items"), function() {
				get_service_requests(frm);
			});
		}
	},

	healthcare_service_unit: function (frm) {
		if (frm.doc.healthcare_service_unit) {
			set_time_to_child(frm);
		}
	},

	validate: function (frm) {
		set_time_to_child(frm);
	}
});


frappe.ui.form.on("Procedure Schedules", {
	procedure_schedules_add: function(frm, cdt, cdn) {
		set_time_to_child(frm);
	},
	procedure_schedules_move: function(frm, cdt, cdn) {
		frm.refresh_field("procedure_schedules");
		set_time_to_child(frm);
	},
	clinical_procedure_template: function(frm, cdt, cdn) {
		set_time_to_child(frm);
	}
})


let set_time_to_child = function(frm) {
	if (frm.doc.procedure_schedules) {
		let idx_time_dict = {}
		frm.doc.procedure_schedules.forEach(schedule => {
			if (schedule.idx==1) {
				schedule.from_time = frm.doc.from_time;
			} else {
				schedule.from_time = idx_time_dict[schedule.idx-1]
			}
			if (schedule.duration && schedule.from_time) {
				schedule.to_time = add_time(schedule.from_time, schedule.duration)
			}
			if (schedule.to_time) {
				idx_time_dict[schedule.idx] = schedule.to_time
			}
		})
		frm.refresh_field("procedure_schedules");
	}
}

let add_time = function(time, duration) {
	var assign_date = frappe.datetime.add_days(frappe.datetime.nowdate(), 1);
	var newDateObj = moment(assign_date + " " + time).add(duration, 'm').toDate();
	return newDateObj.toLocaleTimeString()
}

var get_service_requests = function(frm) {
	frappe.call({
		method: "healthcare.healthcare.doctype.ot_schedule.ot_schedule.get_service_requests",
		args: {
			"date": frm.doc.schedule_date
		},
		freeze: true,
		freeze_message: __('Fetching Service Requests'),
		callback: function() {
			new frappe.ui.form.MultiSelectDialog({
				doctype: "Service Request",
				target: this.cur_frm,
				setters: {
					medical_department: frm.doc.medical_department,
					template_dn: "",
					ordered_for: frm.doc.schedule_date,
				},
				add_filters_group: 1,
				action(selections) {
					console.log(selections)
					frappe.call({
						method: "healthcare.healthcare.doctype.ot_schedule.ot_schedule.set_procedure_schedule",
						args: {service_requests: selections},
					}).then((r) => {
						if (r && r.message) {
							frm.set_value("procedure_schedules", [])
							$.each(r.message, function (k, val) {
								if (val) {
									var child = cur_frm.add_child("procedure_schedules");
									child.patient= val.patient
									child.practitioner = val.practitioner
									child.clinical_procedure_template = val.clinical_procedure_template
									child.duration = val.total_duration
									child.service_request = val.service_request
							frm.refresh_fields("procedure_schedules");
								}
							})
						}
						set_time_to_child(frm);
						cur_dialog.hide();
					})
				}
			});
		}
	});
}