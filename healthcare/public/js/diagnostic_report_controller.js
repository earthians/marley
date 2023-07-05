frappe.provide("healthcare.Diagnostic.Observation");

healthcare.Diagnostic.Observation = class Observation {
	constructor(opts) {
		$.extend(this, opts);
	}

	refresh() {
		var me = this;
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
			me.save_action("load")
	}

    create_widget(r) {
		var me = this;
		if (r && r.message[0]) {
			for (let key in r.message[0]) {
				this.ObservationWidget = new healthcare.ObservationWidget({
					wrapper: me.observation_wrapper,
					data: r.message[0][key],
				});
			}
			for (var i = 0; i < r.message[1]; i++) {
				document.getElementsByClassName("result-text")[i].onchange = function() {
					me.frm.dirty()
				};
			}
		}
		$(".observation").find(".add-note-observation-btn").on("click", function() {
			console.log(1111111)
			me.ObservationWidget.add_note()
		});
    }

	save_action(func) {
		var me = this;
		if (func=="save") {
			var normal_obs_div = document.getElementsByClassName("observation-name");
			var values = [];
  
			for (var i = 0; i < normal_obs_div.length; i++) {
				let val_dict = {}
				val_dict["observation"] = normal_obs_div[i].getAttribute("value")
				val_dict["result"] = document.getElementById(normal_obs_div[i].getAttribute("value")).value
				if (val_dict["result"]) {
					values.push(val_dict);
				}
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
		}
	}
}