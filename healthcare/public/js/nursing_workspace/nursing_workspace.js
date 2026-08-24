// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

healthcare.nursing.panes = healthcare.nursing.panes || {};

healthcare.nursing.BANNER_METHOD = "healthcare.healthcare.api.nursing.get_banner";

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
			<div class="nursing-banner"></div>
			<div class="nursing-station">
				<div class="nursing-rail"></div>
				<div class="nursing-pane"></div>
				<div class="nursing-snapshot"></div>
			</div>
		`);
		this.$banner = this.dialog.$body.find(".nursing-banner");
		this.$rail = this.dialog.$body.find(".nursing-rail");
		this.$pane = this.dialog.$body.find(".nursing-pane");
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
			<div class="nursing-banner-who">
				<span class="nursing-banner-name">
					${frappe.utils.escape_html(banner.patient_name || banner.patient)}
				</span>
				<span class="nursing-banner-meta">${this.get_banner_meta(banner)}</span>
			</div>
			<div class="nursing-banner-facts">${this.get_banner_facts(banner)}</div>
		`;
	}

	get_banner_meta(banner) {
		return [banner.age, banner.gender, banner.identifier || banner.patient]
			.filter(Boolean)
			.map(part => frappe.utils.escape_html(String(part)))
			.join(" · ");
	}

	get_banner_facts(banner) {
		const facts = [];
		const location = banner.location || {};

		if (banner.practitioner)
			facts.push(this.get_fact(__("Doctor"), banner.practitioner));
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
