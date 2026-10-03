// Copyright (c) 2023, healthcare and contributors
// For license information, please see license.txt

frappe.ui.form.on("Observation", {
	refresh: function (frm) {
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

		render_period_control(frm);
	},
	onload_post_render: function (frm) {
		frm.trigger("set_result_control");
	},

	permitted_data_type: function (frm) {
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

		const fieldtype = healthcare.observation.get_control_fieldtype(data_type);
		const options = ["Select", "Boolean"].includes(data_type)
			? frm.doc.options
			: "";
		rebuild_result_control(frm, fieldtype, options);
	},

	observation_template: function (frm) {
		get_medical_codes(frm);
	},
});

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
