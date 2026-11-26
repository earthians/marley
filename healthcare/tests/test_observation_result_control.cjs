const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function make_form() {
	let handlers;
	class Control {
		constructor(df) {
			this.df = df;
		}
		refresh() {
			this.rendered_value = this.doc?.result;
		}
	}
	class ControlData extends Control {}
	class ControlTextEditor extends ControlData {}
	class ControlLongText extends ControlData {}
	const form = {
		ControlData,
		ControlTextEditor,
		ControlLongText,
		on: (_doctype, events) => { handlers = events; },
	};
	const context = vm.createContext({
		frappe: { ui: { form }, provide() {} },
		healthcare: {
			observation: {},
			ConsumablesReview: { set_batch_query() {}, ask_once_before_submit() {} },
		},
	});
	for (const file of [
		"../public/js/observation_widget.js",
		"../healthcare/doctype/observation/observation.js",
	]) {
		vm.runInContext(fs.readFileSync(path.resolve(__dirname, file), "utf8"), context);
	}
	context.set_service_unit_query = () => {};
	const metadata = new Map();
	const frm = {
		fields_dict: { result: new ControlLongText({ fieldtype: "Long Text" }) },
		set_query() {},
		get_docfield: () => metadata.get(frm.docname),
		set_df_property: (_name, key, value) => { frm.fields_dict.result.df[key] = value; },
		trigger: event => handlers[event](frm),
		layout: {
			replace_field: (_name, df) => {
				frm.fields_dict.result = new form["Control" + df.fieldtype.replace(/ /g, "")](df);
			},
		},
	};
	return {
		frm,
		form,
		navigate(doc) {
			frm.doc = doc;
			frm.docname = doc.name;
			if (!metadata.has(doc.name)) {
				metadata.set(doc.name, { fieldtype: "Long Text", options: "" });
			}
			// Frappe's attach_doc_and_docfields reuses the widget but rebinds df.
			const field = frm.fields_dict.result;
			field.df = metadata.get(doc.name);
			field.doc = doc;
			field.docname = doc.name;
		},
	};
}

test("Imaging → Laboratory → cached Imaging replaces a stale widget despite matching metadata", () => {
	const { frm, form, navigate } = make_form();
	const imaging = {
		name: "imaging", observation_category: "Imaging", result: "<p><strong>Report</strong></p>",
	};
	const lab = {
		name: "lab", observation_category: "Laboratory", permitted_data_type: "Numeric", result: "1.00",
	};
	navigate(imaging);
	frm.trigger("refresh");
	assert.equal(frm.fields_dict.result.constructor, form.ControlTextEditor);
	navigate(lab);
	frm.trigger("refresh");
	assert.equal(frm.fields_dict.result.constructor, form.ControlData);

	navigate(imaging);
	const stale = frm.fields_dict.result;
	assert.equal(stale.df.fieldtype, "Text Editor");
	assert.equal(stale.constructor, form.ControlData);
	frm.trigger("refresh");
	assert.notEqual(frm.fields_dict.result, stale);
	assert.equal(frm.fields_dict.result.constructor, form.ControlTextEditor);
	assert.equal(frm.fields_dict.result.rendered_value, imaging.result);
	assert.equal(imaging.result, "<p><strong>Report</strong></p>");
	assert.equal(lab.result, "1.00");
});

test("refresh reuses a matching result widget", () => {
	const { frm, navigate } = make_form();
	for (const doc of [
		{ name: "imaging", observation_category: "Imaging", result: "<p>Report</p>" },
		{ name: "lab", observation_category: "Laboratory", permitted_data_type: "Numeric", result: "1.00" },
	]) {
		navigate(doc);
		frm.trigger("refresh");
		const matching = frm.fields_dict.result;
		frm.trigger("refresh");
		assert.equal(frm.fields_dict.result, matching);
		assert.equal(matching.rendered_value, doc.result);
	}
});
