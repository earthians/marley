"""Flag pre-existing Insurance Patient Registers as legacy.

Every register created before approval validity dates were captured in the portal
came from the legacy TRICARE import/reconcile (or an admin running that flow), so
it has no Valid From / Valid To. Marking them makes it possible to tell them
apart from registers created in ERPNext, which are the only ones the portal
prompts to "Add validity days".
"""

from __future__ import annotations

import frappe


def execute():
	if not frappe.db.table_exists("Insurance Patient Register"):
		return
	if not frappe.db.has_column("Insurance Patient Register", "legacy"):
		return

	frappe.db.sql(
		"""
		update `tabInsurance Patient Register`
		set legacy = 1
		where ifnull(legacy, 0) = 0
		"""
	)
	frappe.db.commit()
