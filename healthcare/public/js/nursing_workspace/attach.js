// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

// Every form the Nursing Workspace button is added to.
healthcare.nursing.STATION_DOCTYPES = [
	"Inpatient Record",
	"Emergency Record",
	"Patient Encounter",
	"Clinical Procedure",
	"Therapy Session",
];

// Forms that carry a Nursing tab showing the snapshot without the dialog.
healthcare.nursing.SNAPSHOT_DOCTYPES = ["Inpatient Record", "Emergency Record"];

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
	healthcare.nursing.open({
		patient: frm.doc.patient,
		reference_doctype: frm.doctype,
		reference_name: frm.docname,
		practitioner: healthcare.nursing.get_practitioner(frm),
	});
};

healthcare.nursing.add_button = function (frm) {
	if (!frm.doc.patient || frm.is_new()) return;

	frm.add_custom_button(__("Nursing Workspace"), () =>
		healthcare.nursing.open_from_form(frm),
	);
};

// Renders into the Nursing tab's HTML field, not the dashboard.
healthcare.nursing.render_snapshot = function (frm) {
	if (!frm.doc.patient || frm.is_new()) return;

	const field = frm.get_field("nursing_snapshot");
	if (!field) return;

	// The form refreshes more than once; drop the previous instance's observer.
	if (frm.nursing_snapshot) frm.nursing_snapshot.stop_waiting();

	frm.nursing_snapshot = new healthcare.nursing.Snapshot({
		wrapper: field.$wrapper,
		patient: frm.doc.patient,
		layout: "wide",
	});
	frm.nursing_snapshot.refresh();
};

healthcare.nursing.STATION_DOCTYPES.forEach(doctype => {
	const shows_snapshot = healthcare.nursing.SNAPSHOT_DOCTYPES.includes(doctype);

	frappe.ui.form.on(doctype, {
		refresh(frm) {
			healthcare.nursing.add_button(frm);
			if (shows_snapshot) healthcare.nursing.render_snapshot(frm);
		},
	});
});
