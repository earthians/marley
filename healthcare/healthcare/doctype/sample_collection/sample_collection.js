// Copyright (c) 2016, ESS and contributors
// For license information, please see license.txt

frappe.ui.form.on('Sample Collection', {
	refresh: function(frm) {
		frm.fields_dict.observation_sample_collection.grid.add_custom_button(__("Mark Collected"), () => {
			selected_child = frm.fields_dict.observation_sample_collection.grid.get_selected_children()
			if (selected_child.length>0) {
				frappe.call({
					"method": "healthcare.healthcare.doctype.sample_collection.sample_collection.create_observation",
					args: {
						selected: selected_child,
						sample_collection: frm.doc.name
					},
					callback: function (r) {
						if (!r.exc) {
							frm.reload_doc();
						}
					}
				});
			}
		}).addClass("btn-mark-collected");

		frm.fields_dict["observation_sample_collection"].grid.wrapper.find('.btn-mark-collected').hide();

		frm.fields_dict.observation_sample_collection.$wrapper.find('.sortable-handle').click(function () {
			selected_child = frm.fields_dict.observation_sample_collection.grid.get_selected_children()
			if (selected_child.length>0) {
				frm.fields_dict["observation_sample_collection"].grid.wrapper.find('.btn-mark-collected').hide();
			} else {
				frm.fields_dict["observation_sample_collection"].grid.wrapper.find('.btn-mark-collected').show();
			}
		})


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
								"options": "Open\nCompleted",
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
								"fieldname": "sample_id",
								"fieldtype": "Data",
								"label": "Sample ID",
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
				if (selected_row.length>0) {
					frappe.call({
						"method": "healthcare.healthcare.doctype.sample_collection.sample_collection.create_observation",
						args: {
							selected: selected_row,
							sample_collection: frm.doc.name,
							component_observations: row.component_observations,
							child_name: row.name
						},
						callback: function (r) {
							if (!r.exc) {
								d.hide()
								frm.reload_doc();
							}
						}
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
