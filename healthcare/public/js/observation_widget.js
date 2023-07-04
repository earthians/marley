frappe.provide("healthcare.ObservationWidget");

healthcare.ObservationWidget = class {
	constructor(opts) {
		$.extend(this, opts);
		this.init_widget();
	}

	init_widget() {
		var me = this;
		if (me.data.has_component) {

		} else {
			let observation_html = frappe.render_template(
				'observation_widget',
				{
				observation_details: me.data
				}
			);
			$(observation_html).appendTo(me.wrapper);
			// console.log()
			$(".observations").find(".save-btn").on("click", function() {
				const $item = $(this);
				// const item_code = unescape($item.attr('observation-name'));
				console.log(document.getElementById("observation-name").innerText)
				// console.log($($item).getElementById("observation-name").innerText)
			// me.wrapper.getElementById("save-btn").onchange = function() {
				console.log(888888888888888)
				// me.edit_observation(this);
			});
		}
	}
}