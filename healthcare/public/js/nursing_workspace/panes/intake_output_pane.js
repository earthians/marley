// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

healthcare.nursing.IO_TYPES_METHOD =
	"healthcare.healthcare.api.nursing.get_intake_output_types";
healthcare.nursing.IO_SUMMARY_METHOD =
	"healthcare.healthcare.api.nursing.get_intake_output_summary";
healthcare.nursing.RECORD_IO_METHOD =
	"healthcare.healthcare.api.nursing.record_intake_output";

// Rows are saved as they are added, so the balance is always what is on record.
healthcare.nursing.panes.intake_output = class IntakeOutputPane {
	constructor({ wrapper, station }) {
		this.$wrapper = $(wrapper);
		this.station = station;
	}

	async render() {
		this.types = await frappe.xcall(healthcare.nursing.IO_TYPES_METHOD);
		this.render_layout();
		this.make_controls();
		await this.refresh_rows();
	}

	render_layout() {
		this.$wrapper.html(`
			<div class="nursing-pane-head">
				<div class="nursing-pane-title">${__("Record Intake & Output")}</div>
			</div>
			<div class="nursing-fields"></div>
			<div class="nursing-io-add"></div>
			<div class="nursing-io-rows"></div>
		`);
		this.$fields = this.$wrapper.find(".nursing-fields");
		this.$rows = this.$wrapper.find(".nursing-io-rows");

		this.$add = $(
			`<button type="button" class="btn btn-xs btn-primary">${__(
				"Add Row",
			)}</button>`,
		)
			.appendTo(this.$wrapper.find(".nursing-io-add"))
			.on("click", () => this.add_row());
	}

	make_controls() {
		this.controls = {
			intake_output_type: this.make_control({
				fieldtype: "Select",
				fieldname: "intake_output_type",
				label: __("Type"),
				options: this.get_type_options(),
			}),
			volume: this.make_control({
				fieldtype: "Float",
				fieldname: "volume",
				label: __("Volume"),
				description: __("mL"),
			}),
			description: this.make_control({
				fieldtype: "Data",
				fieldname: "description",
				label: __("Description"),
			}),
			recorded_at: this.make_control({
				fieldtype: "Datetime",
				fieldname: "recorded_at",
				label: __("Recorded At"),
			}),
		};
		this.reset_controls();
	}

	// Types are grouped by direction so intake and output do not interleave.
	get_type_options() {
		return this.types.map(type => ({
			value: type.name,
			label: `${__(type.direction)} · ${__(type.name)}`,
		}));
	}

	make_control(df) {
		const $field = $(`<div class="nursing-field"></div>`).appendTo(this.$fields);
		return frappe.ui.form.make_control({
			parent: $field,
			df: df,
			render_input: true,
		});
	}

	read_controls() {
		return {
			intake_output_type: this.controls.intake_output_type.get_value(),
			volume: flt(this.controls.volume.get_value()),
			description: this.controls.description.get_value(),
			recorded_at: this.controls.recorded_at.get_value(),
		};
	}

	reset_controls() {
		this.controls.volume.set_value("");
		this.controls.description.set_value("");
		this.controls.recorded_at.set_value(frappe.datetime.now_datetime());
	}

	has_entry() {
		const row = this.read_controls();
		return Boolean(row.intake_output_type) && row.volume > 0;
	}

	async add_row() {
		const row = this.read_controls();

		if (!row.intake_output_type) frappe.throw(__("Select a type"));
		if (!row.volume || row.volume <= 0)
			frappe.throw(__("Enter a volume greater than zero"));

		this.$add.prop("disabled", true);
		try {
			await frappe.xcall(healthcare.nursing.RECORD_IO_METHOD, {
				...this.station.get_context(),
				entries: [row],
			});
		} finally {
			this.$add.prop("disabled", false);
		}

		frappe.show_alert({ message: __("Row added"), indicator: "green" });
		this.reset_controls();
		await this.refresh_rows();
	}

	async refresh_rows() {
		this.summary = await frappe.xcall(healthcare.nursing.IO_SUMMARY_METHOD, {
			patient: this.station.patient,
		});
		this.render_rows();
	}

	render_rows() {
		this.$rows.empty();
		this.render_entries();
		this.render_totals();
	}

	render_entries() {
		if (!this.summary.entries.length) {
			this.$rows.append(
				`<div class="nursing-empty">${__("Nothing recorded yet")}</div>`,
			);
			return;
		}

		const $table = $(`
			<table class="table table-sm nursing-io-table">
				<thead>
					<tr>
						<th>${__("Type")}</th>
						<th>${__("Description")}</th>
						<th class="text-right">${__("Volume")}</th>
						<th class="text-right">${__("Recorded At")}</th>
					</tr>
				</thead>
				<tbody></tbody>
			</table>
		`).appendTo(this.$rows);

		const $body = $table.find("tbody");
		this.summary.entries.forEach(entry => $body.append(this.get_row_html(entry)));
	}

	get_row_html(entry) {
		return `<tr>
			<td>${frappe.utils.escape_html(entry.intake_output_type)}
				<span class="text-muted">· ${__(entry.direction)}</span></td>
			<td>${frappe.utils.escape_html(entry.description || "")}</td>
			<td class="text-right">${format_number(entry.volume)} ${frappe.utils.escape_html(
				entry.uom || "",
			)}</td>
			<td class="text-right text-muted">${frappe.datetime.str_to_user(entry.recorded_at)}</td>
		</tr>`;
	}

	render_totals() {
		const { intake, output, balance, hours } = this.summary;

		this.$rows.append(`
			<div class="nursing-io-totals">
				<span>${__("Intake")} <b>${format_number(intake)}</b></span>
				<span>${__("Output")} <b>${format_number(output)}</b></span>
				<span>${__("Balance")} <b>${format_number(balance)}</b></span>
				<span class="text-muted">${__("last {0} hours", [hours])}</span>
			</div>
		`);
	}

	// Rows save as they are added; Save only picks up a row left in the form.
	async save() {
		if (!this.has_entry()) return;

		return this.add_row();
	}
};
