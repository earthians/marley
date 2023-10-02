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
				let new_ob_list = [];
				const inputContainer = document.querySelectorAll('.input-with-feedback');
				for (let i = 0; i < inputContainer.length; i++) {
					new_ob_list.push(inputContainer[i])
				}

				document.addEventListener('keydown', function(event) {
					const focusedElement = document.activeElement;
					let current_index = 0
					let next_index = 0
					for (let key in new_ob_list) {
						if (new_ob_list.hasOwnProperty(key) && new_ob_list.includes(focusedElement)) {
							current_index = new_ob_list.indexOf(focusedElement);
						}
					}

					if (['ArrowDown', 'Enter'].includes(event.key)) {
						next_index = current_index + 1
					} else if (event.key === 'ArrowUp') {
						next_index = current_index - 1
					}

					if (new_ob_list[next_index]) {
						new_ob_list[next_index].focus();
					}

				});
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

}