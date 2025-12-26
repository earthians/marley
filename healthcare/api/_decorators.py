try:
    import frappe  # type: ignore
    _whitelist = frappe.whitelist
except Exception:
    def _whitelist(f):
        return f
