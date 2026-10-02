// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Emergency Record", {
	refresh(frm) {
		frm.trigger("render_vital_signs");
		if (frm.is_new()) return;

		const active = !["Closed", "Cancelled"].includes(frm.doc.status);
		if (active) {
			frm.add_custom_button(
				__("Triage"),
				() => triage_dialog(frm),
				__("Actions"),
			);
			frm.add_custom_button(
				__("Record Vitals"),
				() => vitals_dialog(frm),
				__("Actions"),
			);
			frm.add_custom_button(
				frm.doc.service_unit ? __("Transfer Bed") : __("Assign Bed"),
				() => bed_dialog(frm),
				__("Actions"),
			);
			frm.add_custom_button(
				__("Encounter"),
				() => open_linked(frm, "Patient Encounter"),
				__("Create"),
			);
			frm.add_custom_button(
				__("Order"),
				() => open_linked(frm, "Service Request"),
				__("Create"),
			);
			frm.add_custom_button(
				__("Disposition"),
				() => disposition_dialog(frm),
				__("Actions"),
			);
		}

		if (!frm.is_new() && frm.doc.patient && frm.doc.patient.startsWith("ER-")) {
			frm.add_custom_button(
				__("Identify Patient"),
				() => identify_dialog(frm),
				__("Actions"),
			);
		}

		if (!frm.is_new() && !frm.doc.sales_invoice) {
			frm.add_custom_button(
				__("Sales Invoice"),
				() =>
					frm.call("create_sales_invoice").then(r => {
						if (r.message) {
							frm.reload_doc();
							frappe.set_route("Form", "Sales Invoice", r.message);
						}
					}),
				__("Create"),
			);
			if (frm.doc.insurance_policy) {
				frm.add_custom_button(
					__("Insurance Coverage"),
					() =>
						frm
							.call("create_insurance_coverage")
							.then(() => frm.reload_doc()),
					__("Create"),
				);
			}
		}
	},

	patient(frm) {
		frm.trigger("render_vital_signs");
	},

	render_vital_signs(frm) {
		if (frm.is_new() || !frm.fields_dict.vital_signs_html) return;
		frm.call("get_vital_signs").then(r => {
			const rows = (r.message || [])
				.map(
					v =>
						`<tr><td>${frappe.utils.escape_html(
							v.observation_template || "",
						)}</td><td>${frappe.utils.escape_html(
							v.result || "",
						)} ${frappe.utils.escape_html(
							v.permitted_unit || "",
						)}</td></tr>`,
				)
				.join("");
			frm.fields_dict.vital_signs_html.$wrapper.html(
				rows
					? `<table class="table table-bordered"><thead><tr><th>${__(
							"Observation",
					  )}</th><th>${__(
							"Result",
					  )}</th></tr></thead><tbody>${rows}</tbody></table>`
					: `<div class="text-muted">${__("No vital signs recorded")}</div>`,
			);
		});
	},
});

function triage_dialog(frm) {
	frappe.prompt(
		[
			{
				fieldname: "triage_level",
				fieldtype: "Link",
				options: "Triage Level",
				label: __("Triage Level"),
				reqd: 1,
			},
		],
		values =>
			frm
				.call("record_triage", { triage_level: values.triage_level })
				.then(() => frm.reload_doc()),
		__("Record Triage"),
		__("Save"),
	);
}

function bed_dialog(frm) {
	const method = frm.doc.service_unit ? "transfer_bed" : "assign_bed";
	frappe.prompt(
		[
			{
				fieldname: "service_unit",
				fieldtype: "Link",
				options: "Healthcare Service Unit",
				label: __("Bed"),
				reqd: 1,
				get_query: () => ({
					filters: { occupancy_status: "Vacant", is_group: 0 },
				}),
			},
		],
		values =>
			frm
				.call(method, { service_unit: values.service_unit })
				.then(() => frm.reload_doc()),
		__("Select Bed"),
		__("Save"),
	);
}

function vitals_dialog(frm) {
	const dialog = new frappe.ui.Dialog({
		title: __("Record Vital Signs"),
		fields: [
			{
				fieldname: "vitals",
				fieldtype: "Table",
				cannot_add_rows: false,
				in_place_edit: true,
				data: [],
				fields: [
					{
						fieldname: "template",
						fieldtype: "Link",
						options: "Observation Template",
						label: __("Observation"),
						in_list_view: 1,
						reqd: 1,
						get_query: () => ({
							filters: { observation_category: "Vital Signs" },
						}),
					},
					{
						fieldname: "result",
						fieldtype: "Data",
						label: __("Result"),
						in_list_view: 1,
					},
				],
			},
		],
		primary_action_label: __("Save"),
		primary_action: values => {
			frm.call("add_vital_signs", { vitals: values.vitals || [] }).then(() => {
				dialog.hide();
				frm.trigger("render_vital_signs");
			});
		},
	});
	dialog.show();
}

function disposition_dialog(frm) {
	frappe.prompt(
		[
			{
				fieldname: "disposition",
				fieldtype: "Select",
				options: [
					"Discharged",
					"Admitted",
					"Transferred",
					"Left Without Being Seen",
					"Deceased",
				],
				label: __("Disposition"),
				reqd: 1,
			},
			{ fieldname: "notes", fieldtype: "Small Text", label: __("Notes") },
		],
		values =>
			frm
				.call("set_disposition", {
					disposition: values.disposition,
					notes: values.notes,
				})
				.then(() => frm.reload_doc()),
		__("Set Disposition"),
		__("Save"),
	);
}

function identify_dialog(frm) {
	frappe.prompt(
		[
			{
				fieldname: "target_patient",
				fieldtype: "Link",
				options: "Patient",
				label: __("Merge Into Patient"),
				reqd: 1,
				get_query: () => ({ filters: { name: ["!=", frm.doc.patient] } }),
			},
		],
		values =>
			frm
				.call("merge_patient", { target_patient: values.target_patient })
				.then(() => frm.reload_doc()),
		__("Identify Patient"),
		__("Merge"),
	);
}

function open_linked(frm, doctype) {
	frappe.route_options = {
		patient: frm.doc.patient,
		emergency_record: frm.doc.name,
		company: frm.doc.company,
	};
	if (doctype === "Patient Encounter") {
		frappe.route_options.practitioner = frm.doc.attending_practitioner;
		frappe.route_options.medical_department = frm.doc.medical_department;
	}
	frappe.new_doc(doctype);
}
