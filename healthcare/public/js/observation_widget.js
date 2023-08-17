frappe.provide("healthcare.ObservationWidget");

healthcare.ObservationWidget = class {
	constructor(opts) {
		$.extend(this, opts);
		this.init_widget();
	}

	init_widget() {
		var me = this;
		if (me.data.has_component || me.data.has_component == "true") {
			if (!me.wrapper.find(`.${me.data.observation}`).length==0) {
				return
			}
			let grouped_html = (
				`<div class="${me.data.observation} grouped-obs"
					style="
						border: 1px solid var(--border-color);
						padding-right: 0;
						font-size: 11px;
						padding-left: 15px;
						padding-top: 5px;
						padding-bottom: 5px;
						margin-bottom: 3px;
						border-radius: 10px;
						background-color:var(--bg-color);">
						<b>
						<a href="/app/observation/${me.data.observation}">
							${me.data.display_name}
						</a>
						</b></div>`)
			me.wrapper.append(grouped_html)
			let component_wrapper = me.wrapper.find(`.${me.data.observation}`)
			for(var j=0, k=me.data[me.data.observation].length; j<k; j++) {
				var obs_data = me.data[me.data.observation][j].observation;
				component_wrapper.append(`<div class="observations-${obs_data.name} observs"
						style="border: 1px solid var(--border-color);
						padding-right: 0;
						font-size: 11px;
						padding-left: 15px;
						margin-right: 15px;
						padding-bottom: 5px;
						margin-bottom: 3px;
						border-radius: var(--border-radius-md);
						background-color: var(--fg-color);
						box-shadow: var(--card-shadow);"
						value=${obs_data.name}>
					</div>`)

				me.init_field_group(obs_data, component_wrapper.find(`.observations-${obs_data.name}`))
			}
		} else {
			if (!me.wrapper.find(`.observations-${me.data.observation.name}`).length==0) {
				return
			}
			me.wrapper.append(
				`<div class="grouped-obs"
					style="me.data.observation
						border: 1px solid var(--border-color);
						padding-right: 0;
						font-size: 11px;
						padding-left: 15px;
						padding-top: 5px;
						padding-bottom: 5px;
						margin-bottom: 3px;
						border-radius: 10px;
						background-color:var(--bg-color);">
					<div class="observations-${me.data.observation.name} observs"
						style="border: 1px solid var(--border-color);
						padding-right: 0;
						font-size: 11px;
						padding-left: 15px;
						margin-right: 15px;
						border-radius: var(--border-radius-md);
						background-color: var(--fg-color);
						box-shadow: var(--card-shadow);"
						value=${me.data.observation.name}>
					</div>
				</div>`)
			if (me.data.observation.name) {
			var obs_data = me.data.observation
			me.init_field_group(obs_data, me.wrapper.find(`.observations-${me.data.observation.name}`))
			me.$widget = me.wrapper.find(`.grouped-obs`)
			}
		}
		me.$widget = me.wrapper.find(`.grouped-obs`)
	}

	init_field_group(obs_data, wrapper) {
		var me = this;
		var default_input = ""
		if( ['Range', 'Ratio', 'Quantity', 'Numeric'].includes(obs_data.permitted_data_type)) {
			default_input = obs_data.result_data

		} else if (obs_data.permitted_data_type=='Text') {
			default_input = trim_html(obs_data.result_text)

		}
		let fieldtype = "Data"
		let options = ""
		if (obs_data.permitted_data_type=='Select') {
			fieldtype = "Select"
			options = obs_data.options
			default_input = obs_data.result_select
		}
		me[obs_data.name] = new frappe.ui.FieldGroup({
			fields: [
				{
					fieldtype: 'Section Break',
				},
				{
					fieldname: 'observation',
					fieldtype: 'HTML',
				},
				{
					fieldname: 'note_button',
					fieldtype: 'HTML',
				},
				{
					'fieldtype': 'Column Break',
				},
				{
					fieldname: 'specimen',
					fieldtype: 'HTML',
				},
				{
					'fieldtype': 'Column Break',
				},
				{
					fieldname: 'result',
					fieldtype: fieldtype,
					options: options,
					read_only: 1 ? (obs_data.status=='Approved') : 0,
					change: (s) => {
						me.frm.dirty()
						me.set_result_n_name(obs_data.name)
					},
					default: default_input,
					hidden: 1 ? obs_data.observation_category == "Imaging" : 0,
				},
				{
					fieldname: 'result_date',
					fieldtype: 'HTML',
					hidden: 1 ? obs_data.observation_category == "Imaging" : 0,
				},
				{
					'fieldtype': 'Column Break',
				},
				{
					fieldname: 'unit',
					fieldtype: 'HTML',
				},
				{
					fieldname: 'method',
					fieldtype: 'HTML',
				},
				{
					'fieldtype': 'Column Break',
				},
				{
					fieldname: 'reference',
					fieldtype: 'HTML',
				},
				{
					'fieldtype': 'Column Break',
				},
				{
					fieldname: 'auth_btn',
					fieldtype: 'HTML',
				},
				{
					fieldtype: 'Section Break',
				},
				{
					fieldname: 'note_text',
					fieldtype: 'Text',
					read_only: 1,
				},
				{
					fieldtype: 'Section Break',
					hidden: 1 ? obs_data.observation_category != "Imaging" : 0,
				},
				{
					label: __("Findings"),
					fieldname: 'findings',
					fieldtype: 'Button',
					click: () => me.add_finding_interpretation(obs_data, "Findings"),
				},
				{
					fieldname: 'findings_text',
					fieldtype: 'Text',
					read_only: 1,
				},
				{
					'fieldtype': 'Column Break',
				},
				{
					label: __("Interpretation"),
					fieldname: 'interpretation',
					fieldtype: 'Button',
					click: () => me.add_finding_interpretation(obs_data, "Interpretation"),
				},
				{
					fieldname: 'result_interpretation',
					fieldtype: 'Text',
					read_only: 1,
				},

			],
			body: wrapper
		})
		me[obs_data.name].make();
		me.set_values(this, obs_data)
	}

	set_values(th, obs_data) {
		var me = this;
		let name_html = `<div class="observation-name obs-field" style="font-size:10px; padding-top:20px;" value="{{observation_details.observation.name}}">
			<a href="/app/observation/${obs_data.name }" title="${obs_data.name }">`
		if (obs_data.preferred_display_name) {
			name_html += obs_data.preferred_display_name
		} else {
			name_html += obs_data.observation_template
		}
		name_html += `</a>
		<div>`
		me[obs_data.name].get_field('observation').html(name_html);


		let specimen_html = `<div class="text-muted" style="font-size:10px; padding-top:20px;">`
		if (obs_data.specimen) {
			specimen_html += `<a href="/app/specimen/{{ observation_details.observation.specimen }}" title="{{ observation_details.observation.specimen }}">`
			specimen_html += obs_data.specimen + '</a>'
		}
		specimen_html += `</div>
			<div class="text-muted" style="font-size: 8px;">`
			if (obs_data.received_time) {
				specimen_html += frappe.datetime.global_date_format(obs_data.received_time)
			}
			specimen_html += `</div>`
		me[obs_data.name].get_field('specimen').html(specimen_html);

		let result_date_html = `<div class="text-muted" style="font-size:8px; margin-top:-12px;">${obs_data.time_of_result ? frappe.datetime.global_date_format(obs_data.time_of_result): ""}</div>`
		me[obs_data.name].get_field('result_date').html(result_date_html);

		let method_html = `<div style="display:flex"><div style="font-size:10px; padding-top:20px; padding-right:45px; width:10%;">${obs_data.permitted_unit?obs_data.permitted_unit:""}</div>`


		method_html+= `<div class="text-muted" style="font-size:10px; padding-top:20px;">`
		if (obs_data.method) {
			method_html += `${obs_data.method }`
		}
		method_html += `</div></div>`
		me[obs_data.name].get_field('unit').html(method_html);


		let reference_html = `<div style="display:flex;"><div class="text-muted" style="font-size:10px; padding-top:20px;">`
		if (obs_data.reference) {
			reference_html += `${obs_data.reference }`
		}
		reference_html += `</div>`
		me[obs_data.name].get_field('reference').html(reference_html);

		let auth_html = ""
		if (!['Approved'].includes(obs_data.status)) {
			auth_html += `<div style="float:right;">
				<button class="btn btn-xs btn-secondary small" id="authorise-observation-btn-${obs_data.name}">
				<span style="font-size:10px;">Approve</span>
				</button>`
			auth_html += `</div></div>`
			me[obs_data.name].get_field('auth_btn').html(auth_html);
			var authbutton = document.getElementById(`authorise-observation-btn-${obs_data.name}`);
			authbutton.addEventListener("click", function() {
				me.auth_observation(obs_data.name, "Approved")
			});
		} else if (obs_data.status=='Approved') {
			auth_html += `<div style="float:right;">
				<button class="btn btn-xs btn-del btn-secondary small" id="unauthorise-observation-btn-${obs_data.name}">
				<span class="btn-observ" style="font-size:10px;">Disapprove</span>
				</button>`
			auth_html += `</div></div>`
			me[obs_data.name].get_field('auth_btn').html(auth_html);
			var authbutton = document.getElementById(`unauthorise-observation-btn-${obs_data.name}`);
			authbutton.addEventListener("click", function() {
				me.auth_observation(obs_data.name, "Disapproved")
			});
		}


		let note_html = `<div><span class="add-note-observation-btn btn btn-link"
			id="add-note-observation-btn-${obs_data.name}">
			<svg class="icon icon-sm"><use xlink:href="#icon-small-message"></use></svg>
			</span>`
		note_html += `</div>`
		me[obs_data.name].get_field('note_button').html(note_html);
		var myButton = document.getElementById(`add-note-observation-btn-${obs_data.name}`);
		myButton.addEventListener("click", function() {
			me.add_note(obs_data.name, obs_data.note)
		  });

		if (obs_data.note) {
			me[obs_data.name].set_value("note_text", obs_data.note)
		}

		if (obs_data.observation_category == "Imaging") {
			me[obs_data.name].set_value("findings_text", obs_data.result_text)
			me[obs_data.name].set_value("result_interpretation", obs_data.result_interpretation)
		}

	}

	set_result_n_name(observation) {
		var me = this;
		let dialog_values = me[observation].get_values();
		dialog_values["observation"] =  observation
		let valuexists = me.result.some(dict => dict.observation === observation);
		for (var res of me.result) {
			if (observation == res.observation) {
				res["result"] = dialog_values.result
			}
		}
		if (!valuexists) {
			me.result.push(dialog_values)
		}
	}

	add_note (observation, note) {
		var me = this;
		let observation_name = observation;
		let note_text = me[observation].get_value('note_text') || note
		// let result = note;
			var d = new frappe.ui.Dialog({
				title: __('Add Note'),
				static: true,
				fields: [
					{
						"label": __("Observation"),
						"fieldname": "observation",
						"fieldtype": "Link",
						"options": "Observation",
						"default": observation_name,
						"hidden": 1,
					},
					{
						"label": __("Note"),
						"fieldname": "note",
						"fieldtype": "Text Editor",
						"default": note_text,
					}
				],
				primary_action: function() {
					me.frm.dirty()
					var data = d.get_values();
					me[observation].set_value("note_text", data.note)
					if (me.result.length > 0) {
						me.result.forEach(function(res) {
						if (res.observation == observation) {
							res["note"] =  data.note
						}
						});
					} else {
						me.result.push({"observation": observation, "note": data.note})
					}
					d.hide();
				},
				primary_action_label: __("Add Note")
			});
			d.show();
			d.get_close_btn().show();
	}

	auth_observation (observation, status) {
		var me = this;
		if (status == "Approved") {
			frappe.confirm(__("Are you sure you want to authorise Observation <b>" + observation +"</b>"), function () {
				frappe.call({
					method: 'healthcare.healthcare.doctype.observation.observation.set_observation_status',
					args: {
						observation: observation,
						status: status,
					},
					callback: function (r) {
						me.frm.reload_doc();
					}
				});
			})
		} else if (status == "Disapproved") {
			var d = new frappe.ui.Dialog({
				title: __('Reason For Disapproval'),
				fields: [
					{
						"label": __("Reason"),
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
							observation: observation,
							status: status,
							reason: data.unauthorisation_reason,
						},
						freeze: true,
						callback: function(r) {
							if (!r.exc) {
								me.frm.reload_doc();
							}
							d.hide();
						}
					});
				},
				primary_action_label: __("Disapprove")
				});
				d.show()
		}

	}

	add_finding_interpretation (obs_data, type) {
		var me = this;
		let template = ""
		let note = ""
		if (type=="Findings") {
			template = obs_data.result_template
			note = me[obs_data.name].get_value('result_text') || obs_data.result_text
		} else if (type=="Interpretation") {
			template = obs_data.interpretation_template
			note = me[obs_data.name].get_value('result_interpretation') || obs_data.result_interpretation
		}
		var d = new frappe.ui.Dialog({
			title: __(type),
			static: true,
			fields: [
				{
					"label": "Observation",
					"fieldname": "observation",
					"fieldtype": "Link",
					"options": "Observation",
					"default": obs_data.name,
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
					"default" : note,
				}
			],
			primary_action: function() {
				me.frm.dirty()
				var data = d.get_values();
				let val_dict = {};
				var values = [];
				val_dict["observation"] = obs_data.name
				val_dict["result"] = ""
				if (type=="Findings") {
					val_dict["result"] = data.note
					me[obs_data.name].set_value("findings_text", data.note)
				} else if (type=="Interpretation") {
					val_dict["interpretation"] = data.note
					me[obs_data.name].set_value("result_interpretation", data.note)
				}
				d.hide();
				values.push(val_dict);
				me.result.push(val_dict)
			},
			primary_action_label: __("Add")
			});
			if ((!note || note == "") && d.get_values("template")) {
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
			d.get_close_btn().show();
	}

}

var trim_html = function(text_result) {
	if (text_result && text_result.includes('</div>')) {
		var tempElement = document.createElement('div');
		tempElement.innerHTML = text_result;
		var paragraphElement = tempElement.querySelector('p');
		return paragraphElement.textContent
	} else {
		return text_result
	}
}

var set_text_to_dialog = function(d) {
	if (d.get_value("template")) {
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
}