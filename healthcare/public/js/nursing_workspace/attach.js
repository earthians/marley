// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

// Every form the Nursing Station button is added to.
healthcare.nursing.STATION_DOCTYPES = [
	"Inpatient Record",
	"Emergency Record",
	"Patient Encounter",
	"Clinical Procedure",
	"Therapy Session",
];

// Forms that also show the snapshot inline, without opening the dialog.
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

	frm.add_custom_button(__("Nursing Station"), () =>
		healthcare.nursing.open_from_form(frm),
	);
};

healthcare.nursing.add_snapshot_section = function (frm) {
	if (!frm.doc.patient || frm.is_new()) return;

	const body = frm.dashboard.add_section("", __("Nursing"));
	const snapshot = new healthcare.nursing.Snapshot({
		wrapper: body,
		patient: frm.doc.patient,
		layout: "wide",
	});
	snapshot.refresh();
	frm.nursing_snapshot = snapshot;
};

healthcare.nursing.STATION_DOCTYPES.forEach(doctype => {
	const shows_snapshot = healthcare.nursing.SNAPSHOT_DOCTYPES.includes(doctype);

	frappe.ui.form.on(doctype, {
		refresh(frm) {
			healthcare.nursing.add_button(frm);
			if (shows_snapshot) healthcare.nursing.add_snapshot_section(frm);
		},
	});
});
