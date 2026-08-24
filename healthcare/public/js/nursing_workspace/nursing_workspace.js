// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

healthcare.nursing.panes = healthcare.nursing.panes || {};

healthcare.nursing.BANNER_METHOD = "healthcare.healthcare.api.nursing.get_banner";
healthcare.nursing.FIND_PATIENTS_METHOD =
	"healthcare.healthcare.api.nursing.find_patients";

// Matched on abbreviation, which is not translated.
healthcare.nursing.PAIN_SCORE_ABBR = "PAIN";

healthcare.nursing.RAIL = [
	{
		label: __("Observations"),
		actions: [
			{ name: "vitals", label: __("Vitals & Pain") },
			{ name: "intake_output", label: __("Intake / Output") },
		],
	},
	{
		label: __("Administration"),
		actions: [
			{ name: "medication", label: __("Medication") },
			{ name: "consumables", label: __("Consumables") },
		],
	},
	{
		label: __("Documentation"),
		actions: [
			{ name: "fdar", label: __("F-DAR Note") },
			{ name: "progress_note", label: __("Progress Note") },
			{ name: "handover", label: __("Shift Handover") },
			{ name: "care_plan", label: __("Care Plan") },
		],
	},
];

healthcare.nursing.NursingWorkspace = class NursingWorkspace {
	constructor(options) {
		Object.assign(this, options);
		this.pane = null;
		this.source_patient = this.patient;
		this.source_doctype = this.reference_doctype;
		this.source_name = this.reference_name;
		this.make_dialog();
	}

	make_dialog() {
		this.dialog = new frappe.ui.Dialog({
			title: __("Nursing Workspace"),
			size: "extra-large",
			primary_action_label: __("Save"),
			primary_action: () => this.save(),
			secondary_action_label: __("Close"),
			secondary_action: () => this.dialog.hide(),
		});
		this.dialog.$wrapper.addClass("nursing-station-dialog");

		// A half-entered observation should not be lost to a stray click or Esc.
		// `show: false` configures the modal without opening it here.
		this.dialog.$wrapper.modal({
			backdrop: "static",
			keyboard: false,
			show: false,
		});
		this.render_layout();
		this.render_banner();
		this.render_rail();
		this.make_snapshot();
		this.select_action("vitals");
	}

	render_layout() {
		this.dialog.$body.html(`
			<div class="nursing-banner">
				<div class="nursing-banner-info"></div>
				<div class="nursing-banner-search"></div>
			</div>
			<div class="nursing-station">
				<div class="nursing-rail"></div>
				<div class="nursing-pane"></div>
				<div class="nursing-snapshot"></div>
			</div>
		`);
		this.$banner = this.dialog.$body.find(".nursing-banner-info");
		this.make_search();
		this.$rail = this.dialog.$body.find(".nursing-rail");
		this.$pane = this.dialog.$body.find(".nursing-pane");
	}

	// A wristband scanner types the value and presses Enter.
	make_search() {
		this.search = frappe.ui.form.make_control({
			parent: this.dialog.$body.find(".nursing-banner-search"),
			df: {
				fieldtype: "Data",
				fieldname: "patient_search",
				placeholder: __("Scan wristband or search patient"),
				change: () => {},
			},
			render_input: true,
		});
		this.search.$input.on("keydown", event => {
			if (event.key !== "Enter") return;

			event.preventDefault();
			this.find_patient(this.search.get_value());
		});
	}

	async find_patients(term) {
		return frappe.xcall(healthcare.nursing.FIND_PATIENTS_METHOD, {
			term: term,
			admitted_only: this.source_doctype === "Inpatient Record" ? 1 : 0,
		});
	}

	async find_patient(term) {
		const patients = await this.find_patients(term);

		if (!patients.length) {
			frappe.show_alert({ message: __("No patient found"), indicator: "orange" });
			return;
		}

		if (patients.length === 1) {
			this.set_match(patients[0]);
			return;
		}

		this.ask_which_patient(patients);
	}

	set_match(match) {
		this.set_patient(match.name, match.reference_doctype, match.reference_name);
	}

	ask_which_patient(patients) {
		frappe.prompt(
			{
				fieldtype: "Select",
				fieldname: "patient",
				label: __("Patient"),
				options: patients.map(patient => ({
					value: patient.name,
					label: patient.matched_via
						? `${patient.patient_name} · ${__(patient.matched_via)}`
						: `${patient.patient_name} · ${patient.name}`,
				})),
				reqd: 1,
			},
			values =>
				this.set_match(
					patients.find(patient => patient.name === values.patient),
				),
			__("Select Patient"),
		);
	}

	// Readings belong to the patient in front of the nurse. A record number
	// carries its own document; otherwise the source document only still
	// applies if the patient has not changed.
	set_patient(patient, reference_doctype, reference_name) {
		const same_patient = patient === this.source_patient;

		this.patient = patient;
		this.reference_doctype =
			reference_doctype || (same_patient ? this.source_doctype : null);
		this.reference_name =
			reference_name || (same_patient ? this.source_name : null);

		this.search.set_value("");
		this.snapshot.patient = patient;
		this.snapshot.refresh();
		this.render_banner();
		this.select_action(this.get_selected_action());
	}

	async render_banner() {
		const banner = await frappe.xcall(healthcare.nursing.BANNER_METHOD, {
			patient: this.patient,
			reference_doctype: this.reference_doctype,
			reference_name: this.reference_name,
		});
		this.$banner.html(this.get_banner_html(banner));
	}

	get_banner_html(banner) {
		return `
			<div class="nursing-banner-primary">
				<span class="nursing-banner-name">
					${frappe.utils.escape_html(banner.patient_name || banner.patient)}
				</span>
				${this.get_practitioner_html(banner)}
			</div>
			<div class="nursing-banner-facts">${this.get_banner_facts(banner)}</div>
		`;
	}

	get_practitioner_html(banner) {
		if (!banner.practitioner) return "";

		return `<span class="nursing-banner-doctor">
			<i>${__("Doctor")}</i> ${frappe.utils.escape_html(banner.practitioner)}
		</span>`;
	}

	// Age and gender read as chips; this line carries the identifier, and only
	// when it is not simply the patient's name repeated back.
	get_banner_meta(banner) {
		const identifier = banner.identifier || banner.patient;

		return identifier === banner.patient_name
			? ""
			: frappe.utils.escape_html(identifier);
	}

	get_banner_facts(banner) {
		const facts = [];
		const location = banner.location || {};

		const identifier = this.get_banner_meta(banner);

		if (identifier) facts.push(this.get_fact(__("ID"), identifier));
		if (banner.age) facts.push(this.get_fact(__("Age"), banner.age));
		if (banner.gender) facts.push(this.get_fact(__("Gender"), banner.gender));
		if (location.service_unit)
			facts.push(this.get_fact(__("Bed"), location.service_unit));
		if (location.status) facts.push(this.get_fact(__("Status"), location.status));
		if (banner.blood_group)
			facts.push(this.get_fact(__("Blood"), banner.blood_group));
		if (banner.allergies)
			facts.push(this.get_fact(__("Allergy"), banner.allergies, true));

		return facts.join("");
	}

	get_fact(label, value, is_alert = false) {
		const alert = is_alert ? " nursing-fact-alert" : "";
		return `<span class="nursing-fact${alert}">
			<i>${label}</i> ${frappe.utils.escape_html(String(value))}
		</span>`;
	}

	render_rail() {
		healthcare.nursing.RAIL.forEach(group => this.render_rail_group(group));
		this.$rail.on("click", "[data-action]", event => {
			this.select_action($(event.currentTarget).attr("data-action"));
		});
	}

	render_rail_group(group) {
		this.$rail.append(`<div class="nursing-rail-label">${group.label}</div>`);
		group.actions.forEach(action => this.$rail.append(this.get_rail_item(action)));
	}

	get_rail_item(action) {
		const available = Boolean(healthcare.nursing.panes[action.name]);
		const suffix = available
			? ""
			: `<span class="nursing-rail-soon">${__("Soon")}</span>`;
		return `
			<button type="button" class="nursing-rail-item" data-action="${action.name}"
				${available ? "" : "disabled"}>${action.label}${suffix}</button>
		`;
	}

	make_snapshot() {
		this.snapshot = new healthcare.nursing.Snapshot({
			wrapper: this.dialog.$body.find(".nursing-snapshot"),
			patient: this.patient,
		});
		this.snapshot.refresh();
	}

	select_action(name) {
		const PaneClass = healthcare.nursing.panes[name];
		if (!PaneClass) return;

		this.$rail.find("[data-action]").removeClass("selected");
		this.$rail.find(`[data-action="${name}"]`).addClass("selected");
		this.$pane.empty();
		this.pane = new PaneClass({ wrapper: this.$pane, station: this });
		this.pane.render();
	}

	async save() {
		if (!this.pane) return;

		try {
			await this.pane.save();
		} catch (error) {
			return;
		}

		frappe.show_alert({ message: __("Recorded"), indicator: "green" });
		this.snapshot.refresh();
		this.select_action(this.get_selected_action());
	}

	get_selected_action() {
		return this.$rail.find(".selected").attr("data-action");
	}

	show() {
		this.dialog.show();
	}

	get_context() {
		return {
			patient: this.patient,
			reference_doctype: this.reference_doctype,
			reference_name: this.reference_name,
			practitioner: this.practitioner,
		};
	}
};

healthcare.nursing.open = function (options) {
	const workspace = new healthcare.nursing.NursingWorkspace(options);
	workspace.show();
	return workspace;
};
