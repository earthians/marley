"""Fix legacy Lab Test cost centres that still hold the Oracle branch code ``10``.

Oracle ``BRANCH_NUM`` 10 maps to Cost Center ``British Medical Center W.L.L - SPH``.
Some legacy imports kept the raw ``10`` value on ``Lab Test.cost_center``.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint

FROM_COST_CENTER = "10"
TO_COST_CENTER = "British Medical Center W.L.L - SPH"


def _require_update_roles() -> None:
	user = frappe.session.user
	if user == "Administrator":
		return
	roles = set(frappe.get_roles(user))
	if roles.intersection({"System Manager", "Healthcare Administrator"}):
		return
	frappe.throw(
		_("Only System Manager or Healthcare Administrator can run this update."),
		frappe.PermissionError,
	)


def _candidates() -> list[dict]:
	"""Legacy Lab Tests still carrying cost_center = 10."""
	return frappe.get_all(
		"Lab Test",
		filters={
			"is_legacy_import": 1,
			"cost_center": FROM_COST_CENTER,
		},
		fields=["name", "patient", "patient_name", "date", "lab_test_name", "cost_center"],
		order_by="date desc, name",
	)


@frappe.whitelist()
def preview_fix_legacy_lab_test_cost_center_10() -> dict:
	"""Preview how many legacy Lab Tests still have cost_center = 10."""
	_require_update_roles()
	if not frappe.db.exists("Cost Center", TO_COST_CENTER):
		frappe.throw(_("Cost Center {0} does not exist.").format(TO_COST_CENTER))

	rows = _candidates()
	sample = [
		{
			"name": r.name,
			"patient_name": r.patient_name,
			"date": str(r.date) if r.date else "",
			"lab_test_name": r.lab_test_name,
			"cost_center": r.cost_center,
		}
		for r in rows[:25]
	]
	return {
		"from_cost_center": FROM_COST_CENTER,
		"to_cost_center": TO_COST_CENTER,
		"count": len(rows),
		"sample": sample,
		"names": [r.name for r in rows],
	}


@frappe.whitelist()
def fix_legacy_lab_test_cost_center_10() -> dict:
	"""Set Lab Test.cost_center from ``10`` → British Medical Center W.L.L - SPH.

	Only touches legacy imports (``is_legacy_import = 1``). Uses ``frappe.db.set_value``.
	"""
	_require_update_roles()
	if not frappe.db.exists("Cost Center", TO_COST_CENTER):
		frappe.throw(_("Cost Center {0} does not exist.").format(TO_COST_CENTER))

	rows = _candidates()
	updated = []
	for row in rows:
		frappe.db.set_value(
			"Lab Test",
			row.name,
			"cost_center",
			TO_COST_CENTER,
			update_modified=False,
		)
		updated.append(row.name)

	frappe.db.commit()
	return {
		"ok": True,
		"from_cost_center": FROM_COST_CENTER,
		"to_cost_center": TO_COST_CENTER,
		"updated_count": len(updated),
		"updated": updated,
		"message": _("Updated {0} legacy Lab Test(s): {1} → {2}").format(
			cint(len(updated)), FROM_COST_CENTER, TO_COST_CENTER
		),
	}
