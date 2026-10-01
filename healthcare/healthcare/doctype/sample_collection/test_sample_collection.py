# Copyright (c) 2015, ESS and Contributors
# See license.txt

import frappe

from healthcare.healthcare.doctype.sample_collection.sample_collection import (
	SampleCollection,
	get_collection_status,
	get_or_add_observation,
	refresh_selected_rows,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestSampleCollection(HealthcareTestSuite):
	def test_validate_status_handles_all_collection_states(self):
		test_cases = [
			([], "Collected"),
			([frappe._dict({"status": "Open"})], "Pending"),
			([frappe._dict({"status": "Collected"})], "Collected"),
			([frappe._dict({"status": "Collected"}), frappe._dict({"status": "Open"})], "Partly Collected"),
		]

		for child_rows, expected_status in test_cases:
			with self.subTest(child_rows=child_rows, expected_status=expected_status):
				doc = frappe._dict(observation_sample_collection=child_rows, status=None)
				SampleCollection.validate(doc)
				self.assertEqual(doc.status, expected_status)

	def test_get_collection_status_handles_all_collection_states(self):
		test_cases = [
			([], "Collected"),
			([frappe._dict({"status": "Open"})], "Pending"),
			([frappe._dict({"status": "Collected"})], "Collected"),
			([frappe._dict({"status": "Collected"}), frappe._dict({"status": "Open"})], "Partly Collected"),
		]

		for child_rows, expected_status in test_cases:
			with self.subTest(child_rows=child_rows, expected_status=expected_status):
				self.assertEqual(get_collection_status(child_rows), expected_status)

	def test_refresh_selected_rows_skips_already_collected_stale_selection(self):
		sample_collection = make_sample_collection_with_rows()
		collected_row, open_row = sample_collection.observation_sample_collection
		context = frappe._dict(
			child_name=None,
			selected=[
				frappe._dict({"name": collected_row.name, "status": "Open"}),
				frappe._dict({"name": open_row.name, "status": "Open"}),
			],
		)

		refresh_selected_rows(context)

		self.assertEqual([row.name for row in context.selected], [open_row.name])

	def test_get_or_add_observation_reuses_existing_observation(self):
		sample_collection = make_sample_collection_with_rows()
		existing_observation = get_or_add_observation(
			patient=sample_collection.patient,
			template="_Test Observation with Sample",
			doc="Sample Collection",
			docname=sample_collection.name,
			parent="",
			company=sample_collection.company,
		)

		observation = get_or_add_observation(
			patient=sample_collection.patient,
			template="_Test Observation with Sample",
			doc="Sample Collection",
			docname=sample_collection.name,
			parent="",
			company=sample_collection.company,
		)

		self.assertEqual(observation, existing_observation)


def make_sample_collection_with_rows():
	sample_collection = frappe.get_doc(
		{
			"doctype": "Sample Collection",
			"naming_series": "HLC-SC-.YYYY.-",
			"patient": "_Test Patient",
			"company": "_Test Company",
			"observation_sample_collection": [
				{
					"observation_template": "_Test Observation with Sample",
					"status": "Collected",
					"specimen": "SPECIMEN-OLD",
				},
				{
					"observation_template": "_Test Observation without Sample",
					"status": "Open",
				},
			],
		}
	).insert(ignore_permissions=True)
	return sample_collection
