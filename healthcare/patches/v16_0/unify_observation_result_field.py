import frappe

# result_float carried no data of its own anywhere in the app (hidden mirror,
# never written outside the removed formula-cache path), so it's listed here
# only to be checked for, never actually read into `result`.
DEAD_OBSERVATION_COLUMNS = [
	"result_data",
	"result_text",
	"result_select",
	"result_boolean",
	"result_datetime",
	"result_time",
	"result_period_from",
	"result_period_to",
	"result_attach",
	"result_float",
]


def execute():
	consolidate_observation_results()


def consolidate_observation_results():
	if not frappe.db.table_exists("Observation"):
		return

	existing_old_columns = [c for c in DEAD_OBSERVATION_COLUMNS if frappe.db.has_column("Observation", c)]
	if not existing_old_columns:
		# Already migrated (e.g. patch re-run), or a fresh install with no legacy columns.
		return

	Observation = frappe.qb.DocType("Observation")
	rows = (
		frappe.qb.from_(Observation)
		.select(
			Observation.name,
			Observation.permitted_data_type,
			*[Observation[c] for c in existing_old_columns],
		)
		.run(as_dict=True)
	)

	for row in rows:
		value = consolidate_result(row)
		if value:
			frappe.db.set_value("Observation", row.name, "result", value, update_modified=False)


def consolidate_result(row):
	if row.get("permitted_data_type") == "Period":
		period_from = row.get("result_period_from")
		period_to = row.get("result_period_to")
		if period_from or period_to:
			return frappe.as_json(
				{"from": str(period_from) if period_from else "", "to": str(period_to) if period_to else ""}
			)
		return None

	for column in (
		"result_data",
		"result_text",
		"result_select",
		"result_boolean",
		"result_datetime",
		"result_time",
		"result_attach",
	):
		value = row.get(column)
		if value not in (None, ""):
			return str(value)

	return None
