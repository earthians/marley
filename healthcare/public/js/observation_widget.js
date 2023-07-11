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
}