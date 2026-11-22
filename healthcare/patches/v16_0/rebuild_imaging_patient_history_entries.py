import frappe

from healthcare.healthcare.doctype.patient_history_settings.patient_history_settings import (
	set_subject_field,
)


def execute():
	imaging_observations = frappe.get_all(
		"Observation",
		filters={"observation_category": "Imaging", "docstatus": ["!=", 2]},
		fields=["name", "parent_observation"],
	)
	if not imaging_observations:
		return

	# Patient Medical Record is always keyed to the panel/root Observation, never
	# to an individual component - see create_medical_record().
	references = {obs.parent_observation or obs.name for obs in imaging_observations}

	records = frappe.get_all(
		"Patient Medical Record",
		filters={"reference_doctype": "Observation", "reference_name": ["in", list(references)]},
		fields=["name", "reference_name"],
	)

	for record in records:
		observation = frappe.get_doc("Observation", record.reference_name)
		subject = set_subject_field(observation)
		frappe.db.set_value("Patient Medical Record", record.name, "subject", subject, update_modified=False)
