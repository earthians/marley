import json
import os

import frappe
from frappe import _
from frappe.utils import get_bench_path


def get_context(context):
	portal_entry = frappe.db.get_value(
		"Portal Menu Item", {"route": "/patient-portal"}, ["enabled", "role"], as_dict=True
	)

	if not portal_entry or not portal_entry.enabled:
		frappe.throw(_("Page not found"), frappe.DoesNotExistError)

	# check if logged in
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/patient-portal"
		frappe.local.response["type"] = "redirect"

	# check role
	if portal_entry.role and not portal_entry.role in frappe.get_roles(frappe.session.user):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	if frappe.session.user != "Administrator" and not frappe.db.exists(
		"Patient", {"status": "Active", "user_id": frappe.session.user}
	):
		frappe.throw(
			_("You are not linked to any patient. Please contact the administration."),
			frappe.PermissionError,
		)

	context.no_cache = 1
	context.parents = [{"name": _("My Account"), "route": "/me"}]
	context.body_class = "portal-page"

	context.assets = get_vite_assets()


def get_vite_assets(entry="src/patient_portal.js"):
	manifest_path = os.path.join(
		get_bench_path(), "apps", "healthcare", "healthcare", "public", "frontend", "manifest.json"
	)

	with open(manifest_path, "r") as f:
		manifest = json.load(f)

	return manifest[entry]
