// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on("Treatment Counselling", {
    refresh(frm) {
		if (!frm.doc.__islocal) {
			if (frm.doc.docstatus === 1) {
				if (frm.doc.encounter_status == "Admission Scheduled" && frm.doc.status == "Active") {
					if (!frm.doc.inpatient_record) {
						frm.add_custom_button(__('Schedule Admission'), function() {
							frappe.confirm(__("Confirm to Schedule Admission"), function() {
								schedule_inpatient(frm);
							});
						});
					}
					if (frm.doc.outstanding_amount > 0) {
						frm.add_custom_button(__('Payment Entry'), function() {
							frappe.call({
								method: "healthcare.healthcare.doctype.treatment_counselling.treatment_counselling.create_payment_entry",
								args: {
									treatment_counselling: frm.doc.name
								},
								callback: function (r) {
									if (r && r.message) {
										frappe.set_route("Form", "Payment Entry", r.message);
									}
								}
							});
						}, 'Create')
					}
				}
				if (frm.doc.status == "Completed") {
					frm.add_custom_button(__("Admission Encounter"), function() {
						frappe.set_route("Form", "Patient Encounter", frm.doc.admission_encounter);
					}, "View")

					frm.add_custom_button(__("Inpatient Record"), function() {
						frappe.set_route("Form", "Inpatient Record", frm.doc.inpatient_record);
					}, "View")
				}
			}
			if(frm.doc.status == "Active") {
				frm.add_custom_button(__('Close'), function() {
					frm.set_value("status", "Closed")
					frm.save("Update")
					frm.refresh();
				})
			}
		}
	},
	tc_name(frm) {
		set_terms_and_conditions(frm)
	},
});


var set_terms_and_conditions = function(frm){
	if (frm.doc.tc_name) {
		return frappe.call({
			method: 'erpnext.setup.doctype.terms_and_conditions.terms_and_conditions.get_terms_and_conditions',
			args: {
				template_name: frm.doc.tc_name,
				doc: frm.doc
			},
			callback: function (r) {
				frm.set_value('terms', r.message)
			}
		});
	} else {
		frm.set_value('terms', '')
	}
}

var schedule_inpatient = function(frm) {
	var args = {
		patient: frm.doc.patient,
		admission_encounter: frm.doc.admission_encounter,
		referring_practitioner: frm.doc.referring_practitioner,
		company: frm.doc.company,
		medical_department: frm.doc.medical_department,
		primary_practitioner: frm.doc.primary_practitioner,
		secondary_practitioner: frm.doc.secondary_practitioner,
		admission_ordered_for: frm.doc.admission_ordered_for,
		admission_service_unit_type: frm.doc.service_unit_type,
		treatment_plan_template: frm.doc.treatment_plan_template,
		expected_length_of_stay: frm.doc.expected_length_of_stay,
		admission_instruction: frm.doc.admission_instruction,
		admission_nursing_checklist_template: frm.doc.admission_nursing_checklist_template,
	}
	frappe.call({
		method: "healthcare.healthcare.doctype.treatment_counselling.treatment_counselling.create_ip_from_treatment_counselling",
		args: {
			admission_order: args,
			treatment_counselling: frm.doc.name,
		},
		callback: function(data) {
			if (!data.exc) {
				frm.reload_doc();
			}
		},
	})
}

