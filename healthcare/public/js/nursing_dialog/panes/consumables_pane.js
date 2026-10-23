// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.nursing");

healthcare.nursing.CONSUMABLE_CONTEXT_METHOD =
	"healthcare.healthcare.api.consumables.get_consumable_context";
healthcare.nursing.CONSUMABLES_METHOD =
	"healthcare.healthcare.api.consumables.get_consumables";
healthcare.nursing.RECORD_CONSUMABLES_METHOD =
	"healthcare.healthcare.api.consumables.record_consumables";

// Items are issued from the ward as they are added, like intake and output.
healthcare.nursing.panes.consumables = class ConsumablesPane extends (
	healthcare.nursing.Pane
) {
	async render() {
		this.context = await frappe.xcall(
			healthcare.nursing.CONSUMABLE_CONTEXT_METHOD,
			{
				patient: this.station.patient,
			},
		);
		this.render_layout();

		if (!this.context.inpatient_record) {
			this.$body.html(
				`<div class="nursing-empty">${__(
					"Consumables are recorded against an admission",
				)}</div>`,
			);
			return;
		}

		this.make_controls();
		await this.refresh_rows();
	}

	render_layout() {
		this.$wrapper.html(`
			<div class="nursing-pane-head">
				<div class="nursing-pane-title">${__("Record Consumables")}</div>
			</div>
			<div class="nursing-consumables"></div>
		`);
		this.$body = this.$wrapper.find(".nursing-consumables");
	}

	make_controls() {
		this.$body.html(`
			<div class="nursing-fields"></div>
			<div class="nursing-pane-actions"></div>
			<div class="nursing-rows"></div>
		`);
		this.$fields = this.$body.find(".nursing-fields");
		this.$rows = this.$body.find(".nursing-rows");

		this.controls = {
			item_code: this.make_control({
				fieldtype: "Link",
				fieldname: "item_code",
				label: __("Item"),
				options: "Item",
				get_query: () => ({ filters: { is_stock_item: 1 } }),
			}),
			quantity: this.make_control({
				fieldtype: "Float",
				fieldname: "quantity",
				label: __("Quantity"),
			}),
			batch_no: this.make_control({
				fieldtype: "Link",
				fieldname: "batch_no",
				label: __("Batch"),
				options: "Batch",
				// The standard query keeps this to batches of the chosen item that
				// are actually in the ward store and not past their expiry.
				get_query: () => ({
					query: "erpnext.controllers.queries.get_batch_no",
					filters: {
						item_code: this.controls.item_code.get_value(),
						warehouse: this.context.warehouse,
						posting_date: frappe.datetime.now_date(),
					},
				}),
			}),
		};

		this.$add = $(
			`<button type="button" class="btn btn-xs btn-primary">${__(
				"Add Item",
			)}</button>`,
		)
			.appendTo(this.$body.find(".nursing-pane-actions"))
			.on("click", () => this.add_item());
	}

	read_controls() {
		return {
			item_code: this.controls.item_code.get_value(),
			quantity: flt(this.controls.quantity.get_value()),
			batch_no: this.controls.batch_no.get_value(),
		};
	}

	async add_item() {
		const item = this.read_controls();

		if (!item.item_code) frappe.throw(__("Select an item"));
		if (!item.quantity || item.quantity <= 0) frappe.throw(__("Enter a quantity"));

		this.$add.prop("disabled", true);
		try {
			await frappe.xcall(healthcare.nursing.RECORD_CONSUMABLES_METHOD, {
				patient: this.station.patient,
				items: [item],
			});
		} finally {
			this.$add.prop("disabled", false);
		}

		frappe.show_alert({ message: __("Issued from the ward"), indicator: "green" });
		this.reset_controls();
		await this.refresh_rows();
	}

	reset_controls() {
		this.controls.item_code.set_value("");
		this.controls.quantity.set_value("");
		this.controls.batch_no.set_value("");
	}

	async refresh_rows() {
		this.rows = await frappe.xcall(healthcare.nursing.CONSUMABLES_METHOD, {
			patient: this.station.patient,
		});
		this.render_rows();
	}

	render_rows() {
		this.$rows.empty();

		if (!this.rows.length) {
			this.$rows.html(
				`<div class="nursing-empty">${__("Nothing used yet")}</div>`,
			);
			return;
		}

		const $table = $(`
			<table class="table table-sm nursing-table">
				<thead>
					<tr>
						<th>${__("Item")}</th>
						<th class="text-right">${__("Quantity")}</th>
						<th class="text-right">${__("Billed")}</th>
					</tr>
				</thead>
				<tbody></tbody>
			</table>
		`).appendTo(this.$rows);

		const $body = $table.find("tbody");
		this.rows.forEach(row => $body.append(this.get_row_html(row)));
	}

	get_row_html(row) {
		return `<tr>
			<td><b>${frappe.utils.escape_html(row.item_name || row.item_code)}</b></td>
			<td class="text-right">${format_number(row.quantity)} ${frappe.utils.escape_html(
				row.uom || "",
			)}</td>
			<td class="text-right text-muted">${row.invoiced ? __("Invoiced") : __("Pending")}</td>
		</tr>`;
	}
};
