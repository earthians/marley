// Copyright (c) 2016, ESS and contributors
// For license information, please see license.txt

frappe.ui.form.on("Sample Collection", {
	refresh: function (frm) {
		var sample_table = frm.doc.observation_sample_collection;
		let value = sample_table && sample_table.length > 0;
		frm.set_df_property("sample_details_section", "hidden", value);

		frm.set_df_property("observation_sample_collection", "hidden", 1);
		new healthcare.SampleCollectionTree(
			frm,
			frm.fields_dict.sample_html.$wrapper,
			frm.doc.observation_sample_collection,
		);

		if (frappe.defaults.get_default("create_sample_collection_for_lab_test")) {
			frm.add_custom_button(__("View Lab Tests"), function () {
				frappe.route_options = { sample: frm.doc.name };
				frappe.set_route("List", "Lab Test");
			});
		}

		frm.set_query(
			"healthcare_service_unit",
			"observation_sample_collection",
			function () {
				return {
					filters: {
						is_group: 0,
					},
				};
			},
		);

		if (!frm.doc.__islocal) {
			frm.add_custom_button(__(`Print Barcode`), function () {
				print_barcode(frm);
			});
		}
	},

	patient: function (frm) {
		if (frm.doc.patient) {
			frappe.call({
				method: "healthcare.healthcare.doctype.patient.patient.get_patient_detail",
				args: {
					patient: frm.doc.patient,
				},
				callback: function (data) {
					var age = null;
					if (data.message.dob) {
						age = calculate_age(data.message.dob);
					}
					frappe.model.set_value(
						frm.doctype,
						frm.docname,
						"patient_age",
						age,
					);
					frappe.model.set_value(
						frm.doctype,
						frm.docname,
						"patient_sex",
						data.message.sex,
					);
				},
			});
		}
	},
});

var collect_specimens = function (rows, samples, out) {
	// A panel's own row carries no specimen of its own - only its leaves
	// (at any depth, since a panel can itself contain a sub-panel) do.
	$.each(rows || [], function (k, val) {
		if (val.has_component && val.component_observations) {
			collect_specimens(JSON.parse(val.component_observations), samples, out);
		} else if (val.specimen && !samples.includes(val.specimen)) {
			out.push({
				specimen: val.specimen,
				barcode: val.specimen,
				sample_type: val.sample_type,
			});
			samples.push(val.specimen);
		}
	});
};

var calculate_age = function (birth) {
	var ageMS = Date.parse(Date()) - Date.parse(birth);
	var age = new Date();
	age.setTime(ageMS);
	var years = age.getFullYear() - 1970;
	return `${years} ${__("Years(s)")} ${age.getMonth()} ${__(
		"Month(s)",
	)} ${age.getDate()} ${__("Day(s)")}`;
};

var print_barcode = function (frm) {
	let d = new frappe.ui.Dialog({
		title: "Collect Samples",
		fields: [
			{
				label: "Specimen Barcodes",
				fieldname: "items",
				fieldtype: "Table",
				cannot_add_rows: true,
				is_editable_grid: true,
				data: [],
				fields: [
					{
						fieldname: "specimen",
						fieldtype: "Link",
						label: "Specimen",
						options: "Specimen",
						read_only: 1,
						in_list_view: 1,
					},
					{
						fieldname: "sample_type",
						fieldtype: "Link",
						label: "Sample Type",
						options: "Sample Type",
						read_only: 1,
						in_list_view: 1,
					},
					{
						fieldname: "barcode",
						fieldtype: "Barcode",
						label: "Barcode",
					},
				],
			},
		],
	});
	d.set_primary_action(__("Print"), args => {
		let selected_list = [];
		let selected_row = d.fields_dict.items.grid.get_selected_children();
		$.each(selected_row, function (k, val) {
			selected_list.push(val.barcode);
		});
		if (!selected_list.length) {
			frappe.show_alert(
				{
					message: __("Please select at least one specimen ID to print!"),
					indicator: "orange",
				},
				5,
			);
			return;
		}
		const default_print_format = frappe.get_meta(
			frm.doc.doctype,
		).default_print_format;
		const print_format = "Specimen Barcode";
		const doc_names = JSON.stringify(selected_list);
		const letterhead = args.letter_sel;

		let pdf_options = JSON.stringify({
			"page-height": "25mm",
			"page-width": "50mm",
		});

		const w = window.open(
			"/api/method/frappe.utils.print_format.download_multi_pdf?" +
				"doctype=" +
				encodeURIComponent("Specimen") +
				"&name=" +
				encodeURIComponent(doc_names) +
				"&format=" +
				encodeURIComponent(print_format) +
				"&no_letterhead=1" +
				"&options=" +
				encodeURIComponent(pdf_options),
		);

		if (!w) {
			frappe.msgprint(__("Please enable pop-ups"));
			return;
		}
	});
	if (frm.doc.observation_sample_collection) {
		let samples = [];
		collect_specimens(
			frm.doc.observation_sample_collection,
			samples,
			d.fields_dict.items.df.data,
		);
	}
	d.fields_dict.items.grid.refresh();
	d.show();
	d.$wrapper.find(".modal-content").css("width", "800px");
};
