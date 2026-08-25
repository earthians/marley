// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

// What every pane in the workspace shares: a heading, frappe controls laid out
// in the field grid, and a table of what has been recorded.
healthcare.nursing.Pane = class Pane {
	constructor({ wrapper, station }) {
		this.$wrapper = $(wrapper);
		this.station = station;
	}

	get patient() {
		return this.station.patient;
	}

	render_head(title) {
		this.$wrapper.html(`
			<div class="nursing-pane-head">
				<div class="nursing-pane-title">${title}</div>
			</div>
			<div class="nursing-fields"></div>
			<div class="nursing-pane-actions"></div>
			<div class="nursing-rows"></div>
		`);
		this.$fields = this.$wrapper.find(".nursing-fields");
		this.$actions = this.$wrapper.find(".nursing-pane-actions");
		this.$rows = this.$wrapper.find(".nursing-rows");
	}

	make_control(df) {
		const $field = $(`<div class="nursing-field"></div>`).appendTo(this.$fields);
		return frappe.ui.form.make_control({
			parent: $field,
			df: df,
			render_input: true,
		});
	}

	add_button(label, action, style = "primary") {
		return $(
			`<button type="button" class="btn btn-xs btn-${style}">${label}</button>`,
		)
			.appendTo(this.$actions)
			.on("click", action);
	}

	empty(message) {
		return `<div class="nursing-empty">${message}</div>`;
	}

	// columns: [{label, align}], rows rendered by the caller's row builder.
	render_table(columns, rows, build_row, empty_message) {
		this.$rows.empty();

		if (!rows.length) {
			this.$rows.html(this.empty(empty_message));
			return null;
		}

		const headings = columns
			.map(
				column =>
					`<th class="${column.align ? `text-${column.align}` : ""}">${
						column.label
					}</th>`,
			)
			.join("");

		const $table = $(`
			<table class="table table-sm nursing-table">
				<thead><tr>${headings}</tr></thead>
				<tbody></tbody>
			</table>
		`).appendTo(this.$rows);

		const $body = $table.find("tbody");
		rows.forEach(row => $body.append(build_row(row)));
		return $body;
	}
};
