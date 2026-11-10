// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("OT Booking", {
	setup: function (frm) {
		frm.set_query("theatre", () => ({
			filters: { is_ot: 1, is_group: 0, company: frm.doc.company },
		}));
		frm.set_query("procedure_template", "procedures", () => ({
			filters: { requires_ot: 1, disabled: 0 },
		}));
		frm.set_query("service_request", "procedures", () => ({
			filters: {
				patient: frm.doc.patient,
				template_dt: "Clinical Procedure Template",
				status: "active-Request Status",
				docstatus: 1,
			},
		}));
		frm.set_query("inpatient_record", () => ({
			filters: { patient: frm.doc.patient, status: ["!=", "Discharged"] },
		}));
	},

	patient: function (frm) {
		frm.set_value("inpatient_record", null);
	},
});
