frappe.provide("healthcare.Diagnostic.Observation");

healthcare.Diagnostic.Observation = class Observation {
	constructor(opts) {
		$.extend(this, opts);
	}

	refresh() {
		var me = this;
		this.observation_wrapper.find('.observation-section').remove();
        frappe.call({
			method: "healthcare.healthcare.doctype.observation.observation.get_observation_details",
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
			me.add_note(this)
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
					// me.frm.refresh(this)
					}
			})
		}
	}
	add_note (edit_btn) {
		var me = this;
		let row = $(edit_btn).closest('.observation');
		let observation_name = row.attr("name");
		let result_html = $(row).find(".note").html();
		let result = "";
		if (result_html) {
			result = result_html.trim();
		}
			var d = new frappe.ui.Dialog({
				title: __('Add Note'),
				fields: [
					{
						"label": "Observation",
						"fieldname": "observation",
						"fieldtype": "Link",
						"options": "Observation",
						"default": observation_name,
						"hidden": 1,
					},
					{
						"label": "Note",
						"fieldname": "note",
						"fieldtype": "Text Editor",
						"default": result,
						reqd: 1,
					}
				],
				primary_action: function() {
					var data = d.get_values();
					frappe.call({
						method: "healthcare.healthcare.doctype.observation.observation.add_note",
						args: {
							note: data.note,
							observation: data.observation,
						},
						freeze: true,
						callback: function(r) {
							if (!r.exc) {
								me.refresh();
								// me.init_widget();
							}
							d.hide();
						}
					});
				},
				primary_action_label: __("Add Note")
			});
			d.show();
	}

}