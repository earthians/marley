// Copyright (c) 2025, earthians Health Informatics Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Health Insurance", {
	refresh(frm) {
		if (!frm.is_new()) {
			frm.add_custom_button(__("Upload Price Lists"), () => {
				open_price_list_upload_dialog(frm);
			}, __("Actions"));

			frm.add_custom_button(__("Fetch Inclusive Items"), () => {
				frappe.call({
					method:
						"healthcare.healthcare.doctype.health_insurance.health_insurance.fetch_inclusive_items",
					args: {
						docname: frm.doc.name,
					},
					freeze: true,
					callback() {
						frm.reload_doc();
					},
				});
			}, __("Actions"));

			frm.add_custom_button(__("Fetch Exclusive Items"), () => {
				frappe.call({
					method:
						"healthcare.healthcare.doctype.health_insurance.health_insurance.fetch_exclusive_items",
					args: {
						docname: frm.doc.name,
					},
					freeze: true,
					callback() {
						frm.reload_doc();
					},
				});
			}, __("Actions"));
		}
	},
});

function open_price_list_upload_dialog(frm) {
	const dialog = new frappe.ui.Dialog({
		title: __("Upload Insurance Price Lists"),
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "help",
				options: `<p class="text-muted small">${__(
					"Upload the four TOP Serene price lists (Lab, In Patient, IOP, Out Patient). New prices (Effective June 16 2026 – Dec 31 2027) update Inclusive Items (price + %). Older Excel period prices are saved as Insurance History Prices."
				)}</p>`,
			},
			{
				label: __("Lab Tests Price List"),
				fieldname: "lab_file",
				fieldtype: "Attach",
				description: __(
					"TOP - Serene Psychiatry Hospital - In House and Out Sourced Lab Tests Price List"
				),
			},
			{
				label: __("In Patient Price List"),
				fieldname: "ip_file",
				fieldtype: "Attach",
				description: __("TOP - Serene Psychiatry Hospital - In Patient Price List"),
			},
			{
				label: __("IOP Price List"),
				fieldname: "iop_file",
				fieldtype: "Attach",
				description: __("TOP - Serene Psychiatry Hospital - IOP Price List"),
			},
			{
				label: __("Out Patient Price List"),
				fieldname: "op_file",
				fieldtype: "Attach",
				description: __("TOP - Serene Psychiatry Hospital - Out Patient Price List"),
			},
		],
		primary_action_label: __("Preview & Update Prices"),
		primary_action(values) {
			if (!values.lab_file && !values.ip_file && !values.iop_file && !values.op_file) {
				frappe.msgprint(__("Upload at least one Excel file."));
				return;
			}

			const args = {
				health_insurance: frm.doc.name,
				lab_file_url: values.lab_file || null,
				ip_file_url: values.ip_file || null,
				iop_file_url: values.iop_file || null,
				op_file_url: values.op_file || null,
			};

			frappe.call({
				method: "healthcare.api.tricare_price_update.preview_tricare_price_update",
				args,
				freeze: true,
				freeze_message: __("Reading price lists…"),
				callback(preview) {
					const counts = preview.message || {};
					frappe.confirm(
						__(
							"Update inclusive item prices and archive older Excel prices?\n\n"
								+ "Insurance: {0}\n"
								+ "New period: {1} → {2}\n\n"
								+ "New inclusive rows: lab {3}, IP {4}, IOP {5}, OP {6}\n"
								+ "History price rows: {7}\n"
								+ "Unmatched sample count: {8}\n\nContinue?",
							[
								counts.insurance || frm.doc.name,
								counts.new_from || "",
								counts.new_to || "",
								counts.lab_current || 0,
								counts.ip_current || 0,
								counts.iop_current || 0,
								counts.op_current || 0,
								counts.history_rows || 0,
								counts.missing_count || 0,
							]
						),
						() => {
							frappe.call({
								method:
									"healthcare.api.tricare_price_update.update_tricare_prices_from_excel",
								args,
								freeze: true,
								freeze_message: __("Updating insurance prices…"),
								callback(r) {
									const result = r.message || {};
									if (!result.ok) {
										return;
									}

									let details = result.message || __("Import completed.");
									if (result.missing_count) {
										const sample = (result.missing_sample || []).join("\n");
										details += `\n\n${__("Unmatched rows")}: ${result.missing_count}`;
										if (sample) {
											details += `\n\n${sample}`;
										}
									}

									frappe.msgprint({
										title: __("Insurance Prices Updated"),
										message: details.replace(/\n/g, "<br>"),
										indicator: result.missing_count ? "orange" : "green",
									});
									dialog.hide();
									frm.reload_doc();
								},
							});
						}
					);
				},
			});
		},
	});

	dialog.show();
}
