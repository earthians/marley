// Copyright (c) 2016, ESS and contributors
// For license information, please see license.txt

frappe.ui.form.on('Sample Collection', {
	onload: function(frm) {
		frappe.realtime.on("observation_creation_progress", (status) => {
			if (status == "Completed") {
				frm.reload_doc();
				frappe.dom.unfreeze();
			}
		})
	},
	refresh: function(frm) {
		frm.fields_dict.observation_sample_collection.grid.add_custom_button(__("Mark Collected"), () => {
			selected_child = frm.fields_dict.observation_sample_collection.grid.get_selected_children()
			if (selected_child.length > 0) {
				frappe.confirm(__("Are you sure you want to mark selected samples as Collected"), function () {
					frappe.dom.freeze(__('Creating Observations! Please Wait...'));
					frappe.call({
						"method": "healthcare.healthcare.doctype.sample_collection.sample_collection.create_observation",
						args: {
							selected: selected_child,
							sample_collection: frm.doc.name
						},
						freeze: true,
						freeze_message: __("Marking Collected..."),
						callback: function (r) {
							if (!r.exc) {
								frm.reload_doc();
							}
						}
					});
				});
			} else {
				frappe.show_alert({
					"message": "Select atleast one Sample",
					"indicator": "orange",
				});
			}
		}).addClass("btn-mark-collected");

		if (frappe.defaults.get_default('create_sample_collection_for_lab_test')) {
			frm.add_custom_button(__('View Lab Tests'), function() {
				frappe.route_options = {'sample': frm.doc.name};
				frappe.set_route('List', 'Lab Test');
			});
		}

		frm.set_query("healthcare_service_unit", "observation_sample_collection", function() {
			return {
				filters: {
					"is_group": 0
				}
			};
		})

		if(!frm.doc.__islocal) {
			frm.add_custom_button(__(`Print Barcode`), function () {
				print_barcode(frm);
			});
		}
	},

	patient: function(frm) {
		if(frm.doc.patient){
			frappe.call({
				'method': 'healthcare.healthcare.doctype.patient.patient.get_patient_detail',
				args: {
					patient: frm.doc.patient
				},
				callback: function (data) {
					var age = null;
					if (data.message.dob){
						age = calculate_age(data.message.dob);
					}
					frappe.model.set_value(frm.doctype,frm.docname, 'patient_age', age);
					frappe.model.set_value(frm.doctype,frm.docname, 'patient_sex', data.message.sex);
				}
			});
		}
	}
});

frappe.ui.form.on("Observation Sample Collection", {
	sample: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		frappe.db.get_value("Lab Test Sample", row.sample, ["sample_type", "sample_uom", "container_closure_color"])
			.then(r => {
				let values = r.message;
				frappe.model.set_value(cdt, cdn, 'sample_type', values.sample_type);
				frappe.model.set_value(cdt, cdn, 'uom', values.base_billing_amount);
				frappe.model.set_value(cdt, cdn, 'container_closure_color', values.container_closure_color);
			})
	},
	show_components: function(frm, cdt, cdn) {
		var row = locals[cdt][cdn];
		if (row.has_component) {
			let d = new frappe.ui.Dialog({
				title: 'Collect Samples',
				fields: [
					{
						label: 'Component Observations',
						fieldname: 'items',
						fieldtype: 'Table',
						cannot_add_rows: false,
						is_editable_grid: true,
						data: [],
						in_place_edit: true,
						fields: [
							{
								"fetch_from": "sample.sample_type",
								"fieldname": "sample_type",
								"fieldtype": "Link",
								"label": "Sample Type",
								"options": "Sample Type",
								"read_only": 1
							},
							{
								"fetch_from": "sample.sample_uom",
								"fieldname": "uom",
								"fieldtype": "Link",
								"label": "UOM",
								"options": "Lab Test UOM",
								"read_only": 1
							},
							{
								"columns": 2,
								"fieldname": "observation_template",
								"fieldtype": "Link",
								"in_list_view": 1,
								"label": "Observation Template",
								"options": "Observation Template"
							},
							{
								"columns": 2,
								"fieldname": "status",
								"fieldtype": "Select",
								"in_list_view": 1,
								"default": "Open",
								"label": "Status",
								"options": "Open\nCollected",
								"read_only": 1
							},
							{
								"columns": 2,
								"default": "Urine",
								"fetch_from": "observation_template.sample",
								"fieldname": "sample",
								"fieldtype": "Link",
								"in_list_view": 1,
								"label": "Sample",
								"options": "Lab Test Sample"
							},
							{
								"fieldname": "collection_date_time",
								"fieldtype": "Datetime",
								"in_list_view": 1,
								"label": "Collection Date Time",
								"read_only": 1
							},
							{
								"fieldname": "reference_doctype",
								"fieldtype": "Link",
								"label": "Reference Doctype",
								"options": "DocType",
								"read_only": 1
							},
							{
								"fieldname": "reference_docname",
								"fieldtype": "Dynamic Link",
								"label": "Reference Docname",
								"options": "reference_doctype",
								"read_only": 1
							},
							{
								"fetch_from": "observation_template.sample_qty",
								"fetch_if_empty": 1,
								"fieldname": "sample_qty",
								"fieldtype": "Float",
								"label": "Quantity"
							},
							{
								"columns": 1,
								"fetch_from": "sample.container_closure_color",
								"fieldname": "container_closure_color",
								"fieldtype": "Color",
								"in_list_view": 1,
								"label": "Color",
								"read_only": 1
							},
							{
								"columns": 1,
								"fieldname": "component_observation_parent",
								"fieldtype": "Link",
								"label": "component_observation_parent",
								"read_only": 1
							},
							{
								"default": "0",
								"fetch_from": "observation_template.has_component",
								"fieldname": "has_component",
								"fieldtype": "Check",
								"label": "Has Component",
								"read_only": 1
							},
							{
								"fieldname": "specimen",
								"fieldtype": "Data",
								"label": "Specimen",
								"read_only": 1
							},
						],
					},
				],
			});
			if (row.component_observations) {
				$.each(JSON.parse(row.component_observations), function (k, item) {
					// if (item.status == "Open") {
						d.fields_dict.items.df.data.push(item);
					// }
				});
				// if (d.fields_dict.items.df.data.length==0) {
				// 	frappe.show_alert({
				// 		indicator: 'red',
				// 		message: __('Sample Already Collected')
				// 	});
				// }
			}
			d.fields_dict.items.grid.refresh();
			d.fields_dict.items.$wrapper.find('.grid-add-row').remove();

			d.fields_dict.items.grid.add_custom_button(__("Mark Collected"), () => {
				let selected_row = d.fields_dict.items.grid.get_selected_children();
				if (selected_row.length > 0) {
					frappe.confirm(__("Are you sure you want to mark selected samples as Collected"), function () {
						frappe.dom.freeze(__('Creating Observations! Please Wait...'));
						frappe.call({
							"method": "healthcare.healthcare.doctype.sample_collection.sample_collection.create_observation",
							args: {
								selected: selected_row,
								sample_collection: frm.doc.name,
								component_observations: row.component_observations,
								child_name: row.name
							},
							freeze: true,
							freeze_message: __("Marking Collected..."),
							callback: function (r) {
								if (!r.exc) {
									d.hide()
									frm.reload_doc();
								}
							}
						});
					});
				} else {
					frappe.show_alert({
						"message": "Select atleast one Sample",
						"indicator": "orange",
					});
				}
			});

			d.show();
			d.$wrapper.find('.modal-content').css("width", "800px");
		}
	}
})

