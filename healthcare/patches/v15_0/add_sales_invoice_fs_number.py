import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


FS_NUMBER_FIELD = {
	"fieldname": "custom_fs_number",
	"label": "FS Number",
	"fieldtype": "Data",
	"insert_after": "patient_name",
	"allow_on_submit": True,
	"print_hide": False,
	"no_copy": True,
}


def execute():
	meta = frappe.get_meta("Sales Invoice")
	for fieldname in ("custom_fs_number", "fs_number"):
		if not meta.get_field(fieldname):
			continue
		_update_existing_custom_field(fieldname)
		frappe.clear_cache(doctype="Sales Invoice")
		return

	create_custom_fields(
		{"Sales Invoice": [FS_NUMBER_FIELD]},
		ignore_validate=True,
		update=True,
	)
	frappe.clear_cache(doctype="Sales Invoice")


def _update_existing_custom_field(fieldname):
	custom_field_name = frappe.db.get_value(
		"Custom Field",
		{"dt": "Sales Invoice", "fieldname": fieldname},
		"name",
	)
	if not custom_field_name:
		return

	custom_field = frappe.get_doc("Custom Field", custom_field_name)
	custom_field.label = "FS Number"
	custom_field.insert_after = "patient_name"
	custom_field.allow_on_submit = True
	custom_field.print_hide = False
	custom_field.no_copy = True
	custom_field.save(ignore_permissions=True)
