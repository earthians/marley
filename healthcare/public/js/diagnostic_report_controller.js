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
}