var calculate_age = function(birth) {
	var	ageMS = Date.parse(Date()) - Date.parse(birth);
	var	age = new Date();
	age.setTime(ageMS);
	var	years =  age.getFullYear() - 1970;
	return `${years} ${__('Years(s)')} ${age.getMonth()} ${__('Month(s)')} ${age.getDate()} ${__('Day(s)')}`;
};

var print_barcode = function(frm) {
	let d = new frappe.ui.Dialog({
		 title: 'Collect Samples',
		 fields: [
			 {
				 label: 'Specimen Barcodes',
				 fieldname: 'items',
				 fieldtype: 'Table',
				 cannot_add_rows: true,
				 is_editable_grid: true,
				 data: [],
				 fields: [
					{
						"fieldname": "specimen",
						"fieldtype": "Link",
						"label": "Specimen",
						"options": "Specimen",
						"read_only": 1,
						"in_list_view": 1,
					},
					{
						"fieldname": "sample_type",
						"fieldtype": "Link",
						"label": "Sample Type",
						"options": "Sample Type",
						"read_only": 1,
						"in_list_view": 1,
					},
					{
						"fieldname": "barcode",
						"fieldtype": "Barcode",
						"label": "Barcode",
					},
				],
			},
		],
	});
	d.set_primary_action(__("Print"), (args) => {
		let selected_list = [];
		let selected_row = d.fields_dict.items.grid.get_selected_children();
		$.each(selected_row, function (k, val) {
			selected_list.push(val.barcode);
		});
			if (!selected_list.length ) {
			    frappe.show_alert({
                    message:__('Please select atleast one specimen!'),
                    indicator:'orange'
                }, 5);
			    return;
			}
			const default_print_format = frappe.get_meta(frm.doc.doctype).default_print_format;
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
					encodeURIComponent(pdf_options)
			);

			if (!w) {
				frappe.msgprint(__("Please enable pop-ups"));
				return;
			}
		});
	if (frm.doc.observation_sample_collection) {
		let samples = [];
		$.each(frm.doc.observation_sample_collection, function (k, val) {
			if (val.has_component === 0 && val.specimen) {
				if (!samples.includes(val.specimen)) {
					d.fields_dict.items.df.data.push({
						"specimen": val.specimen,
						"barcode": val.specimen,
						"sample_type": val.sample_type,
					});
					samples.push(val.specimen);
				}
			} else if (val.has_component === 1 && JSON.parse(val.component_observations).length > 0) {
				$.each(JSON.parse(val.component_observations), function (j, comp) {
					if (comp.specimen && !samples.includes(comp.specimen)) {
						d.fields_dict.items.df.data.push({
							"specimen": comp.specimen,
							"barcode": comp.specimen,
							"sample_type": comp.sample_type,
						});
						samples.push(comp.specimen);
					}
				});
			}
		});
	}
	d.fields_dict.items.grid.refresh();
	d.show();
	d.$wrapper.find('.modal-content').css("width", "800px");
};
