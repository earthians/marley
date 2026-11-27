import frappe
from frappe.query_builder.functions import IfNull

HEALTHCARE_ROLES = [
	"Physician",
	"Nursing User",
	"Laboratory User",
	"LabTest Approver",
	"Healthcare Administrator",
]
LANDING_WORKSPACE = "Healthcare"


def execute():
	users = healthcare_users()
	if not users:
		return
	user = frappe.qb.DocType("User")
	(
		frappe.qb.update(user)
		.set(user.default_workspace, LANDING_WORKSPACE)
		.where(user.name.isin(users))
		.where(user.user_type == "System User")
		.where(IfNull(user.default_workspace, "") == "")
	).run()


def healthcare_users() -> list[str]:
	with_role = frappe.get_all(
		"Has Role",
		filters={"parenttype": "User", "role": ["in", HEALTHCARE_ROLES]},
		pluck="parent",
		distinct=True,
	)
	return sorted(set(with_role) - set(users_blocking_healthcare()))


def users_blocking_healthcare() -> list[str]:
	return frappe.get_all(
		"Block Module",
		filters={"parenttype": "User", "module": "Healthcare"},
		pluck="parent",
	)
