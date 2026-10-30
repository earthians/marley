// Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Inpatient Medication Order", {
	refresh: function (frm) {
		if (frm.doc.docstatus === 1) {
			frm.trigger("show_progress");
			frm.events.show_stop_medication_order_button(frm);
		}

		frm.events.show_medication_order_button(frm);
		frm.events.show_get_from_encounter_button(frm);

		frm.set_query("patient", () => {
			return {
				filters: {
					inpatient_record: ["!=", ""],
					inpatient_status: "Admitted",
				},
			};
		});
	},

	show_medication_order_button: function (frm) {
		frm.fields_dict["medication_orders"].grid.wrapper.find(".grid-add-row").hide();
		frm.fields_dict["medication_orders"].grid.add_custom_button(
			__("Add Medication Orders"),
			() => {
				let d = new frappe.ui.Dialog({
					title: __("Add Medication Orders"),
					fields: [
						{
							fieldname: "drug_code",
							label: __("Drug"),
							fieldtype: "Link",
							options: "Item",
							reqd: 1,
							get_query: function () {
								return {
									filters: { is_stock_item: 1 },
								};
							},
						},
						{
							fieldname: "dosage",
							label: __("Dosage"),
							fieldtype: "Link",
							options: "Prescription Dosage",
							reqd: 1,
						},
						{
							fieldname: "period",
							label: __("Period"),
							fieldtype: "Link",
							options: "Prescription Duration",
							reqd: 1,
						},
						{
							fieldname: "dosage_form",
							label: __("Dosage Form"),
							fieldtype: "Link",
							options: "Dosage Form",
							reqd: 1,
						},
					],
					primary_action_label: __("Add"),
					primary_action: () => {
						let values = d.get_values();
						if (values) {
							frm.call({
								doc: frm.doc,
								method: "add_order_entries",
								args: {
									order: values,
								},
								freeze: true,
								freeze_message: __("Adding Order Entries"),
								callback: function () {
									frm.refresh_field("medication_orders");
								},
							});
						}
					},
				});
				d.show();
			},
		);
	},

	show_get_from_encounter_button: function (frm) {
		frm.fields_dict["medication_orders"].grid.add_custom_button(
			__("Get From Encounter"),
			() => {
				if (!frm.doc.patient_encounter) {
					frappe.throw(__("Please select a Patient Encounter to get from"));
				}
				frm.call({
					doc: frm.doc,
					method: "get_from_encounter",
					args: {
						encounter: frm.doc.patient_encounter,
					},
					freeze: true,
					freeze_message: __("Getting From Encounter"),
					callback: function () {
						frm.refresh_field("medication_orders");
					},
				});
			},
		);
	},

	show_stop_medication_order_button: function (frm) {
		const pending_orders = (frm.doc.medication_orders || []).filter(
			row => row.status === "Pending",
		);

		if (!pending_orders.length) {
			return;
		}

		frm.add_custom_button(__("Stop Medication Order"), () => {
			const dialog = new frappe.ui.Dialog({
				title: __("Stop Medication Order"),
				size: "extra-large",
				fields: [
					{
						fieldname: "medication_orders",
						fieldtype: "Table",
						label: __("Pending Medication Orders"),
						cannot_add_rows: true,
						cannot_delete_rows: true,
						in_place_edit: true,
						data: pending_orders.map(row => ({
							name: row.name,
							drug: row.drug,
							drug_name: row.drug_name,
							dosage: row.dosage,
							date: row.date,
							time: row.time,
						})),
						fields: [
							{
								fieldname: "drug",
								fieldtype: "Link",
								label: __("Drug"),
								options: "Item",
								in_list_view: 1,
								read_only: 1,
							},
							{
								fieldname: "drug_name",
								fieldtype: "Data",
								label: __("Drug Name"),
								read_only: 1,
							},
							{
								fieldname: "dosage",
								fieldtype: "Float",
								label: __("Dosage"),
								in_list_view: 1,
								read_only: 1,
							},
							{
								fieldname: "date",
								fieldtype: "Date",
								label: __("Date"),
								in_list_view: 1,
								read_only: 1,
							},
							{
								fieldname: "time",
								fieldtype: "Time",
								label: __("Time"),
								in_list_view: 1,
								read_only: 1,
							},
							{
								fieldname: "name",
								fieldtype: "Data",
								label: __("Row ID"),
								hidden: 1,
								read_only: 1,
							},
						],
					},
					{
						fieldname: "stop_reason",
						fieldtype: "Small Text",
						label: __("Stop Reason"),
						reqd: 1,
					},
				],
				primary_action_label: __("Stop"),
				primary_action: values => {
					const selected = dialog.fields_dict.medication_orders.grid
						.get_selected_children()
						.map(row => row.name);

					if (!selected.length) {
						frappe.throw(
							__("Please select at least one medication order to stop."),
						);
					}

					frm.call({
						doc: frm.doc,
						method: "stop_medication_orders",
						args: {
							entries: selected,
							stop_reason: values.stop_reason,
						},
						freeze: true,
						freeze_message: __("Stopping Medication Orders"),
						callback: function () {
							dialog.hide();
							frm.reload_doc();
						},
					});
				},
			});

			dialog.show();
		});
	},

	show_progress: function (frm) {
		let bars = [];
		let message = "";

		// completed sessions
		let title = __("{0} medication orders completed", [frm.doc.completed_orders]);
		if (frm.doc.completed_orders === 1) {
			title = __("{0} medication order completed", [frm.doc.completed_orders]);
		}
		title += __(" out of {0}", [frm.doc.total_orders]);

		bars.push({
			title: title,
			width: (frm.doc.completed_orders / frm.doc.total_orders) * 100 + "%",
			progress_class: "progress-bar-success",
		});
		if (bars[0].width == "0%") {
			bars[0].width = "0.5%";
		}
		message = title;
		frm.dashboard.add_progress(__("Status"), bars, message);
	},
});
