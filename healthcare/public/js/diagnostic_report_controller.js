frappe.provide("healthcare.Diagnostic.DiagnosticReport");

healthcare.Diagnostic.DiagnosticReport = class DiagnosticReport {
	constructor(opts) {
		$.extend(this, opts);
	}

	refresh() {
		var me = this;
		this.ObservationWidgets = []
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
		this.result = []
			for (let key in r.message[0]) {
				me.ObservationWidgets[key] = new healthcare.ObservationWidget({
					wrapper: me.observation_wrapper,
					data: r.message[0][key],
					frm: me.frm,
					result: this.result
				});
			}
		}
	}

	save_action(func) {
		var me = this;
		if (func=="save") {
			frappe.call({
				method: "healthcare.healthcare.doctype.observation.observation.record_observation_result",
				args: {
					values: this.result
				},
				freeze: true,
				callback: function(r) {
					// me.frm.refresh(this)
				}
			})
		}
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

	authorise_observation (edit_btn) {
		var me = this;
		let status = edit_btn.getAttribute("value")
		let row = $(edit_btn).closest('.observation');
		let observation_name = row.attr("name");
		if (status == "Approved") {
			frappe.confirm(__("Are you sure you want to authorise Observation <b>" + observation_name +"</b>"), function () {
				frappe.call({
					method: 'healthcare.healthcare.doctype.observation.observation.set_observation_status',
					args: {
						observation: observation_name,
						status: status,
					},
					callback: function (r) {
						me.refresh();
					}
				});
			})
		} else if (status == "Disapproved") {
			var d = new frappe.ui.Dialog({
				title: __('Reason For Unauthorisation'),
				fields: [
					{
						"label": "Reason",
						"fieldname": "unauthorisation_reason",
						"fieldtype": "Text",
						reqd: 1,
					}
				],
				primary_action: function() {
					var data = d.get_values();
					frappe.call({
						method: "healthcare.healthcare.doctype.observation.observation.set_observation_status",
						args: {
							observation: observation_name,
							status: status,
							reason: data.unauthorisation_reason,
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
				primary_action_label: __("Unauthorise")
				});
				d.show()
		}

	}

	authorise_all (me, data) {
		var me = this;
		let observs = []
			for (var i = 1; i < data[1]; i++) {
				let obsvrs_name = document.getElementsByClassName("observation-details")[i].getAttribute("name")
				if (obsvrs_name) {
					observs.push(obsvrs_name)
				}
			}
			if (observs.length > 0) {
				frappe.call({
					method: 'healthcare.healthcare.doctype.observation.observation.set_observation_status',
					args: {
						observation: observs,
						status: "Authorise",
					},
					callback: function (r) {
						me.refresh();
					}
				});
			}
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