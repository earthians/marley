// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

// Every form the Nursing Dialog button is added to.
healthcare.nursing.STATION_DOCTYPES = [
	"Inpatient Record",
	"Emergency Record",
	"Patient Encounter",
	"Clinical Procedure",
	"Therapy Session",
];

// Forms that carry a Nursing tab showing the snapshot without the dialog.
healthcare.nursing.SNAPSHOT_DOCTYPES = [
	"Inpatient Record",
	"Emergency Record",
	"Clinical Procedure",
];

// Each form names its practitioner differently.
healthcare.nursing.PRACTITIONER_FIELDS = [
	"practitioner",
	"primary_practitioner",
	"attending_practitioner",
	"triage_practitioner",
];

healthcare.nursing.get_practitioner = function (frm) {
	const fieldname = healthcare.nursing.PRACTITIONER_FIELDS.find(
		field => frm.doc[field],
	);
	return fieldname ? frm.doc[fieldname] : null;
};

healthcare.nursing.open_from_form = function (frm) {
	const refresh = () => frm.nursing_snapshot?.refresh();
	const station = healthcare.nursing.open({
		patient: frm.doc.patient,
		reference_doctype: frm.doctype,
		reference_name: frm.docname,
		practitioner: healthcare.nursing.get_practitioner(frm),
		// what the dialog recorded is not on the form's snapshot until it fetches again
		on_recorded: refresh,
	});
	// a fallback for a pane that writes without calling recorded()
	station.dialog.$wrapper.on("hidden.bs.modal", refresh);
};

healthcare.nursing.add_button = function (frm) {
	if (!frm.doc.patient || frm.is_new()) return;

	frm.add_custom_button(__("Nursing Dialog"), () =>
		healthcare.nursing.open_from_form(frm),
	);
};

// Renders into the Nursing tab's HTML field, not the dashboard.
healthcare.nursing.render_snapshot = function (frm) {
	const field = frm.get_field("nursing_snapshot");
	if (!field) return;

	// The form refreshes more than once; the previous instance's fetch may still be running.
	frm.nursing_snapshot?.destroy();
	frm.nursing_snapshot = null;
	field.$wrapper.empty();
	if (!frm.doc.patient || frm.is_new()) return;

	frm.nursing_snapshot = new healthcare.nursing.Snapshot({
		wrapper: field.$wrapper,
		patient: frm.doc.patient,
		layout: "wide",
		...healthcare.nursing.saved_reference(frm),
	});
	frm.nursing_snapshot.refresh();
};

// The record only vouches for the patient it was saved with; a patient changed on the form is not its own yet.
healthcare.nursing.saved_reference = function (frm) {
	if (frm.doc.patient !== frm.nursing_saved_patient) return {};
	return { reference_doctype: frm.doctype, reference_name: frm.docname };
};

healthcare.nursing.STATION_DOCTYPES.forEach(doctype => {
	const shows_snapshot = healthcare.nursing.SNAPSHOT_DOCTYPES.includes(doctype);

	frappe.ui.form.on(doctype, {
		refresh(frm) {
			if (!frm.is_dirty()) frm.nursing_saved_patient = frm.doc.patient;
			healthcare.nursing.add_button(frm);
			if (shows_snapshot) healthcare.nursing.render_snapshot(frm);
		},
		patient(frm) {
			if (shows_snapshot) healthcare.nursing.render_snapshot(frm);
		},
	});
});
