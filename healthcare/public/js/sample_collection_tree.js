// Copyright (c) 2025, earthians and contributors
// For license information, please see license.txt

frappe.provide("healthcare");

healthcare.SampleCollectionTree = class SampleCollectionTree {
	constructor(frm, wrapper, rows) {
		this.frm = frm;
		this.wrapper = $(wrapper);
		this.rows = rows || [];
		this.render();
	}

	render() {
		this.wrapper.empty();
		if (!this.rows.length) return;

		healthcare.SampleCollectionTree.inject_styles();
		this.wrapper.append(this.build_toolbar());

		const tree = $('<ul class="sample-tree"></ul>');
		this.rows.forEach(row => tree.append(this.build_node(row, null)));
		this.wrapper.append(tree);

		this.bind_toggle();
		this.update_selection();
	}

	bind_toggle() {
		this.wrapper.find(".sample-tree-caret").on("click", event => {
			event.stopPropagation();
			$(event.currentTarget)
				.closest(".sample-tree-node")
				.toggleClass("collapsed");
		});
	}

	build_toolbar() {
		this.toolbar = $(`
			<div class="sample-tree-toolbar">
				<span class="sample-tree-bulk">
					<button class="btn btn-xs select-all-btn">${__("Select All")}</button>
					<button class="btn btn-xs unselect-all-btn">${__("Unselect All")}</button>
				</span>
				<span class="sample-tree-selection text-muted"></span>
				<button class="btn btn-xs btn-primary mark-selected-btn">${__(
					"Mark Collected",
				)}</button>
			</div>
		`);
		this.toolbar
			.find(".mark-selected-btn")
			.on("click", () => this.collect_selected());
		this.toolbar.find(".select-all-btn").on("click", () => this.set_all(true));
		this.toolbar.find(".unselect-all-btn").on("click", () => this.set_all(false));
		return this.toolbar;
	}

	set_all(checked) {
		this.wrapper
			.find(".sample-tree-check")
			.prop({ checked: checked, indeterminate: false });
		this.update_selection();
	}

	color_boxes(color) {
		return this.wrapper
			.find(".sample-tree-check")
			.filter((index, element) => $(element).attr("data-color") === color);
	}

	build_node(row, parent) {
		const children = this.get_children(row);
		const node = $('<li class="sample-tree-node"></li>');
		node.append(this.node_label(row, parent, children.length > 0));

		if (children.length) {
			const child_list = $('<ul class="sample-tree-children"></ul>');
			children.forEach(child => child_list.append(this.build_node(child, row)));
			node.append(child_list);
		}
		return node;
	}

	get_children(row) {
		if (!row.has_component || !row.component_observations) return [];
		try {
			// Tag each component with its 1-based position; the backend keys created
			// specimens by this idx to link them back to the component.
			return JSON.parse(row.component_observations).map((component, index) => ({
				...component,
				idx: index + 1,
			}));
		} catch (e) {
			return [];
		}
	}

	node_label(row, parent, has_children) {
		const label = $('<div class="sample-tree-label"></div>');
		label.append(this.marker(has_children));
		label.append(this.checkbox(row, parent));
		label.append(
			`<span class="sample-tree-test">${this.escape(
				row.observation_template,
			)}</span>`,
		);
		label.append(this.sample_type_pill(row));
		label.append(this.collect_action(row));
		return label;
	}

	sample_type_pill(row) {
		if (!row.sample_type) return "";
		const pill = $(
			`<span class="sample-type-pill">${this.escape(row.sample_type)}</span>`,
		);
		if (row.container_closure_color) {
			const dot = $('<span class="sample-type-dot"></span>');
			dot.css("background", row.container_closure_color);
			dot.attr("title", row.container_closure_color);
			pill.prepend(dot);
		}
		return pill;
	}

	marker(has_children) {
		return has_children
			? '<span class="sample-tree-caret">▸</span>'
			: '<span class="sample-tree-leaf">•</span>';
	}

	checkbox(row, parent) {
		// Collected rows show a disabled, empty box (kept out of the selection logic
		// via a distinct class) so rows stay aligned without looking selected.
		if (this.is_collected(row)) {
			return '<input type="checkbox" class="sample-tree-check-done" disabled>';
		}

		const box = $('<input type="checkbox" class="sample-tree-check">');
		box.data("node", { row, parent });
		box.attr("data-color", (row.container_closure_color || "").trim());
		box.on("click", event => event.stopPropagation());
		box.on("change", event => this.on_check(event.currentTarget));
		return box;
	}

	on_check(element) {
		const box = $(element);
		const checked = box.prop("checked");

		// A panel selects all of its children.
		box.closest(".sample-tree-node")
			.children(".sample-tree-children")
			.find(".sample-tree-check")
			.prop({ checked: checked, indeterminate: false });

		// Selecting one colour selects every open sample of that colour;
		// unselecting only affects the clicked sample.
		const color = box.attr("data-color");
		if (checked && color)
			this.color_boxes(color).prop({ checked: true, indeterminate: false });

		this.refresh_parent_states();
		this.update_selection();
	}

	refresh_parent_states() {
		// Recompute each panel checkbox from its children (deepest first).
		this.wrapper
			.find(".sample-tree-node")
			.get()
			.reverse()
			.forEach(element => {
				const node = $(element);
				const child_list = node.children(".sample-tree-children");
				if (!child_list.length) return;

				const child_boxes = child_list.find(".sample-tree-check");
				const checked_count = child_boxes.filter(":checked").length;
				node.children(".sample-tree-label")
					.find(".sample-tree-check")
					.prop({
						checked:
							child_boxes.length > 0 &&
							checked_count === child_boxes.length,
						indeterminate:
							checked_count > 0 && checked_count < child_boxes.length,
					});
			});
	}

	collect_action(row) {
		// Panels carry no status of their own; only the individual tests show it.
		if (this.get_children(row).length) return "";
		const collected = this.is_collected(row);
		const cls = collected ? "collected" : "not-collected";
		const text = collected ? __("Collected") : __("Not Collected");
		return $(`<span class="sample-tree-status ${cls}">${text}</span>`);
	}

	is_collected(row) {
		// A sample is collected once its specimen exists; a panel once all of its
		// components are. Fall back to status for legacy rows without a specimen.
		const children = this.get_children(row);
		if (children.length) return children.every(child => this.is_collected(child));
		return Boolean(row.specimen) || row.status === "Collected";
	}

	collect_selected() {
		const nodes = this.selected_units();
		if (nodes.length) this.run_collection(nodes);
	}

	selected_units() {
		// Collect only leaves/components; a checked panel is represented by its children.
		return this.wrapper
			.find(".sample-tree-check:checked")
			.map((index, element) => $(element).data("node"))
			.get()
			.filter(node => this.get_children(node.row).length === 0);
	}

	update_selection() {
		const count = this.selected_units().length;
		this.toolbar.find(".mark-selected-btn").prop("disabled", count === 0);
		this.toolbar
			.find(".sample-tree-selection")
			.text(count ? __("{0} selected", [count]) : "");
	}

	run_collection(nodes) {
		frappe.confirm(
			__("Are you sure you want to mark {0} sample(s) as Collected?", [
				nodes.length,
			]),
			async () => {
				frappe.dom.freeze(__("Marking Collected..."));
				try {
					// Run groups one at a time: parallel requests race on the
					// same Sample Collection and only one set of writes survives.
					for (const group of this.group_by_parent(nodes)) {
						await this.collect_call(group);
					}
					await this.frm.reload_doc();
				} catch (error) {
					frappe.msgprint(__("Failed to mark samples as Collected"));
				} finally {
					frappe.dom.unfreeze();
				}
			},
		);
	}

	group_by_parent(nodes) {
		const groups = new Map();
		nodes.forEach(({ row, parent }) => {
			const key = parent ? parent.name : "__top__";
			if (!groups.has(key)) groups.set(key, { parent, rows: [] });
			groups.get(key).rows.push(row);
		});
		return [...groups.values()];
	}

	collect_call(group) {
		const args = {
			selected: JSON.stringify(group.rows),
			sample_collection: this.frm.doc.name,
		};
		if (group.parent) {
			args.component_observations = group.parent.component_observations;
			args.child_name = group.parent.name;
		}
		return frappe.call({
			method: "healthcare.healthcare.doctype.sample_collection.sample_collection.create_observation",
			args: args,
		});
	}

	escape(value) {
		return frappe.utils.escape_html(value || "");
	}

	static inject_styles() {
		if (document.getElementById("sample-tree-styles")) return;
		$("head").append(`
			<style id="sample-tree-styles">
				.sample-tree-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
				.sample-tree-selection { font-size: var(--text-sm); margin-left: auto; }
				.sample-tree-bulk { display: inline-flex; gap: 6px; }
				.sample-tree, .sample-tree-children { list-style: none; margin: 0; padding: 0; }
				.sample-tree-children { padding-left: 22px; }
				.sample-tree-label {
					display: flex; align-items: center; gap: 8px;
					padding: 10px 8px; border-radius: var(--border-radius);
				}
				.sample-tree-label:hover { background: var(--bg-light-gray); }
				.sample-tree-caret {
					display: inline-block; width: 12px; color: var(--text-muted); cursor: pointer;
					transform: rotate(90deg); transition: transform 0.15s;
				}
				.sample-tree-node.collapsed > .sample-tree-label .sample-tree-caret { transform: rotate(0deg); }
				.sample-tree-node.collapsed > .sample-tree-children { display: none; }
				.sample-tree-leaf { display: inline-block; width: 12px; color: var(--text-muted); }
				.sample-tree-check { margin: 0; cursor: pointer; }
				.sample-tree-check-done { margin: 0; cursor: not-allowed; }
				.sample-tree-test { font-weight: 500; }
				.sample-type-pill {
					display: inline-flex; align-items: center; gap: 5px;
					font-size: var(--text-xs); line-height: 1.6; color: var(--text-muted);
					padding: 0 8px; border-radius: 10px;
					border: 1px solid var(--border-color); background: var(--bg-light-gray);
				}
				.sample-type-dot {
					width: 8px; height: 8px; border-radius: 50%;
					border: 1px solid var(--border-color); flex-shrink: 0;
				}
				.sample-tree-status { margin-left: auto; font-size: var(--text-sm); }
				.sample-tree-status.collected { color: var(--green-600); }
				.sample-tree-status.not-collected { color: var(--orange-600); }
			</style>
		`);
	}
};
