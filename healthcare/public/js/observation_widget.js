frappe.provide("healthcare.ObservationWidget");

healthcare.ObservationWidget = class {
	constructor(opts) {
		$.extend(this, opts);
		this.init_widget();
	}

	init_widget() {
		var me = this;
		if (me.data.has_component) {
			// console.log(me.data[me.data.observation])
			let observation_html = frappe.render_template(
				'observation_component_widget',
				{
				observation_details: me.data
				}
			);
			$(observation_html).appendTo(me.wrapper);
		} else {
			let observation_html = frappe.render_template(
				'observation_widget',
				{
				observation_details: me.data
				}
			);
			$(observation_html).appendTo(me.wrapper);
		}
	}

	add_note (edit_btn) {
		const parentDiv = $(edit_btn).closest('.observation');
		var me = this;
		let row = $(edit_btn).closest('.observation');
		let observation_name = row.attr("name");
		// let permitted_data_type = row.attr("addatatype");
		// let result = $(row).find(".result-content").html().trim();
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
						"label": "Result Data",
						"fieldname": "result_data",
						"fieldtype": "Text Editor",
						// "default": result
					}
				],
				primary_action: function() {

				},
				primary_action_label: __("Add Note")
			});
			d.show();
	}

}