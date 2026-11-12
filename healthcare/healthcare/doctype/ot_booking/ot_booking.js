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

	onload: function (frm) {
		if (!frm.is_new() || frm.doc.cleaning_minutes) return;
		frappe.db
			.get_single_value("Healthcare Settings", "ot_cleaning_minutes")
			.then(minutes => frm.set_value("cleaning_minutes", minutes));
	},

	patient: function (frm) {
		frm.set_value("inpatient_record", null);
	},

	refresh: function (frm) {
		const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
		const passed =
			!frm.is_new() &&
			frappe.datetime.str_to_obj(frm.doc.scheduled_start) < fifteenMinutesAgo;
		frm.set_df_property("cleaning_minutes", "read_only", passed ? 1 : 0);
		const open = !["Cancelled", "Postponed", "Completed"].includes(frm.doc.status);
		if (frm.is_new() || !open || !frm.doc.__onload?.procedures_to_create) return;
		frm.add_custom_button(__("Create Procedures"), () => create_procedures(frm));
		frm.change_custom_button_type(__("Create Procedures"), null, "primary");
	},
});

function create_procedures(frm) {
	frappe.call({
		doc: frm.doc,
		method: "create_clinical_procedures",
		freeze: true,
		callback: function (r) {
			if (r.exc) return;
			frappe.show_alert({
				message: __("{0} Clinical Procedure(s) created", [r.message.length]),
				indicator: "green",
			});
			frm.reload_doc();
		},
	});
}
