// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

healthcare.nursing.panes = healthcare.nursing.panes || {};

healthcare.nursing.RAIL = [
	{
		label: __("Observations"),
		actions: [
			{ name: "vitals", label: __("Vitals") },
			{ name: "pain", label: __("Pain Score") },
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

healthcare.nursing.NursingStation = class NursingStation {
	constructor(options) {
		Object.assign(this, options);
		this.pane = null;
		this.make_dialog();
	}

	make_dialog() {
		this.dialog = new frappe.ui.Dialog({
			title: __("Nursing Station"),
			size: "extra-large",
			primary_action_label: __("Save"),
			primary_action: () => this.save(),
		});
		this.dialog.$wrapper.addClass("nursing-station-dialog");
		this.render_layout();
		this.render_rail();
		this.make_snapshot();
		this.select_action("vitals");
	}

	render_layout() {
		this.dialog.$body.html(`
			<div class="nursing-station">
				<div class="nursing-rail"></div>
				<div class="nursing-pane"></div>
				<div class="nursing-snapshot"></div>
			</div>
		`);
		this.$rail = this.dialog.$body.find(".nursing-rail");
		this.$pane = this.dialog.$body.find(".nursing-pane");
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
	const station = new healthcare.nursing.NursingStation(options);
	station.show();
	return station;
};
