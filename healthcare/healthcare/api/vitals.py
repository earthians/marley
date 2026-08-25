# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _
from frappe.utils import now_datetime

from healthcare.healthcare.api.nursing_common import default_company, has_value

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
		return [
			self.record_reading(template, value) for template, value in readings.items() if has_value(value)
		]

	def record_reading(self, template, value):
		observation = frappe.new_doc("Observation")
		observation.update(self.observation_defaults(template))
		self.set_result(observation, value)
		observation.insert(ignore_permissions=True)
		return observation.name

	def observation_defaults(self, template):
		return {
			"patient": self.patient,
			"observation_template": template,
			"reference_doctype": self.reference_doctype,
			"reference_docname": self.reference_name,
			"healthcare_practitioner": self.practitioner,
			"company": self.company,
			"result_datetime": now_datetime(),
		}

	def set_result(self, observation, value):
		data_type = observation.permitted_data_type or "Quantity"
		if data_type == "Text":
			observation.result_text = value
		else:
			observation.result_data = str(value)


def vital_sign_templates():
	"""Observation Templates seeded under the Vital Signs category."""
	return frappe.get_all(
		"Observation Template",
		filters={"observation_category": VITAL_SIGNS_CATEGORY},
		fields=["name", "observation", "abbr", "permitted_data_type", "permitted_unit"],
		order_by="creation asc",
	)


@frappe.whitelist()
def get_vital_sign_templates():
	return vital_sign_templates()


@frappe.whitelist()
def record_vitals(patient, readings, reference_doctype=None, reference_name=None, practitioner=None):
	if isinstance(readings, str):
		readings = json.loads(readings)

	if not readings:
		frappe.throw(_("Enter at least one reading"))

	recorder = VitalsRecorder(patient, reference_doctype, reference_name, practitioner)
	return recorder.record(readings)
