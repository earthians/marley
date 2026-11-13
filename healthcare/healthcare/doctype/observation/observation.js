// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on("Observation", {
	onload: function (frm) {
		frm._saved_patient_for_template = frm.doc.patient;
	},
	refresh: function (frm) {
		if (frm._saved_patient_for_template === undefined) {
			frm._saved_patient_for_template = frm.doc.patient;
		}
		frm._selected_result_template = frm.doc.result_template;
		frm._selected_interpretation_template = frm.doc.interpretation_template;
		frm.set_query("patient", function () {
			return {
				filters: { status: ["!=", "Disabled"] },
			};
		});

		frm.set_query("appointment", function () {
			return {
				filters: {
					template_dt: "Observation Template",
					template_dn: frm.doc.observation_template,
					status: ["in", ["Open", "Scheduled"]],
				},
			};
		});

		set_service_unit_query(frm);
		healthcare.ConsumablesReview.set_batch_query(frm);
		healthcare.ConsumablesReview.ask_once_before_submit(frm);
		render_period_control(frm);
	},
	after_save: function (frm) {
		frm._saved_patient_for_template = frm.doc.patient;
	},
	before_save: function () {
		return frappe.after_ajax();
	},
	onload_post_render: function (frm) {
		frm.trigger("set_result_control");
	},

	permitted_data_type: function (frm) {
		frm.trigger("set_result_control");
	},

	observation_category: function (frm) {
		frm.trigger("set_result_control");
	},

	options: function (frm) {
		frm.trigger("set_result_control");
	},

	// The "result" field's visible control changes to match the template's
	// Permitted Data Type, so only one field ever needs to be maintained on
	// this doctype instead of one per type. A control's widget class is
	// fixed at construction (frappe.ui.form.make_control picks "Control" +
	// fieldtype once) — merely editing df.fieldtype afterwards updates the
	// metadata but never swaps the rendered input, so the control has to be
	// torn down and rebuilt whenever the type actually changes.
	set_result_control: function (frm) {
		const data_type = frm.doc.permitted_data_type;

		if (data_type == "Period") {
			// Period needs two values; result is rendered as a custom
			// from/to pair instead (see render_period_control), so the
			// native control stays hidden.
			frm.set_df_property("result", "hidden", 1);
			render_period_control(frm);
			return;
		}
		frm.set_df_property("result", "hidden", 0);
		remove_period_control(frm);

		let fieldtype = healthcare.observation.get_control_fieldtype(data_type);
		if (!data_type && frm.doc.observation_category == "Imaging") {
			fieldtype = "Text Editor";
		}
		const options = ["Select", "Boolean"].includes(data_type)
			? frm.doc.options
			: "";
		rebuild_result_control(frm, fieldtype, options);
	},

	observation_template: function (frm) {
		get_medical_codes(frm);
		set_service_unit_query(frm);
	},
	result_template: function (frm) {
		apply_imaging_template(frm, "result_template", "result");
	},
	interpretation_template: function (frm) {
		apply_imaging_template(frm, "interpretation_template", "result_interpretation");
	},
	service_request: function (frm) {
		set_service_unit_query(frm);
	},
});

function apply_imaging_template(frm, template_field, result_field) {
	const selected_key = `_selected_${template_field}`;
	const selected = frm.doc[template_field];
	const selected_patient = frm.doc.patient;
	const previous = frm[selected_key];
	if (selected === previous) return;
	const change_key = `_change_${template_field}`;
	const change_id = (frm[change_key] || 0) + 1;
	frm[change_key] = change_id;
	const is_current = () =>
		frm[change_key] === change_id && frm.doc[template_field] === selected;

	const restore_selection = () => {
		if (!is_current()) return;
		frm[selected_key] = previous;
		frm.set_value(template_field, previous || "");
	};

	if (!selected || !frm.doc.patient || frm.doc.observation_category !== "Imaging") {
		frm[selected_key] = selected;
		return;
	}
	if (!frm.is_new() && frm.doc.patient !== frm._saved_patient_for_template) {
		frappe.msgprint(
			__("Save the Patient change before selecting a report template."),
		);
		restore_selection();
		return;
	}

	const render_selected = () => {
		if (!is_current()) return;
		if (
			!frm.is_new() &&
			(frm.doc.patient !== selected_patient ||
				frm._saved_patient_for_template !== selected_patient)
		) {
			restore_selection();
			return;
		}
		if (frm.is_new()) {
			// before_insert renders the chosen template when its result is empty.
			frm[selected_key] = selected;
			if (frm.doc[result_field]) frm.set_value(result_field, "");
			return;
		}
		frappe.call({
			method: "healthcare.healthcare.doctype.observation.observation.get_observation_result_template",
			args: { template_name: selected, observation: frm.doc.name },
			callback: r => {
				if (!is_current()) return;
				if (
					frm.doc.patient !== selected_patient ||
					frm._saved_patient_for_template !== selected_patient
				) {
					restore_selection();
					return;
				}
				if (r.exc) {
					restore_selection();
					return;
				}
				frm[selected_key] = selected;
				frm.set_value(result_field, r.message || "");
			},
			error: restore_selection,
		});
	};

	render_selected();
}

