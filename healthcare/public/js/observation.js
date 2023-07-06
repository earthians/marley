frappe.provide("healthcare");

healthcare.Observation = class Observation {
	constructor(opts) {
		$.extend(this, opts);
	}

	refresh() {
		var me = this;
		this.notes_wrapper.find('.observation-section').remove();
		frappe.run_serially([
			() => frappe.call({
			method: "healthcare.healthcare.doctype.observation.observation.get_observation_details",
			args: {
				docname: me.frm.doc.name
			},
			freeze: true,
			callback: function(r) {
				let observation_details = r.message || [];
				let observation_html = frappe.render_template(
					'observation',
					{
						observation_details: observation_details,
						create_observation: me.create_observation
					}
				);
				$(observation_html).appendTo(me.observation_wrapper);
				}
			}),
			() => {
				me.add_observations();
				$(".observations").find(".edit-observation-btn").on("click", function() {
					me.edit_observation(this);
				});
				document.getElementById("result-text").onchange = function() {
					me.frm.dirty()
				};
				$(".observations").find(".result-text").change(function() {
					me.frm.dirty()
				})
				// $('#result-text').change(function() {
				// 	console.log("UUUUUUUUUUU")
				// })

			}
		])
	}

	add_observations () {
		let me = this;
		let _add_observations = () => {
			var d = new frappe.ui.Dialog({
				title: __('Add Observation'),
				fields: [
					{
						"label": "Observation Template",
						"fieldname": "observation_template",
						"fieldtype": "Link",
						"options": "Observation Template",
						"reqd": 1,
					},
					{
						"label": "Permitted Data Type",
						"fieldname": "permitted_data_type",
						"fieldtype": "Data",
						"read_only": 1,
					},
					{
						"label": "Result Text",
						"fieldname": "result_text",
						"fieldtype": "Text Editor",
						"depends_on": "eval:doc.permitted_data_type=='Text'"
					},
					{
						"label": "Result Float",
						"fieldname": "result_float",
						"fieldtype": "Float",
						"depends_on": "eval:['Quantity', 'Numeric'].includes(doc.permitted_data_type)"
					},
					{
						"label": "Result Data",
						"fieldname": "result_data",
						"fieldtype": "Data",
						"depends_on": "eval:['Range', 'Ratio'].includes(doc.permitted_data_type)"
					}
				],
				primary_action: function() {
					var data = d.get_values();
					var result = "";
					if (['Range', 'Ratio'].includes(data.permitted_data_type)) {
						result = data.result_data;
					} else if (['Quantity', 'Numeric'].includes(data.permitted_data_type)) {
						result = data.result_float;
					}
					else if (data.permitted_data_type=='Text') {
						result = data.result_text;
					}
					frappe.call({
						method: "healthcare.healthcare.doctype.observation.observation.add_observation",
						args: {
							patient: me.frm.doc.patient,
							template: data.observation_template,
							data_type: data.permitted_data_type || "",
							result: result,
							doc: me.frm.doc.doctype,
							docname: me.frm.doc.name
						},
						freeze: true,
						callback: function(r) {
							if (!r.exc) {
								me.refresh();
							}
							d.hide();
						}
					});
				},
				primary_action_label: __('Add Observation')
			});
			d.fields_dict['observation_template'].df.onchange = () => {
				if (d.get_value("observation_template")) {
					frappe.db.get_value("Observation Template", {"name": d.get_value("observation_template")}, ["permitted_data_type", "has_component"], (r) => {
						if (r.permitted_data_type && !r.has_component) {
							d.set_value("permitted_data_type", r.permitted_data_type)
						}
					});
				}
			}
			d.show();
		};
		$(".new-observation-btn").click(_add_observations);
	}

	edit_observation (edit_btn) {
		var me = this;
		let row = $(edit_btn).closest('.observation');
		let observation_name = row.attr("name");
		let permitted_data_type = row.attr("addatatype");
		let result = $(row).find(".result-content").html().trim();
			var d = new frappe.ui.Dialog({
				title: __('Edit Observation'),
				fields: [
					{
						"label": "Observation",
						"fieldname": "observation",
						"fieldtype": "Link",
						"options": "Observation",
						"default": observation_name,
						"read_only": 1,
					},
					{
						"label": "Permitted Data Type",
						"fieldname": "permitted_data_type",
						"fieldtype": "Data",
						"read_only": 1,
						"default": permitted_data_type
					},
					{
						"label": "Result Text",
						"fieldname": "result_text",
						"fieldtype": "Text Editor",
						"depends_on": "eval:doc.permitted_data_type=='Text'",
						"default": result
					},
					{
						"label": "Result Float",
						"fieldname": "result_float",
						"fieldtype": "Float",
						"depends_on": "eval:['Quantity', 'Numeric'].includes(doc.permitted_data_type)",
						"default": result
					},
					{
						"label": "Result Data",
						"fieldname": "result_data",
						"fieldtype": "Data",
						"depends_on": "eval:['Range', 'Ratio'].includes(doc.permitted_data_type)",
						"default": result
					}
				],
				primary_action: function() {
					var data = d.get_values();
					var result = "";
					if (['Range', 'Ratio'].includes(data.permitted_data_type)) {
						result = data.result_data;
					} else if (['Quantity', 'Numeric'].includes(data.permitted_data_type)) {
						result = data.result_float;
					}
					else if (data.permitted_data_type=='Text') {
						result = data.result_text;
					}
					frappe.call({
						method: "healthcare.healthcare.doctype.observation.observation.edit_observation",
						args: {
							observation: data.observation,
							data_type: data.permitted_data_type || "",
							result: result
						},
						freeze: true,
						callback: function(r) {
							if (!r.exc) {
								me.refresh();
								d.hide();
							}

						}
					});
				},
				primary_action_label: __("Edit")
			});
			d.show();
	}

}