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
			components, {"observation_template": leaf.name}, {leaf.name: "_Test Specimen"}
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

	def test_collecting_leaves_at_different_nesting_depths_does_not_cross_contaminate_specimens(self):
		# idx collides across nesting levels - this used to make one leaf
		# steal the other's specimen when collected in the same batch.
		package, sub_panel, urine_leaf, serum_leaf = create_sibling_and_nested_leaf_template()
		doc = new_sample_collection_with_package(package)
		row = doc.observation_sample_collection[0]

		components = json.loads(row.component_observations)
		urine_entry = next(c for c in components if c["observation_template"] == urine_leaf.name)
		sub_panel_entry = next(c for c in components if c["observation_template"] == sub_panel.name)
		serum_entry = json.loads(sub_panel_entry["component_observations"])[0]
		self.assertEqual(serum_entry["observation_template"], serum_leaf.name)

		insert_observation(
			selected=json.dumps([urine_entry, serum_entry]),
			sample_collection=doc.name,
			component_observations=row.component_observations,
			child_name=row.name,
		)

		doc.reload()
		row = doc.observation_sample_collection[0]
		components = json.loads(row.component_observations)
		urine_entry = next(c for c in components if c["observation_template"] == urine_leaf.name)
		sub_panel_entry = next(c for c in components if c["observation_template"] == sub_panel.name)
		serum_entry = json.loads(sub_panel_entry["component_observations"])[0]

		self.assertTrue(urine_entry["specimen"])
		self.assertTrue(serum_entry["specimen"])
		self.assertNotEqual(urine_entry["specimen"], serum_entry["specimen"])
		self.assertEqual(
			frappe.db.get_value("Specimen", urine_entry["specimen"], "specimen_type"),
			"_Test Sample - Urine",
		)
		self.assertEqual(
			frappe.db.get_value("Specimen", serum_entry["specimen"], "specimen_type"),
			"_Test Sample - Blood Sample",
		)


def create_sibling_and_nested_leaf_template():
	"""A direct leaf and a nested one that can share the same client-assigned
	idx, reproducing the cross-depth idx collision."""
	urine_leaf = create_lab_sample_leaf("_Test Sibling Urine Leaf", "_Test Sample - Urine")
	serum_leaf = create_lab_sample_leaf("_Test Sibling Serum Leaf", "_Test Sample - Blood Sample")

	if frappe.db.exists("Observation Template", "_Test Sibling Sub Panel"):
		sub_panel = frappe.get_doc("Observation Template", "_Test Sibling Sub Panel")
	else:
		sub_panel = frappe.get_doc(
			{
				"doctype": "Observation Template",
				"observation": "_Test Sibling Sub Panel",
				"item_code": "_Test Sibling Sub Panel",
				"observation_category": "Laboratory",
				"item_group": "Services",
				"has_component": 1,
				"rate": 300,
				"abbr": "TSSP",
				"is_billable": 1,
				"observation_component": [{"observation_template": serum_leaf.name}],
			}
		)
		sub_panel.insert()

	if frappe.db.exists("Observation Template", "_Test Sibling Package"):
		package = frappe.get_doc("Observation Template", "_Test Sibling Package")
	else:
		package = frappe.get_doc(
			{
				"doctype": "Observation Template",
				"observation": "_Test Sibling Package",
				"item_code": "_Test Sibling Package",
				"observation_category": "Laboratory",
				"item_group": "Services",
				"has_component": 1,
				"rate": 300,
				"abbr": "TSPKG",
				"is_billable": 1,
				"observation_component": [
					{"observation_template": urine_leaf.name},
					{"observation_template": sub_panel.name},
				],
			}
		)
		package.insert()

	return package, sub_panel, urine_leaf, serum_leaf


def create_lab_sample_leaf(name, sample):
	if frappe.db.exists("Observation Template", name):
		return frappe.get_doc("Observation Template", name)
	template = frappe.new_doc("Observation Template")
	template.observation = name
	template.item_code = name
	template.observation_category = "Laboratory"
	template.permitted_data_type = "Quantity"
	template.permitted_unit = "mg / dl"
	template.item_group = "Services"
	template.sample_collection_required = 1
	template.sample = sample
	template.rate = 300
	template.abbr = "".join(w[0] for w in name.split())
	template.is_billable = 1
	template.save()
	return template


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
