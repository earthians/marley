import frappe

from healthcare.healthcare.doctype.observation.observation import get_observation_result_flag


def execute():
	frappe.reload_doc("healthcare", "doctype", "observation")

	if not frappe.db.has_column("Observation", "result_flag"):
		return

	observations = frappe.get_all(
		"Observation",
		filters={"result": ["is", "set"]},
		fields=["name", "observation_template", "permitted_data_type", "result", "gender", "days"],
	)

	for observation in observations:
		flag, color = get_observation_result_flag(frappe._dict(observation))
		if flag:
			frappe.db.set_value(
				"Observation",
				observation.name,
				{"result_flag": flag, "result_flag_color": color},
				update_modified=False,
			)
