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

		$(".observation").find(".btn-findings").on("click", function() {
			me.add_finding_interpretation(this, ".btn-findings")
		});
		$(".observation").find(".btn-interpr").on("click", function() {
			me.add_finding_interpretation(this, ".btn-interpr")
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
				val_dict["result"] = ""
				if (document.getElementById(normal_obs_div[i].getAttribute("value"))) {
					val_dict["result"] = document.getElementById(normal_obs_div[i].getAttribute("value")).value
				}
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

	add_finding_interpretation (edit_btn, btn_attr) {
		var me = this;
		let row = $(edit_btn).closest('.observation');
		let observation_name = row.attr("name");
		let template = $(row).find(btn_attr).attr("name")
		let result_html = $(row).find(btn_attr+"-text").html();
		var d = new frappe.ui.Dialog({
			title: btn_attr == ".btn-findings" ? __('Add Findings') : __('Add Interpretation'),
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
					"label": "Template",
					"fieldname": "template",
					"fieldtype": "Link",
					"options": "Terms and Conditions",
					"default": template,
				},
				{
					"label": "Note",
					"fieldname": "note",
					"fieldtype": "Text Editor",
					"default" : result_html,
					reqd: 1,
				}
			],
			primary_action: function() {
				var data = d.get_values();
				let val_dict = {};
				var values = [];
				val_dict["observation"] = observation_name
				val_dict["result"] = ""
				if (btn_attr == ".btn-findings") {
					val_dict["result"] = data.note
				} else if (btn_attr == ".btn-interpr") {
					val_dict["interpretation"] = data.note
				}
				values.push(val_dict);
				frappe.call({
					method: "healthcare.healthcare.doctype.observation.observation.record_observation_result",
					args: {
						values: values
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
			primary_action_label: __("Save")
			});
			if ((!result_html || result_html.trim() == "") && d.get_values("template")) {
				set_text_to_dialog(d)
			  }
			d.fields_dict['template'].df.onchange = () => {
				const regex = /<p>(.*?)<\/p>/;
				const match = d.get_value("note").match(regex);
				const result_value = match ? match[1] : null;
				if (d.get_value('template') && (!result_value || result_value == "<br>")) {
					set_text_to_dialog(d)
				}
			}
			d.show();
	}
}

var set_text_to_dialog = function(d) {
	frappe.call({
		method: 'healthcare.healthcare.doctype.observation.observation.get_observation_result_template',
		args: {
			template_name: d.get_value("template"),
			observation: d.get_value("observation")
		},
		callback: function (r) {
			d.set_value('note', r.message)
		}
	});
}