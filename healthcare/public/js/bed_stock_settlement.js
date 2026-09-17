// Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("healthcare.inpatient");

const API = "healthcare.healthcare.api.bed_stock";

// Settles the medication left at a patient's bed before they are discharged:
// back to the pharmacy for nothing, or onto the bill if they take it home.
healthcare.inpatient.BedStockSettlement = class BedStockSettlement {
	static attach(frm) {
		if (frm.doc.__islocal || frm.doc.status !== "Discharge Scheduled") {
			return;
		}
		new BedStockSettlement(frm).add_button();
	}

	constructor(frm) {
		this.frm = frm;
	}

	add_button() {
		frappe
			.xcall(`${API}.get_bed_stock`, { inpatient_record: this.frm.doc.name })
			.then(stock => {
				if (!stock.items.length) {
					return;
				}
				this.frm.add_custom_button(__("Settle Bed Stock"), () =>
					this.show(stock),
				);
			});
	}

	show(stock) {
		this.dialog = new frappe.ui.Dialog({
			title: __("Settle Bed Stock"),
			fields: this.fields(stock),
			primary_action_label: __("Return to Pharmacy"),
			primary_action: values => this.return_to_pharmacy(values.warehouse),
			secondary_action_label: __("Sell to Patient"),
			secondary_action: () => this.sell_to_patient(),
		});
		this.dialog.show();
	}

	fields(stock) {
		return [
			{
				fieldname: "items",
				fieldtype: "Table",
				label: __("Left at {0}", [stock.warehouse]),
				cannot_add_rows: true,
				cannot_delete_rows: true,
				in_place_edit: true,
				data: stock.items,
				fields: this.item_fields(),
			},
			{
				fieldname: "warehouse",
				fieldtype: "Link",
				label: __("Return to Warehouse"),
				options: "Warehouse",
				description: __(
					"Leave blank to sell the leftovers to the patient instead",
				),
				get_query: () => ({
					filters: { company: this.frm.doc.company, is_group: 0 },
				}),
			},
		];
	}

	item_fields() {
		const read_only = { read_only: 1, in_list_view: 1 };
		return [
			{
				fieldname: "item_code",
				fieldtype: "Link",
				options: "Item",
				label: __("Item"),
				...read_only,
			},
			{
				fieldname: "item_name",
				fieldtype: "Data",
				label: __("Item Name"),
				...read_only,
			},
			{
				fieldname: "quantity",
				fieldtype: "Float",
				label: __("Qty"),
				...read_only,
			},
			{
				fieldname: "batch_no",
				fieldtype: "Link",
				options: "Batch",
				label: __("Batch"),
				...read_only,
			},
		];
	}

	return_to_pharmacy(warehouse) {
		if (!warehouse) {
			frappe.msgprint(__("Choose the warehouse the medication goes back to"));
			return;
		}
		frappe
			.xcall(`${API}.return_to_pharmacy`, {
				inpatient_record: this.frm.doc.name,
				warehouse: warehouse,
			})
			.then(transfer => this.open_draft(transfer));
	}

	open_draft(transfer) {
		this.dialog.hide();
		frappe.model.sync(transfer);
		frappe.set_route("Form", transfer.doctype, transfer.name);
	}

	sell_to_patient() {
		frappe
			.xcall(`${API}.sell_to_patient`, { inpatient_record: this.frm.doc.name })
			.then(stock_entry => this.sold(stock_entry));
	}

	sold(stock_entry) {
		this.dialog.hide();
		frappe.show_alert({
			message: __("Issued as {0} and added to the bill", [
				frappe.utils.get_form_link("Stock Entry", stock_entry, true),
			]),
			indicator: "green",
		});
		this.frm.reload_doc();
	}
};
