# Copyright (c) 2015, ESS and Contributors
# See license.txt

import json

import frappe

from healthcare.healthcare.doctype.observation_template.test_observation_template import (
	create_multi_level_template,
)
from healthcare.healthcare.doctype.sample_collection.sample_collection import (
	SampleCollection,
	create_component_observations,
	find_parent_observation,
	get_collection_status,
	insert_observation,
	mark_component_collected,
	set_component_observation_data,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestSampleCollection(HealthcareTestSuite):
	def test_validate_status_handles_all_collection_states(self):
		test_cases = [
			# An empty table (nothing added yet) has nothing collected - it's
			# Pending, not vacuously Collected.
			([], "Pending"),
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
			([], "Pending"),
			([frappe._dict({"status": "Open"})], "Pending"),
			([frappe._dict({"status": "Collected"})], "Collected"),
			([frappe._dict({"status": "Collected"}), frappe._dict({"status": "Open"})], "Partly Collected"),
		]

		for child_rows, expected_status in test_cases:
			with self.subTest(child_rows=child_rows, expected_status=expected_status):
				self.assertEqual(get_collection_status(child_rows), expected_status)

	def test_set_component_observation_data_recurses_through_sub_panels(self):
		package, sub_panel, leaf = create_multi_level_template()

		data = set_component_observation_data(package.name)

		self.assertEqual(len(data), 1)
		self.assertEqual(data[0]["observation_template"], sub_panel.name)
		self.assertTrue(data[0]["has_component"])

		nested = json.loads(data[0]["component_observations"])
		self.assertEqual(len(nested), 1)
		self.assertEqual(nested[0]["observation_template"], leaf.name)
		self.assertFalse(nested[0]["has_component"])

	def test_mark_component_collected_bubbles_status_up_through_sub_panels(self):
		package, _sub_panel, leaf = create_multi_level_template()
		components = set_component_observation_data(package.name)

		found = mark_component_collected(
			components, {"observation_template": leaf.name}, {1: "_Test Specimen"}
		)

		self.assertTrue(found)
		nested = json.loads(components[0]["component_observations"])
		self.assertEqual(nested[0]["status"], "Collected")
		self.assertEqual(nested[0]["specimen"], "_Test Specimen")
		# The sub-panel itself only has the one leaf, so once it's Collected
		# the sub-panel's own entry bubbles up to Collected too.
		self.assertEqual(components[0]["status"], "Collected")

	def test_find_parent_observation_resolves_a_deeply_nested_leaf(self):
		package, sub_panel, leaf = create_multi_level_template()
		doc = new_sample_collection_with_package(package)
		row = doc.observation_sample_collection[0]
		components = json.loads(row.component_observations)

		self.assertEqual(
			find_parent_observation(components, leaf.name), components[0]["component_observation_parent"]
		)
		# A template that isn't nested anywhere under a sub-panel (e.g. the
		# top-level panel itself) has no sub-panel match - the caller falls
		# back to the row's own component_observation_parent for that case.
		self.assertIsNone(find_parent_observation(components, sub_panel.name))

	def test_collecting_a_deeply_nested_leaf_parents_it_under_its_sub_panel(self):
		package, _sub_panel, leaf = create_multi_level_template()
		doc = new_sample_collection_with_package(package)
		row = doc.observation_sample_collection[0]

		sub_panel_data = json.loads(row.component_observations)[0]
		sub_panel_observation_name = sub_panel_data["component_observation_parent"]
		leaf_data = json.loads(sub_panel_data["component_observations"])[0]
		leaf_data["idx"] = 1

		insert_observation(
			selected=json.dumps([leaf_data]),
			sample_collection=doc.name,
			component_observations=row.component_observations,
			child_name=row.name,
		)

		leaf_observation = frappe.get_all(
			"Observation",
			filters={"observation_template": leaf.name, "reference_docname": doc.name},
			fields=["name", "parent_observation"],
		)
		self.assertEqual(len(leaf_observation), 1)
		# Not row.component_observation_parent (Package 1) - the leaf's real,
		# immediate parent is the sub-panel's own Observation.
		self.assertEqual(leaf_observation[0]["parent_observation"], sub_panel_observation_name)


def new_sample_collection():
	doc = frappe.get_doc(
		{
			"doctype": "Sample Collection",
			"patient": "_Test Patient",
			"company": "_Test Company",
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def new_sample_collection_with_package(package):
	"""A saved Sample Collection with one top-level row for `package`
	(a multi-level grouped template), its own Observation eagerly created,
	and its nested component_observations tree fully chained - the same
	shape set_component_observation_data()/create_component_observations()
	build for any multi-level panel, without going through any add/remove
	UI flow."""
	doc = new_sample_collection()
	row = doc.append(
		"observation_sample_collection",
		{"observation_template": package.name, "has_component": 1, "status": "Open"},
	)
	data = set_component_observation_data(package.name)
	create_component_observations(doc.patient, doc.company, doc.referring_practitioner, data, None)
	row.component_observations = json.dumps(data, default=str)
	doc.save(ignore_permissions=True)
	doc.reload()
	return doc
