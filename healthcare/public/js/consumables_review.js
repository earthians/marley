// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare");

// Shows consumables before they are issued, so staff can correct them.
// Each row has row_name, item_code, qty and batch_no, plus consumed_at on a form
// or observation on an approval. review() resolves with the edited values, or
// null when the user backs out.
healthcare.ConsumablesReview = class ConsumablesReview {
	constructor({ title, action_label, rows, warehouse, company }) {
		this.title = title;
		this.action_label = action_label;
		this.rows = rows;
		this.warehouse = warehouse;
		this.company = company;
		this.for_approval = rows.some(row => row.observation);
		// A container an earlier collect counted: staff say whether this one was new.
		this.asks_new_container = rows.some(row => flt(row.suggested_qty) > 0);
	}

	static for_form(frm, action_label) {
		// A corrected result keeps the original's issue, so there is nothing left to issue.
		const issuable = frm.doc.consume_stock && !frm.doc.stock_entry;
		const rows = issuable ? (frm.doc.consumables || []).filter(is_pending) : [];
		return new healthcare.ConsumablesReview({
			title: __("Review Consumables"),
			action_label: action_label,
			rows: rows.map(row => ({
				row_name: row.name,
				item_code: row.item_code,
				consumed_at: row.consumed_at,
				qty: row.qty,
				suggested_qty: row.suggested_qty,
				batch_no: row.batch_no,
			})),
			warehouse: frm.doc.warehouse,
			company: frm.doc.company,
		});
	}

	// Collecting adds supplies; review them and issue them now, so no result waits.
	static async issue_collection(frm) {
		const values = await healthcare.ConsumablesReview.for_form(
			frm,
			__("Confirm and Issue"),
		).review();
		if (!values || !values.items.length) return;

		await frappe.call({
			method: "healthcare.healthcare.doctype.sample_collection.collection_consumables.issue_collection_consumables",
			args: {
				sample_collection: frm.doc.name,
				rows: values.items,
				warehouse: values.warehouse,
			},
		});
		await frm.reload_doc();
	}

	// Batches of the item with stock in the warehouse it is issued from.
	static batch_query(item_code, warehouse) {
		const filters = {
			item_code: item_code,
			posting_date: frappe.datetime.nowdate(),
		};
		if (warehouse) filters.warehouse = warehouse;
		return { query: "erpnext.controllers.queries.get_batch_no", filters: filters };
	}

	// The form's own consumables table offers the same batches as the review.
	static set_batch_query(frm) {
		frm.set_query("batch_no", "consumables", (doc, cdt, cdn) =>
			healthcare.ConsumablesReview.batch_query(
				locals[cdt][cdn].item_code,
				doc.warehouse,
			),
		);
	}

	// Edits go onto the form's own rows, which the submit then saves.
	static async apply_to_form(frm, values) {
		await frm.set_value("warehouse", values.warehouse);
		for (const item of values.items) {
			await frappe.model.set_value(
				frm.fields_dict.consumables.df.options,
				item.row_name,
				{
					qty: item.qty,
					batch_no: item.batch_no || "",
				},
			);
		}
	}

	review() {
		if (!this.rows.length) return Promise.resolve({ items: [] });

		return new Promise(resolve => {
			let confirmed = false;
			const dialog = new frappe.ui.Dialog({
				title: this.title,
				size: "large",
				fields: this.fields(),
				primary_action_label: this.action_label,
				primary_action: values => {
					confirmed = true;
					dialog.hide();
					resolve({
						...values,
						items: this.confirmed_items(values.items || []),
					});
				},
			});
			dialog.onhide = () => !confirmed && resolve(null);
			this.dialog = dialog;
			dialog.show();
		});
	}

	// A ticked New Container takes the full quantity. shown_qty is what each row
	// showed, so the server can refuse a row that changed meanwhile.
	confirmed_items(items) {
		const rows = Object.fromEntries(this.rows.map(row => [row.row_name, row]));
		return items.map(item => {
			const row = rows[item.row_name];
			const qty = item.new_container ? row.suggested_qty : item.qty;
			return { ...item, qty: qty, shown_qty: row.qty };
		});
	}

	fields() {
		const fields = [];
		if (!this.for_approval) {
			fields.push({
				fieldname: "warehouse",
				fieldtype: "Link",
				options: "Warehouse",
				label: __("Issue From"),
				reqd: 1,
				default: this.warehouse,
				get_query: () => ({ filters: { company: this.company, is_group: 0 } }),
			});
		}
		fields.push(
			{
				fieldname: "items",
				fieldtype: "Table",
				label: __("Consumables"),
				cannot_add_rows: true,
				cannot_delete_rows: true,
				in_place_edit: true,
				data: this.rows.map(row => ({
					...row,
					observation: this.observation_label(row),
				})),
				fields: this.item_fields(),
			},
			{
				fieldname: "hint",
				fieldtype: "HTML",
				options: `<p class="text-muted small">${this.hint()}</p>`,
			},
		);
		return fields;
	}

	hint() {
		const hint = __("Set a quantity to 0 to leave an item out.");
		if (!this.asks_new_container) return hint;
		return `${hint} ${__(
			"Tick New Container when this collect used a new tube or draw instead of one counted earlier.",
		)}`;
	}

	observation_label(row) {
		return row.warehouse
			? `${row.observation} (${row.warehouse})`
			: row.observation;
	}

	item_fields() {
		const context = this.for_approval
			? {
					fieldname: "observation",
					label: __("Observation (Issue From)"),
					columns: 3,
			  }
			: { fieldname: "consumed_at", label: __("Consumed At"), columns: 2 };
		return [
			{ fieldname: "row_name", fieldtype: "Data", hidden: 1 },
			{ ...context, fieldtype: "Data", read_only: 1, in_list_view: 1 },
			{
				fieldname: "item_code",
				fieldtype: "Link",
				options: "Item",
				label: __("Item"),
				read_only: 1,
				in_list_view: 1,
				columns: this.for_approval || this.asks_new_container ? 3 : 4,
			},
			{
				fieldname: "qty",
				fieldtype: "Float",
				label: __("To Issue"),
				in_list_view: 1,
				columns: 2,
			},
			...this.new_container_field(),
			{
				fieldname: "batch_no",
				fieldtype: "Link",
				options: "Batch",
				label: __("Batch"),
				in_list_view: 1,
				columns: 2,
				// An approval row carries its Observation's warehouse; a collection
				// issues from the warehouse chosen above the table.
				get_query: row =>
					healthcare.ConsumablesReview.batch_query(
						row.item_code,
						row.warehouse || this.dialog.get_value("warehouse"),
					),
			},
		];
	}

	new_container_field() {
		if (!this.asks_new_container) return [];
		return [
			{
				fieldname: "new_container",
				fieldtype: "Check",
				label: __("New Container"),
				in_list_view: 1,
				columns: 1,
			},
		];
	}
};

// Issued rows are fixed; more of an item arrives on a row of its own.
function is_pending(row) {
	return !row.stock_entry;
}

// Before approving, show what the approval will issue and save any edits.
// `args` is { observation } or { diagnostic_report }. Resolves false when the user backs out.
healthcare.review_approval_consumables = async function (args) {
	const { message: rows } = await frappe.call({
		method: "healthcare.healthcare.doctype.observation.approval_consumables.get_approval_consumables",
		args: args,
	});
	const values = await new healthcare.ConsumablesReview({
		title: __("Review Consumables"),
		action_label: __("Confirm and Approve"),
		rows: rows || [],
	}).review();
	if (!values) return false;

	if (values.items.length) {
		await frappe.call({
			method: "healthcare.healthcare.doctype.observation.approval_consumables.update_approval_consumables",
			args: { rows: values.items },
		});
	}
	return true;
};
