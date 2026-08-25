// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

healthcare.nursing.TEMPLATES_METHOD =
	"healthcare.healthcare.api.vitals.get_vital_sign_templates";
healthcare.nursing.RECORD_VITALS_METHOD =
	"healthcare.healthcare.api.vitals.record_vitals";

healthcare.nursing.PAIN_SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Severity bands a score falls into, lowest first.
healthcare.nursing.PAIN_BANDS = [
	{ label: __("Mild"), from: 0, to: 3, indicator: "green" },
	{ label: __("Moderate"), from: 4, to: 6, indicator: "orange" },
	{ label: __("Severe"), from: 7, to: 10, indicator: "red" },
];

healthcare.nursing.get_pain_band = function (score) {
	return healthcare.nursing.PAIN_BANDS.find(
		band => score >= band.from && score <= band.to,
	);
};

// Readings that belong in one field, in the order the pair is spoken.
healthcare.nursing.VITALS_GROUPS = [
	{
		label: __("Blood Pressure"),
		separator: "/",
		abbrs: ["BPS", "BPD"],
		placeholders: { BPS: __("Systolic"), BPD: __("Diastolic") },
	},
];

healthcare.nursing.panes.vitals = class VitalsPane extends healthcare.nursing.Pane {
	constructor(options) {
		super(options);
		this.controls = {};
	}

	async render() {
		this.templates = await frappe.xcall(healthcare.nursing.TEMPLATES_METHOD);
		this.render_header();
		this.render_fields();
	}

	render_header() {
		this.$wrapper.html(`
			<div class="nursing-pane-head">
				<div class="nursing-pane-title">${__("Record Vitals")}</div>
			</div>
			<div class="nursing-fields"></div>
			<div class="nursing-pane-actions"></div>
		`);
		this.$fields = this.$wrapper.find(".nursing-fields");
		this.render_save();
	}

	render_save() {
		this.$save = $(
			`<button type="button" class="btn btn-sm btn-primary">${__(
				"Save Vitals",
			)}</button>`,
		)
			.appendTo(this.$wrapper.find(".nursing-pane-actions"))
			.on("click", () => this.station.commit());
	}

	render_fields() {
		if (!this.templates.length) {
			this.$fields.html(`<div class="nursing-empty">
				${__("No Observation Templates found under the Vital Signs category")}
			</div>`);
			return;
		}
		const pain = this.templates.find(
			template => template.abbr === healthcare.nursing.PAIN_SCORE_ABBR,
		);
		const measurements = this.templates.filter(
			template => template.abbr !== healthcare.nursing.PAIN_SCORE_ABBR,
		);

		this.render_measurements(measurements);
		if (pain) this.render_pain(pain);
	}

	render_measurements(templates) {
		const singles = templates.filter(template => !this.get_group(template.abbr));
		singles.forEach(template => this.make_reading(template));

		this.get_used_groups(templates).forEach(group =>
			this.make_group(group, templates),
		);
	}

	get_used_groups(templates) {
		const abbrs = templates.map(template => template.abbr);
		return healthcare.nursing.VITALS_GROUPS.filter(group =>
			group.abbrs.some(abbr => abbrs.includes(abbr)),
		);
	}

	get_group(abbr) {
		return healthcare.nursing.VITALS_GROUPS.find(group =>
			group.abbrs.includes(abbr),
		);
	}

	// Systolic and diastolic read as one measurement, so they share one field.
	make_group(group, templates) {
		const $field = $(`
			<div class="nursing-field nursing-field-group">
				<label class="control-label">${group.label}</label>
				<div class="nursing-group"></div>
			</div>
		`).appendTo(this.$fields);

		const $group = $field.find(".nursing-group");
		const members = group.abbrs
			.map(abbr => templates.find(template => template.abbr === abbr))
			.filter(Boolean);

		members.forEach((template, index) => {
			if (index) {
				$group.append(
					`<span class="nursing-group-separator">${group.separator}</span>`,
				);
			}
			this.make_group_control(template, group, $group);
		});

		const unit = members[0] && members[0].permitted_unit;
		if (unit) $field.append(`<div class="nursing-group-unit">${unit}</div>`);
	}

	make_group_control(template, group, $group) {
		const $slot = $(`<div class="nursing-group-slot"></div>`).appendTo($group);
		this.controls[template.name] = frappe.ui.form.make_control({
			parent: $slot,
			df: {
				fieldtype: "Data",
				fieldname: template.name,
				placeholder: group.placeholders[template.abbr] || template.observation,
			},
			render_input: true,
		});
	}

	render_pain(template) {
		$(`<div class="nursing-section-break"></div>`).appendTo(this.$fields);
		this.make_scale(template);
	}

	make_reading(template) {
		const $field = $(`<div class="nursing-field"></div>`).appendTo(this.$fields);
		this.controls[template.name] = frappe.ui.form.make_control({
			parent: $field,
			df: this.get_field_definition(template),
			render_input: true,
		});
	}

	// A pain score is picked, not typed. Duck-types get_value() so it reads
	// back exactly like a frappe control.
	make_scale(template) {
		const label = template.observation || template.name;
		const $field = $(`
			<div class="nursing-field nursing-field-wide">
				<label class="control-label">
					${label} <span class="nursing-scale-band"></span>
				</label>
				<div class="nursing-scale">
					${healthcare.nursing.PAIN_SCALE.map(this.get_scale_step).join("")}
				</div>
				<div class="nursing-scale-legend">
					<span>${__("No Pain")}</span>
					<span>${__("Severe Pain")}</span>
				</div>
			</div>
		`).appendTo(this.$fields);

		const $scale = $field.find(".nursing-scale");
		const $band = $field.find(".nursing-scale-band");

		$scale.on("click", "[data-score]", event => {
			const $step = $(event.currentTarget);
			$scale.find("[data-score]").removeClass("selected");
			$step.addClass("selected");
			this.show_band($band, Number($step.attr("data-score")));
		});

		this.controls[template.name] = {
			get_value: () => $scale.find(".selected").attr("data-score"),
		};
	}

	show_band($band, score) {
		const band = healthcare.nursing.get_pain_band(score);
		if (!band) return;

		$band
			.attr("class", `nursing-scale-band indicator-pill ${band.indicator}`)
			.text(band.label);
	}

	get_scale_step(score) {
		const band = healthcare.nursing.get_pain_band(score);
		return `<button type="button" class="nursing-scale-step nursing-band-${band.indicator}"
			data-score="${score}">${score}</button>`;
	}

	get_field_definition(template) {
		return {
			fieldtype: template.permitted_data_type === "Text" ? "Small Text" : "Data",
			fieldname: template.name,
			label: template.observation || template.name,
			description: template.permitted_unit || "",
		};
	}

	get_readings() {
		const readings = {};
		Object.keys(this.controls).forEach(name => {
			const value = this.controls[name].get_value();
			if (value !== undefined && String(value).trim() !== "") {
				readings[name] = value;
			}
		});
		return readings;
	}

	async save() {
		const readings = this.get_readings();

		if (!Object.keys(readings).length) {
			frappe.throw(__("Enter at least one reading"));
		}

		return frappe.xcall(healthcare.nursing.RECORD_VITALS_METHOD, {
			...this.station.get_context(),
			readings: readings,
		});
	}
};
