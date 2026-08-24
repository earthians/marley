# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe

from healthcare.healthcare.api.nursing import (
	VITAL_SIGNS_CATEGORY,
	PatientSnapshot,
	get_snapshot,
	record_vitals,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestNursing(HealthcareTestSuite):
	def setUp(self):
		self.patient = frappe.get_list("Patient", pluck="name")[0]
		self.template = self.ensure_vital_sign_template()

	def ensure_vital_sign_template(self):
		name = "_Test Pulse"
		if not frappe.db.exists("Observation Template", name):
			frappe.get_doc(
				{
					"doctype": "Observation Template",
					"observation": name,
					"abbr": "TPR",
					"observation_category": VITAL_SIGNS_CATEGORY,
					"permitted_data_type": "Quantity",
				}
			).insert(ignore_permissions=True)
		return name

	def record(self, value, **kwargs):
		return record_vitals(patient=self.patient, readings={self.template: value}, **kwargs)

	def test_record_vitals_creates_observation_under_vital_signs(self):
		names = self.record(88)

		self.assertEqual(len(names), 1)
		observation = frappe.get_doc("Observation", names[0])
		self.assertEqual(observation.patient, self.patient)
		self.assertEqual(observation.result_data, "88")
		self.assertEqual(observation.observation_category, VITAL_SIGNS_CATEGORY)

	def test_record_vitals_links_the_source_document(self):
		names = self.record(92, reference_doctype="Patient", reference_name=self.patient)

		observation = frappe.get_doc("Observation", names[0])
		self.assertEqual(observation.reference_doctype, "Patient")
		self.assertEqual(observation.reference_docname, self.patient)

	def test_record_vitals_skips_blank_readings(self):
		names = record_vitals(patient=self.patient, readings={self.template: "  "})

		self.assertEqual(names, [])

	def test_record_vitals_without_readings_throws(self):
		self.assertRaises(frappe.ValidationError, record_vitals, patient=self.patient, readings={})

	def test_record_vitals_accepts_json_readings(self):
		names = record_vitals(patient=self.patient, readings=f'{{"{self.template}": 101}}')

		self.assertEqual(frappe.db.get_value("Observation", names[0], "result_data"), "101")

	def test_snapshot_returns_readings_oldest_first(self):
		for value in (70, 80, 90):
			self.record(value)

		readings = PatientSnapshot(self.patient).vitals()[self.template]

		self.assertEqual([reading.value for reading in readings][-3:], ["70", "80", "90"])

	def test_snapshot_limits_readings(self):
		for value in range(12):
			self.record(value)

		readings = PatientSnapshot(self.patient, limit=10).vitals()[self.template]

		self.assertEqual(len(readings), 10)

	def test_snapshot_payload_has_every_panel(self):
		snapshot = get_snapshot(self.patient)

		self.assertIn("vitals", snapshot)
		self.assertIn("next_tasks", snapshot)
		self.assertIn("last_note", snapshot)
