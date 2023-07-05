frappe.provide("healthcare.ObservationWidget");

healthcare.ObservationWidget = class {
	constructor(opts) {
		$.extend(this, opts);
		this.init_widget();
	}

	init_widget() {
		var me = this;
		if (me.data.has_component || me.data.has_component == "true") {
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

	add_remarks (edit_btn) {
		var me = this;
		let row = $(edit_btn).closest('.observation');
		let observation_name = row.attr("name");
		let result = $(row).find(".remarks").html().trim();
			var d = new frappe.ui.Dialog({
				title: __('Add Remarks'),
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
						"label": "Remarks",
						"fieldname": "remarks",
						"fieldtype": "Text Editor",
						"default": result
					}
				],
				primary_action: function() {
					var data = d.get_values();
					frappe.call({
						method: "healthcare.healthcare.doctype.observation.observation.add_remarks",
						args: {
							remarks: data.remarks,
							observation: data.observation,
						},
						freeze: true,
						callback: function(r) {
							if (!r.exc) {
								me.frm.reload_doc()
								// me.init_widget();
							}
							d.hide();
						}
					});
				},
				primary_action_label: __("Add Remarks")
			});
			d.show();
	}

}