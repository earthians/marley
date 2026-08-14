# Copyright (c) 2022, Frappe Technologies Pvt. Ltd. and Contributors
# GNU GPLv3 License. See license.txt

import frappe
from frappe import _
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
	# The portal template is a STANDALONE html document — it does not extend
	# templates/web.html, so it inherits none of base.html's `dir`/`lang` handling and
	# would render `<html lang="en">` for every user, leaving Arabic text laid out LTR.
	#
	# set_user_lang() resolves the user's language AND assigns it to frappe.local.lang
	# (see frappe.utils.translations.set_user_lang) — the same variable is_rtl() reads.
	# Calling it first, then reading frappe.local.lang for `lang`, guarantees `lang` and
	# `text_direction` describe the same resolved language. Deriving `lang` from
	# get_user_lang() directly instead (bypassing the frappe.local.lang assignment) can
	# desync the two: get_user_lang() prefers the User doctype's `language` field, while
	# is_rtl() reads frappe.local.lang, which the current request may have already set to
	# a different value (system default, `?lang=`, Accept-Language). This is exactly how
	# frappe's own desk boot (frappe.boot.get_bootinfo) resolves both.
	frappe.set_user_lang(frappe.session.user)

	return frappe._dict(
		{
			"frappe_version": frappe.__version__,
			"lang": frappe.local.lang,
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
