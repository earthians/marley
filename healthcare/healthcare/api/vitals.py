# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _

from healthcare.healthcare.api.nursing_common import ChartAccess, default_company, has_value
from healthcare.healthcare.doctype.observation.observation import set_observation_status

VITAL_SIGNS_CATEGORY = "Vital Signs"


class VitalsRecorder:
	"""Records vital sign readings as Observations of category Vital Signs."""

	def __init__(self, patient, reference_doctype=None, reference_name=None, practitioner=None):
		self.patient = patient
		self.reference_doctype = reference_doctype
		self.reference_name = reference_name
		self.practitioner = practitioner
		self.company = default_company()

	def record(self, readings):
		"""Takes {observation_template: value} and returns the observations created."""
		valid_readings = {template: value for template, value in readings.items() if has_value(value)}
		self.validate_templates(valid_readings)
		return [self.record_reading(template, value) for template, value in valid_readings.items()]

	def validate_templates(self, templates):
		template_names = list(templates)
		if not template_names:
			return

		vital_templates = set(
			frappe.get_all(
				"Observation Template",
				filters={
					"name": ["in", template_names],
					"observation_category": VITAL_SIGNS_CATEGORY,
				},
				pluck="name",
			)
		)
		non_vitals = [name for name in template_names if name not in vital_templates]
		if non_vitals:
			frappe.throw(
				_("Only {0} templates can be recorded here: {1}").format(
					VITAL_SIGNS_CATEGORY, ", ".join(non_vitals)
				)
			)

	def record_reading(self, template, value):
		observation = frappe.new_doc("Observation")
		observation.update(self.observation_defaults(template))
		self.set_result(observation, value)
		observation.insert()
		if (
			not observation.get("consumables")
			and not observation.has_component
			and observation.is_ready_for_approval()
			and observation.has_permission("submit")
		):
			set_observation_status(observation.name, "Approved")
		return observation.name

	def observation_defaults(self, template):
		return {
			"patient": self.patient,
			"observation_template": template,
			"reference_doctype": self.reference_doctype,
			"reference_docname": self.reference_name,
			"healthcare_practitioner": self.practitioner,
			"company": self.company,
		}

	def set_result(self, observation, value):
		observation.result = str(value)


def vital_sign_templates():
	"""Observation Templates seeded under the Vital Signs category."""
	return frappe.get_all(
		"Observation Template",
		filters={"observation_category": VITAL_SIGNS_CATEGORY},
		fields=["name", "observation", "abbr", "permitted_data_type", "permitted_unit"],
		order_by="creation asc",
	)


@frappe.whitelist()
def get_vital_sign_templates() -> list[dict]:
	return vital_sign_templates()


@frappe.whitelist()
def record_vitals(
	patient: str,
	readings: dict | str,
	reference_doctype: str | None = None,
	reference_name: str | None = None,
	practitioner: str | None = None,
) -> list[str]:
	if isinstance(readings, str):
		readings = json.loads(readings)

	if not readings:
		frappe.throw(_("Enter at least one reading"))

	ChartAccess(patient, reference_doctype, reference_name).to_write("Observation")
	recorder = VitalsRecorder(patient, reference_doctype, reference_name, practitioner)
	return recorder.record(readings)
