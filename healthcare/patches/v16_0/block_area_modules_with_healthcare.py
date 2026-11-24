import frappe

AREA_MODULES = (
	"Outpatient",
	"Diagnostics",
	"Emergency",
	"Inpatient",
	"Rehabilitation",
	"Insurance",
	"Healthcare Setup",
)


def execute():
	for parent in parents_blocking_healthcare():
		blocked = set(blocked_modules(parent))
		for idx, module in enumerate(sorted(set(AREA_MODULES) - blocked), start=len(blocked) + 1):
			add_block(parent, module, idx)


def parents_blocking_healthcare() -> list[frappe._dict]:
	return frappe.get_all(
		"Block Module",
		filters={"module": "Healthcare"},
		fields=["parenttype", "parent", "parentfield"],
		distinct=True,
	)


def blocked_modules(parent: frappe._dict) -> list[str]:
	return frappe.get_all(
		"Block Module",
		filters={"parenttype": parent.parenttype, "parent": parent.parent},
		pluck="module",
	)


def add_block(parent: frappe._dict, module: str, idx: int) -> None:
	frappe.get_doc(
		{
			"doctype": "Block Module",
			"parenttype": parent.parenttype,
			"parent": parent.parent,
			"parentfield": parent.parentfield,
			"module": module,
			"idx": idx,
		}
	).db_insert()
