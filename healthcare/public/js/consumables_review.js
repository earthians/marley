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

	// The one confirmation before collecting: what the collect will use, or
	// `question` when it uses nothing. Resolves with the reviewed values, or null.
	static async before_collect(frm, selected, collect_action, question) {
		const { message: rows } = await frappe.call({
			method: "healthcare.healthcare.doctype.sample_collection.sample_collection.preview_collect",
			args: {
				sample_collection: frm.doc.name,
				selected: JSON.stringify(selected),
				collect_action: collect_action,
			},
		});
		if (!rows || !rows.length) {
			return new Promise(resolve =>
				frappe.confirm(
					question,
					() => resolve({ items: [] }),
					() => resolve(null),
				),
			);
		}
		return new healthcare.ConsumablesReview({
			title: __("Review Consumables"),
			action_label: __("Confirm and Collect"),
			rows: rows,
			warehouse: frm.doc.warehouse,
			company: frm.doc.company,
		}).review();
	}

	// After the collect ran, issue what its review confirmed.
	static issue_collected(frm, collect_action, values) {
		if (!values.items.length) return;
		return frappe.call({
			method: "healthcare.healthcare.doctype.sample_collection.collection_consumables.issue_collect_action",
			args: {
				sample_collection: frm.doc.name,
				collect_action: collect_action,
				rows: values.items,
				warehouse: values.warehouse,
			},
		});
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

	// Submitting issues the form's consumables. When there are any to issue, their
	// review is the one question; otherwise Frappe asks its own.
	static ask_once_before_submit(frm) {
		if (frm.submit_asks_once) return;
		frm.submit_asks_once = true;
		const ask_and_submit = frm.savesubmit.bind(frm);
		frm.savesubmit = (btn, callback, on_error) => {
			frm.validate_form_action("Submit");
			const review = healthcare.ConsumablesReview.for_form(
				frm,
				__("Confirm and Submit"),
			);
			if (!review.rows.length) return ask_and_submit(btn, callback, on_error);
			return review.review().then(async values => {
				if (!values) return frm.handle_save_fail(btn, on_error);
				await healthcare.ConsumablesReview.apply_to_form(frm, values);
				return healthcare.ConsumablesReview.submit(
					frm,
					btn,
					callback,
					on_error,
				);
			});
		};
	}

	// Frappe's savesubmit after its question: before_submit, save, on_submit
	// and the route's after_submit hook.
	static submit(frm, btn, callback, on_error) {
		return new Promise(resolve => {
			frappe.validated = true;
			frm.script_manager.trigger("before_submit").then(() => {
				if (!frappe.validated) return frm.handle_save_fail(btn, on_error);
				frm.save(
					"Submit",
					r => {
						if (r.exc) return frm.handle_save_fail(btn, on_error);
						frappe.utils.play_sound("submit");
						callback && callback();
						frm.script_manager
							.trigger("on_submit")
							.then(() => resolve(frm))
							.then(() => healthcare.ConsumablesReview.after_submit(frm));
					},
					btn,
					() => frm.handle_save_fail(btn, on_error),
					resolve,
				);
			});
		});
	}

	// A screen that opened this form may wait for it to be submitted.
	static after_submit(frm) {
		const route_callback = frappe.route_hooks.after_submit;
		if (!route_callback) return;
		delete frappe.route_hooks.after_submit;
		route_callback(frm);
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

	// shown_qty is what each row first showed, so the server can refuse a row
	// that changed meanwhile.
	confirmed_items(items) {
		const rows = Object.fromEntries(this.rows.map(row => [row.row_name, row]));
		return items.map(item => ({ ...item, shown_qty: rows[item.row_name].qty }));
	}

	// Ticking New Container shows the full quantity; unticking puts back the first one.
	new_container_changed(grid_row) {
		const row = grid_row.doc;
		const first = this.rows.find(shown => shown.row_name === row.row_name);
		row.qty = row.new_container ? first.suggested_qty : first.qty;
		grid_row.refresh_field("qty");
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
		const review = this;
		return [
			{
				fieldname: "new_container",
				fieldtype: "Check",
				label: __("New Container"),
				in_list_view: 1,
				columns: 1,
				onchange: function () {
					review.new_container_changed(this.grid_row);
				},
			},
		];
	}
};

// Issued rows are fixed; more of an item arrives on a row of its own.
function is_pending(row) {
	return !row.stock_entry;
}

// The one confirmation before approving: the consumables review when approval
// issues any, otherwise `question`. `args` is { observation } or { diagnostic_report }.
// Resolves false when the user backs out, after saving any edits otherwise.
healthcare.review_approval_consumables = async function (args, question) {
	const { message: rows } = await frappe.call({
		method: "healthcare.healthcare.doctype.observation.approval_consumables.get_approval_consumables",
		args: args,
	});
	if (!rows || !rows.length) {
		return new Promise(resolve =>
			frappe.confirm(
				question,
				() => resolve(true),
				() => resolve(false),
			),
		);
	}
	const values = await new healthcare.ConsumablesReview({
		title: __("Review Consumables"),
		action_label: __("Confirm and Approve"),
		rows: rows,
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
