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

	def readings_for(self, snapshot_vitals):
		entry = next(entry for entry in snapshot_vitals if entry["template"] == self.template)
		return entry["readings"]

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

		readings = self.readings_for(PatientSnapshot(self.patient).vitals())

		self.assertEqual([reading.value for reading in readings][-3:], ["70", "80", "90"])

	def test_snapshot_limits_readings(self):
		for value in range(12):
			self.record(value)

		readings = self.readings_for(PatientSnapshot(self.patient, limit=10).vitals())

		self.assertEqual(len(readings), 10)

	def test_seeder_backfills_units_on_existing_templates(self):
		from healthcare.setup import create_vital_sign_observation_templates

		frappe.db.set_value("Observation Template", {"abbr": "PR"}, "permitted_unit", None)

		create_vital_sign_observation_templates()

		self.assertEqual(
			frappe.db.get_value("Observation Template", {"abbr": "PR"}, "permitted_unit"), "/min"
		)

	def test_pain_score_is_rated_on_a_score(self):
		self.assertEqual(
			frappe.db.get_value("Observation Template", {"abbr": "PAIN"}, "permitted_unit"), "Score"
		)

	def test_snapshot_vitals_carry_template_metadata(self):
		self.record(88)

		entry = next(
			entry for entry in PatientSnapshot(self.patient).vitals() if entry["template"] == self.template
		)

		self.assertEqual(entry["abbr"], "TPR")
		self.assertEqual(entry["label"], self.template)

	def test_snapshot_payload_has_every_panel(self):
		snapshot = get_snapshot(self.patient)

		self.assertIn("vitals", snapshot)
		self.assertIn("next_tasks", snapshot)
		self.assertIn("last_note", snapshot)


class TestNursingIntakeOutput(HealthcareTestSuite):
	def setUp(self):
		from healthcare.setup import create_intake_output_types

		self.patient = frappe.get_list("Patient", pluck="name")[0]
		create_intake_output_types()
		frappe.db.delete("Intake Output Entry", {"patient": self.patient})

	def record(self, *entries):
		from healthcare.healthcare.api.nursing import record_intake_output

		return record_intake_output(patient=self.patient, entries=list(entries))

	def summary(self):
		from healthcare.healthcare.api.nursing import get_intake_output_summary

		return get_intake_output_summary(self.patient)

	def test_records_one_entry_per_row(self):
		names = self.record(
			{"intake_output_type": "Oral", "volume": 200},
			{"intake_output_type": "Urine", "volume": 550},
		)

		self.assertEqual(len(names), 2)

	def test_summary_totals_each_direction(self):
		self.record(
			{"intake_output_type": "Oral", "volume": 200},
			{"intake_output_type": "IV Fluid", "volume": 600},
			{"intake_output_type": "Urine", "volume": 550},
		)

		summary = self.summary()

		self.assertEqual(summary["intake"], 800)
		self.assertEqual(summary["output"], 550)

	def test_summary_balance_is_intake_less_output(self):
		self.record(
			{"intake_output_type": "Oral", "volume": 900},
			{"intake_output_type": "Urine", "volume": 400},
		)

		self.assertEqual(self.summary()["balance"], 500)

	def test_recording_nothing_throws(self):
		self.assertRaises(frappe.ValidationError, self.record)


