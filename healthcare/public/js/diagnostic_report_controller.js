frappe.provide("healthcare.Diagnostic.Observation");

healthcare.Diagnostic.Observation = class Observation {
	constructor(opts) {
		$.extend(this, opts);
	}

	refresh() {
		var me = this;
		// this.notes_wrapper.find('.observation-section').remove();
		// frappe.run_serially([
        frappe.call({
			method: "healthcare.healthcare.doctype.observation.observation.get_observation_template_reference",
			args: {
				docname: me.frm.doc.name
			},
			freeze: true,
			callback: function(r) {
				me.create_widget(r)
				}
			})
				// me.add_observations();
				// $(".observations").find(".edit-observation-btn").on("click", function() {
				// 	me.edit_observation(this);
				// });
				// document.getElementById("result-text").onchange = function() {
				// 	me.frm.dirty()
				// };
				// $(".observations").find(".result-text").change(function() {
				// 	me.frm.dirty()
				// })
				// $('#result-text').change(function() {
				// 	console.log("UUUUUUUUUUU")
				// })

			
	}

    create_widget(r) {
		var me = this;
		// console.log(r)
		if (r && r.message) {
			var button_html = `<div style="float: right; padding:8px;"><button class="btn btn-xs btn-secondary save-btn" id="save-btn">
				Save
				</button></div>`
			$(button_html).appendTo(me.observation_wrapper);
			for (let key in r.message) {
				this.ObservationWidget = new healthcare.ObservationWidget({
					wrapper: me.observation_wrapper,
					data: r.message[key],
				});
			}
		}
		me.observation_wrapper.find(".save-btn").on("click", function() {
			var divs = document.getElementsByClassName("observation-name");
			var values = [];
  
			for (var i = 0; i < divs.length; i++) {
				let val_dict = {}
				let row = $(me).closest('.result-text');
				// console.log(document.getElementById(divs[i].getAttribute("value")).value)
				// console.log(divs[i].getAttribute("value"))
				val_dict["observation"] = divs[i].getAttribute("value")
				val_dict["result"] = document.getElementById(divs[i].getAttribute("value")).value
				values.push(val_dict);
			}
			frappe.call({
				method: "healthcare.healthcare.doctype.observation.observation.record_observation_result",
				args: {
					values: values
				},
				freeze: true,
				callback: function(r) {
					me.frm.refresh()
					}
				})
			
			console.log(values);
			// console.log(document.getElementById("observation-name").innerText)
			// console.log(77777777777, divs)
		})
		$(".observation-section").find(".save-btn").on("click", function() {
			const $item = $(this);
			// const item_code = unescape($item.attr('observation-name'));
			console.log(document.getElementById("observation-name").innerText)
			// console.log($($item).getElementById("observation-name").innerText)
		// me.wrapper.getElementById("save-btn").onchange = function() {
			console.log(888888888888888)
			// me.edit_observation(this);
		});
		// document.getElementById("result-text").onchange = function() {
		// 	me.frm.dirty()
		// }

        // let observation_details = r.message || [];
		// 		let observation_html = frappe.render_template(
		// 			'observation',
		// 			{
		// 				observation_details: observation_details,
		// 				create_observation: me.create_observation
		// 			}
		// 		);
		// 		$(observation_html).appendTo(me.observation_wrapper);
    }
}