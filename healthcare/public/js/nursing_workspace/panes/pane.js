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

	// A table row has no space for a button per outcome, so one Actions button
	// carries them all. A lone action stays a plain button; putting it behind a
	// menu would only add a click.
	render_actions(actions, attributes) {
		if (!actions.length) return "";

		const data = Object.entries(attributes)
			.map(([key, value]) => `data-${key}="${value}"`)
			.join(" ");

		if (actions.length === 1) {
			return `<button type="button" class="btn btn-xs btn-default"
				data-status="${actions[0].status}" ${data}>${actions[0].label}</button>`;
		}

		return `<div class="btn-group btn-group-xs nursing-row-actions">
			<button type="button" class="btn btn-xs btn-default dropdown-toggle"
				data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
				${__("Actions")}
			</button>
			<div class="dropdown-menu dropdown-menu-right">
				${actions
					.map(
						action => `<button type="button" class="dropdown-item"
							data-status="${action.status}" ${data}>${action.label}</button>`,
					)
					.join("")}
			</div>
		</div>`;
	}

	empty(message) {
		return `<div class="nursing-empty">${message}</div>`;
	}

	// columns: [{label, align}], rows rendered by the caller's row builder.
	// A pane with more than one table passes its own target.
	render_table(columns, rows, build_row, empty_message, $target) {
		const $into = $target || this.$rows;
		$into.empty();

		if (!rows.length) {
			$into.html(this.empty(empty_message));
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
		`).appendTo($into);

		const $body = $table.find("tbody");
		rows.forEach(row => $body.append(build_row(row)));
		return $body;
	}
};
