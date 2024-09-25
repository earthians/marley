frappe.treeview_settings["Medication"] = {
	get_tree_nodes: "healthcare.healthcare.doctype.medication.medication.get_children",
	filters: [
		{
			fieldname: "medication",
			fieldtype: "Link",
			options: "Medication",
			label: __("Medication"),
		},
	],
	title: "Medication",
	breadcrumb: "Healthcare",
	disable_add_node: true,
	root_label: "Medication",
	get_tree_root: false,
	show_expand_all: false,
	get_label: function (node) {
		return node.data.item_code || node.data.value;
	},
	onload: function (me) {
		var label = frappe.get_route()[0] + "/" + frappe.get_route()[1];

		if (frappe.pages[label]) {
			delete frappe.pages[label];
		}

		var filter = me.opts.filters[0];
		if (frappe.route_options && frappe.route_options[filter.fieldname]) {
			var val = frappe.route_options[filter.fieldname];
			delete frappe.route_options[filter.fieldname];
			filter.default = "";
			me.args[filter.fieldname] = val;
			me.root_label = val;
			me.page.set_title(val);
		}
		me.make_tree();
	},
	toolbar: [
		{ toggle_btn: true },
		{
			label: __("Edit"),
			condition: function (node) {
				return node.expandable;
			},
			click: function (node) {
				frappe.set_route("Form", "Medication", node.data.value);
			},
		},
	],
	menu_items: [
		{
			label: __("New Medication"),
			action: function () {
				frappe.new_doc("Medication", true);
			},
			condition: 'frappe.boot.user.can_create.indexOf("Medication") !== -1',
		},
	],
	onrender: function (node) {
		if (node.is_root && node.data.value != "Medication") {
			frappe.model.with_doc("Medication", node.data.value, function () {
				var medication = frappe.model.get_doc("Medication", node.data.value);
				node.data.strength = medication.strength || "";
				node.data.item_code = medication.item || "";
				node.data.uom = medication.strength_uom || "";
				node.data.medication_class = medication.medication_class || "";
			});
		}
	},
	view_template: "medication_item_preview",
};