class TestNursingPatientSearch(HealthcareTestSuite):
	def setUp(self):
		self.patient = frappe.get_list("Patient", pluck="name")[0]

	def find(self, term, admitted_only=0):
		from healthcare.healthcare.api.nursing import find_patients

		return find_patients(term, admitted_only)

	def test_finds_a_patient_by_identifier(self):
		names = [row.name for row in self.find(self.patient)]

		self.assertIn(self.patient, names)

	def test_finds_a_patient_by_name(self):
		patient_name = frappe.db.get_value("Patient", self.patient, "patient_name")

		names = [row.name for row in self.find(patient_name)]

		self.assertIn(self.patient, names)

	def test_blank_term_throws(self):
		self.assertRaises(frappe.ValidationError, self.find, "   ")

	def test_admitted_only_excludes_patients_without_a_bed(self):
		frappe.db.delete("Inpatient Record", {"patient": self.patient})

		names = [row.name for row in self.find(self.patient, admitted_only=1)]

		self.assertNotIn(self.patient, names)

	def test_finds_a_patient_by_inpatient_record_number(self):
		record = frappe.get_all("Inpatient Record", filters={"patient": self.patient}, pluck="name", limit=1)
		if not record:
			self.skipTest("no inpatient record for the test patient")

		matches = self.find(record[0])

		self.assertEqual(matches[0]["name"], self.patient)
		self.assertEqual(matches[0]["reference_doctype"], "Inpatient Record")
		self.assertEqual(matches[0]["reference_name"], record[0])


class TestNursingTasks(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		self.patient = frappe.get_list("Patient", pluck="name")[0]
		self.activity = frappe.get_list("Healthcare Activity", pluck="name")[0]
		frappe.db.delete("Nursing Task", {"patient": self.patient})

	def make_task(self, status="Draft"):
		return frappe.get_doc(
			{
				"doctype": "Nursing Task",
				"patient": self.patient,
				"activity": self.activity,
				"status": status,
				"company": frappe.get_list("Company", pluck="name")[0],
				"requested_start_time": frappe.utils.now_datetime(),
			}
		).insert(ignore_permissions=True)

	def tasks(self):
		from healthcare.healthcare.api.nursing import get_nursing_tasks

		return get_nursing_tasks(self.patient)

	def test_a_draft_task_is_listed_so_it_can_be_found(self):
		task = self.make_task()

		self.assertIn(task.name, [row.name for row in self.tasks()])

	def test_sending_a_draft_to_the_worklist_submits_it(self):
		from healthcare.healthcare.api.nursing import update_nursing_task

		task = self.make_task()

		update_nursing_task(task.name, "Requested")

		self.assertEqual(frappe.db.get_value("Nursing Task", task.name, "docstatus"), 1)

	def test_starting_a_task_stamps_its_start_time(self):
		from healthcare.healthcare.api.nursing import update_nursing_task

		task = self.make_task(status="Requested")

		update_nursing_task(task.name, "In Progress")

		self.assertTrue(frappe.db.get_value("Nursing Task", task.name, "task_start_time"))

	def test_a_task_nobody_picked_up_lapses_to_missed(self):
		from healthcare.healthcare.api.nursing import TASK_LAPSE_HOURS, lapse_missed_tasks

		task = self.make_task(status="Requested")
		frappe.db.set_value(
			"Nursing Task",
			task.name,
			"requested_start_time",
			frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-(TASK_LAPSE_HOURS + 1)),
		)

		lapse_missed_tasks(self.patient)

		self.assertEqual(frappe.db.get_value("Nursing Task", task.name, "status"), "Missed")

	def test_a_task_in_progress_never_lapses(self):
		from healthcare.healthcare.api.nursing import (
			TASK_LAPSE_HOURS,
			lapse_missed_tasks,
			update_nursing_task,
		)

		task = self.make_task(status="Requested")
		update_nursing_task(task.name, "In Progress")
		frappe.db.set_value(
			"Nursing Task",
			task.name,
			"requested_start_time",
			frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-(TASK_LAPSE_HOURS + 1)),
		)

		lapse_missed_tasks(self.patient)

		self.assertEqual(frappe.db.get_value("Nursing Task", task.name, "status"), "In Progress")

	def test_a_task_still_within_its_window_does_not_lapse(self):
		from healthcare.healthcare.api.nursing import lapse_missed_tasks

		task = self.make_task(status="Requested")

		lapse_missed_tasks(self.patient)

		self.assertEqual(frappe.db.get_value("Nursing Task", task.name, "status"), "Requested")
