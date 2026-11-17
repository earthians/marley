import frappe


def execute():
	"""Unblock Customer/Item/Supplier save when Company Restriction has no Python module.

	Serene (and similar v16 sites) have ERPNext develop/v17 DocType metadata for
	``Company Restriction`` plus Customer ``allowed_companies`` fields, but the
	installed ERPNext 16.x tree has no ``erpnext.stock.doctype.company_restriction``
	package. Saving Customer then fails in ``_set_defaults`` while importing that
	child DocType.

	Mark the orphaned DocType as custom so Frappe uses the base Document
	controller instead of importing a missing module. Child table data still
	works; full v17 restriction behaviour needs an ERPNext upgrade.
	"""
	if not frappe.db.exists("DocType", "Company Restriction"):
		return

	if frappe.utils.cint(frappe.db.get_value("DocType", "Company Restriction", "custom")):
		return

	frappe.db.set_value("DocType", "Company Restriction", "custom", 1, update_modified=False)
	frappe.clear_cache(doctype="Company Restriction")
	# Controllers are cached per site — drop so the next save uses Document.
	if hasattr(frappe, "controllers") and frappe.local.site in frappe.controllers:
		frappe.controllers[frappe.local.site].pop("Company Restriction", None)