// Destroys the current "result" control and replaces it with a freshly
// constructed one of the right type, in the same spot in the layout.
// set_df_property()/refresh_field() alone can't do this — see the note on
// set_result_control above.
var rebuild_result_control = function (frm, fieldtype, options) {
	const field = frm.fields_dict.result;

	if (
		field.df.fieldtype === fieldtype &&
		(field.df.options || "") === (options || "")
	) {
		field.refresh();
		return;
	}

	const docfield = frm.get_docfield("result");
	docfield.fieldtype = fieldtype;
	docfield.options = options;

	const $anchor = field.$wrapper;
	const new_field = frappe.ui.form.make_control({
		df: docfield,
		doctype: frm.doctype,
		docname: frm.docname,
		parent: $("<div>"),
		frm: frm,
		doc: frm.doc,
		render_input: true,
	});
	new_field.layout = frm.layout;
	new_field.$wrapper.insertBefore($anchor);
	$anchor.remove();

	frm.fields_dict.result = new_field;
	new_field.set_value(frm.doc.result);
};

// Renders two Datetime pickers in place of the (hidden) native result
// control, and keeps them in sync with `result`, which stores the pair as
// JSON: {"from": "...", "to": "..."}.
var render_period_control = function (frm) {
	if (frm.doc.permitted_data_type != "Period") return;

	const $wrapper = frm.get_field("result").$wrapper;
	if (frm.period_controls) {
		sync_period_controls_from_result(frm);
		return;
	}

	let parsed = {};
	try {
		parsed = frm.doc.result ? JSON.parse(frm.doc.result) : {};
	} catch (e) {
		parsed = {};
	}

	const $period_wrapper = $(
		`<div class="observation-period-control"></div>`,
	).insertAfter($wrapper);
	const write_back = () => {
		const from_value = frm.period_controls.from.get_value();
		const to_value = frm.period_controls.to.get_value();
		// Clearing both controls must leave no result, not the non-empty
		// string '{"from":"","to":""}' — has_value() would otherwise treat
		// an empty period as an actual answer.
		frm.set_value(
			"result",
			from_value || to_value
				? JSON.stringify({ from: from_value || "", to: to_value || "" })
				: "",
		);
	};

	frm.period_controls = {
		from: frappe.ui.form.make_control({
			df: {
				fieldtype: "Datetime",
				fieldname: "result_period_from",
				label: __("From"),
			},
			parent: $period_wrapper,
			render_input: true,
		}),
		to: frappe.ui.form.make_control({
			df: {
				fieldtype: "Datetime",
				fieldname: "result_period_to",
				label: __("To"),
			},
			parent: $period_wrapper,
			render_input: true,
		}),
	};
	frm.period_controls.from.set_value(parsed.from || "");
	frm.period_controls.to.set_value(parsed.to || "");
	frm.period_controls.from.$input.on("change", write_back);
	frm.period_controls.to.$input.on("change", write_back);
};

var sync_period_controls_from_result = function (frm) {
	let parsed = {};
	try {
		parsed = frm.doc.result ? JSON.parse(frm.doc.result) : {};
	} catch (e) {
		parsed = {};
	}
	frm.period_controls.from.set_value(parsed.from || "");
	frm.period_controls.to.set_value(parsed.to || "");
};

var remove_period_control = function (frm) {
	if (!frm.period_controls) return;
	frm.get_field("result").$wrapper.next(".observation-period-control").remove();
	frm.period_controls = null;
};

var get_medical_codes = function (frm) {
	if (frm.doc.observation_template) {
		frappe.call({
			method: "healthcare.healthcare.utils.get_medical_codes",
			args: {
				template_dt: "Observation Template",
				template_dn: frm.doc.observation_template,
			},
			callback: function (r) {
				if (!r.exc && r.message) {
					frm.doc.codification_table = [];
					$.each(r.message, function (k, val) {
						if (val.code_value) {
							var child = frm.add_child("codification_table");
							child.code_value = val.code_value;
							child.code_system = val.code_system;
							child.code = val.code;
							child.description = val.description;
							child.system = val.system;
						}
					});
					frm.refresh_field("codification_table");
				} else {
					frm.clear_table("codification_table");
					frm.refresh_field("codification_table");
				}
			},
		});
	} else {
		frm.clear_table("codification_table");
		frm.refresh_field("codification_table");
	}
};

// Only units of the type that can perform this observation, such as a modality type.
async function set_service_unit_query(frm) {
	const { message: service_unit_type } = await frappe.call({
		method: "healthcare.healthcare.doctype.observation.observation_consumables.get_service_unit_type",
		args: {
			observation_template: frm.doc.observation_template,
			service_request: frm.doc.service_request,
		},
	});
	frm.set_query("service_unit", () => {
		const filters = { company: frm.doc.company, is_group: 0 };
		if (service_unit_type) filters.service_unit_type = service_unit_type;
		return { filters };
	});
}
