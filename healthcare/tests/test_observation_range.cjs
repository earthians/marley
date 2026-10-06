// Run with: node --test healthcare/tests/test_observation_range.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function loadObservationScripts() {
	const context = vm.createContext({
		__: (text) => text,
		healthcare: { observation: {} },
		frappe: {
			provide() {},
			ui: { form: { on: (_doctype, handlers) => (context.handlers = handlers) } },
		},
		setTimeout: (callback) => callback(),
	});
	for (const file of [
		"public/js/observation_widget.js",
		"healthcare/doctype/observation/observation.js",
	]) {
		vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
	}
	return context;
}

test("Observation form uses a literal input for Range results", () => {
	const context = loadObservationScripts();
	context.remove_period_control = () => {};
	context.rebuild_result_control = (_frm, fieldtype) => {
		assert.equal(fieldtype, "Data");
	};
	context.handlers.set_result_control({
		doc: { permitted_data_type: "Range", result: "12-15" },
		set_df_property() {},
	});
});

test("Diagnostic Report renders Range literally and preserves the save payload", () => {
	const context = loadObservationScripts();
	context.frappe.ui.FieldGroup = class {
		constructor({ fields }) {
			this.result = fields.find((field) => field.fieldname === "result");
			assert.equal(this.result.fieldtype, "Data");
			assert.equal(this.result.default, "12-15");
		}
		make() {}
		get_values() { return {}; }
		get_field() {
			return { $input: { css() {} }, get_value: () => this.result.default };
		}
	};
	const widget = Object.create(context.healthcare.ObservationWidget.prototype);
	widget.result = [];
	widget.frm = { dirty() {} };
	widget.set_values = () => {};
	widget.init_field_group({ name: "test-range", permitted_data_type: "Range", result: "12-15" }, {});
	widget["test-range"].result.change();
	assert.equal(widget.result[0].observation, "test-range");
	assert.equal(widget.result[0].result, "12-15");
});
