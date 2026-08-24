// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

healthcare.nursing.TEMPLATES_METHOD =
	"healthcare.healthcare.api.nursing.get_vital_sign_templates";
healthcare.nursing.RECORD_VITALS_METHOD =
	"healthcare.healthcare.api.nursing.record_vitals";

healthcare.nursing.panes.vitals = class VitalsPane {
	constructor({ wrapper, station }) {
		this.$wrapper = $(wrapper);
		this.station = station;
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
				<div class="nursing-pane-subtitle">
					${__("Saved as Observations under the Vital Signs category")}
				</div>
			</div>
			<div class="nursing-fields"></div>
		`);
		this.$fields = this.$wrapper.find(".nursing-fields");
	}

	render_fields() {
		if (!this.templates.length) {
			this.$fields.html(`<div class="nursing-empty">
				${__("No Observation Templates found under the Vital Signs category")}
			</div>`);
			return;
		}
		this.templates.forEach(template => this.make_control(template));
	}

	make_control(template) {
		const $field = $(`<div class="nursing-field"></div>`).appendTo(this.$fields);
		this.controls[template.name] = frappe.ui.form.make_control({
			parent: $field,
			df: this.get_field_definition(template),
			render_input: true,
		});
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
