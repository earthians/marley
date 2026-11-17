import frappe
from frappe.custom.doctype.property_setter.property_setter import make_property_setter


# klik_pos Employee links that must not gate billing via User Permissions.
TARGETS = (
	("Customer", "Customer-custom_employee", "custom_employee"),
	("Sales Invoice", "Sales Invoice-custom_employee", "custom_employee"),
)


def _ensure_ignore_user_permissions(doctype: str, custom_field_name: str, fieldname: str) -> None:
	if frappe.db.exists("Custom Field", custom_field_name):
		frappe.db.set_value(
			"Custom Field",
			custom_field_name,
			"ignore_user_permissions",
			1,
			update_modified=False,
		)

	existing = frappe.db.exists(
		"Property Setter",
		{
			"doc_type": doctype,
			"field_name": fieldname,
			"property": "ignore_user_permissions",
		},
	)
	if existing:
		frappe.db.set_value(
			"Property Setter",
			existing,
			"value",
			"1",
			update_modified=False,
		)
	else:
		make_property_setter(
			doctype,
			fieldname,
			"ignore_user_permissions",
			"1",
			"Check",
			validate_fields_for_doctype=False,
		)
	frappe.clear_cache(doctype=doctype)


def execute():
	"""Stop Employee User Permissions from blocking invoice/payment billing.

	klik_pos adds Customer.custom_employee and Sales Invoice.custom_employee
	(label Employee). Reception users often have User Permissions on Employee,
	so Frappe denies Customer/SI access whenever that link points at another
	employee (e.g. EMP-028). That blocks Sales Invoice create/submit and
	Payment Entry party work even though billing APIs authorize the invoice.

	Ignore user permissions on those links so patient billing can proceed.
	"""
	for doctype, custom_field_name, fieldname in TARGETS:
		_ensure_ignore_user_permissions(doctype, custom_field_name, fieldname)
