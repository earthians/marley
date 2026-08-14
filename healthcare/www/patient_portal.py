# Copyright (c) 2022, Frappe Technologies Pvt. Ltd. and Contributors
# GNU GPLv3 License. See license.txt

import frappe
from frappe import _
from frappe.translate import get_user_lang
from frappe.utils import cint, get_system_timezone
from frappe.utils.jinja_globals import is_rtl
from frappe.utils.telemetry import capture

no_cache = 1


def get_context():
	context = frappe._dict()
	context.boot = get_boot()
	if frappe.session.user != "Guest":
		capture("active_site", "patient_portal")
	return context


@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_context_for_dev():
	if not frappe.conf.developer_mode:
		frappe.throw(_("This method is only meant for developer mode"))
	return get_boot()


def get_boot():
	return frappe._dict(
		{
			"frappe_version": frappe.__version__,
			# The portal template is a STANDALONE html document — it does not extend
			# templates/web.html, so it inherits none of base.html's `dir`/`lang` handling and
			# would render `<html lang="en">` for every user, leaving Arabic text laid out LTR.
			# Same two keys, same source, as crm/www/crm.py.
			"lang": get_user_lang(),
			"text_direction": "rtl" if is_rtl() else "ltr",
			"default_route": get_default_route(),
			"site_name": frappe.local.site,
			"read_only_mode": frappe.flags.read_only,
			"csrf_token": frappe.sessions.get_csrf_token(),
			"setup_complete": cint(frappe.get_system_settings("setup_complete")),
			"sysdefaults": frappe.defaults.get_defaults(),
			"timezone": {
				"system": get_system_timezone(),
				"user": frappe.db.get_value("User", frappe.session.user, "time_zone")
				or get_system_timezone(),
			},
		}
	)


def get_default_route():
	return "/patient_portal"
