# Copyright (c) 2023, healthcare and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase


class TestObservationTemplate(IntegrationTestCase):
	def test_observation_item(self):
		obs_template = create_observation_template("Total Cholesterol", sample_required=False)
		self.assertTrue(frappe.db.exists("Item", obs_template.item_code))
		self.assertEqual(
			frappe.db.get_value("Item Price", {"item_code": obs_template.item_code}, "price_list_rate"),
			obs_template.rate,
		)

	def test_self_reference_not_allowed(self):
		parent = create_grouped_observation_template("Fasting and PP Sugar")

		parent.append("observation_component", {"observation_template": parent.name})

		with self.assertRaises(frappe.ValidationError):
			parent.save()

	def test_circular_reference_not_allowed(self):
		parent = frappe.get_doc(
			{
				"doctype": "Observation Template",
				"observation": "Parent Observation Test",
				"item_code": "POT",
				"observation_category": "Laboratory",
				"item_group": "Services",
				"has_component": 1,
				"rate": 300,
				"is_billable": 1,
			}
		)
		parent.save()

		child = frappe.get_doc(
			{
				"doctype": "Observation Template",
				"observation": "Child Observation Test",
				"item_code": "COT",
				"observation_category": "Laboratory",
				"item_group": "Services",
				"has_component": 1,
				"rate": 300,
				"is_billable": 1,
			}
		)
		child.save()

		parent.append("observation_component", {"observation_template": child.name})
		parent.save()

		child.append("observation_component", {"observation_template": parent.name})

		with self.assertRaises(frappe.ValidationError):
			child.save()

	def test_nesting_depth_limit(self):
		lvl1 = frappe.get_doc(
			{
				"doctype": "Observation Template",
				"observation": "Package 1",
				"item_code": "PKG1",
				"observation_category": "Laboratory",
				"item_group": "Services",
				"has_component": 1,
				"is_billable": 1,
				"rate": 300,
			}
		)
		lvl1.save()

		lvl2 = frappe.get_doc(
			{
				"doctype": "Observation Template",
				"observation": "Complete Blood Count",
				"item_code": "CBC",
				"observation_category": "Laboratory",
				"item_group": "Services",
				"has_component": 1,
				"is_billable": 1,
				"rate": 300,
			}
		)
		lvl2.save()

		lvl3 = frappe.get_doc(
			{
				"doctype": "Observation Template",
				"observation": "Differential Leukocyte Count",
				"item_code": "DLC",
				"observation_category": "Laboratory",
				"item_group": "Services",
				"has_component": 1,
				"is_billable": 1,
				"rate": 300,
			}
		)
		lvl3.save()

		lvl4 = frappe.get_doc(
			{
				"doctype": "Observation Template",
				"observation": "Lymphocytes",
				"item_code": "LYM",
				"observation_category": "Laboratory",
				"item_group": "Services",
				"has_component": 1,
				"is_billable": 1,
				"rate": 300,
			}
		)
		lvl4.save()

		lvl1.append("observation_component", {"observation_template": lvl2.name})
		lvl1.save()

		lvl2.append("observation_component", {"observation_template": lvl3.name})
		lvl2.save()

		lvl3.append("observation_component", {"observation_template": lvl4.name})
		lvl3.save()

		lvl5 = frappe.get_doc(
			{
				"doctype": "Observation Template",
				"observation": "TooDeep",
				"item_code": "TD",
				"observation_category": "Laboratory",
				"item_group": "Services",
				"has_component": 1,
				"is_billable": 1,
				"rate": 300,
			}
		)
		lvl5.save()

		lvl4.reload()
		lvl4.append("observation_component", {"observation_template": lvl5.name})

		with self.assertRaises(frappe.ValidationError):
			lvl4.save()


def create_observation_template(obs_name, idx="", sample_required=None):
	if frappe.db.exists("Observation Template", obs_name + str(idx)):
		return frappe.get_doc("Observation Template", obs_name + str(idx))
	template = frappe.new_doc("Observation Template")
	template.observation = obs_name + str(idx)
	template.item_code = obs_name + str(idx)
	template.observation_category = "Laboratory"
	template.permitted_data_type = "Quantity"
	template.permitted_unit = "mg / dl"
	template.item_group = "Services"
	template.sample_collection_required = sample_required
	template.rate = 300
	template.abbr = "TC" + str(idx)
	template.is_billable = 1
	template.save()
	return template


def create_grouped_observation_template(obs_name, idx="", sample_required=None):
	if frappe.db.exists("Observation Template", obs_name + str(idx)):
		return frappe.get_doc("Observation Template", obs_name + str(idx))
	template = frappe.new_doc("Observation Template")
	template.observation = obs_name + str(idx)
	template.item_code = obs_name + str(idx)
	template.observation_category = "Laboratory"
	template.item_group = "Services"
	template.has_component = 1
	template.rate = 300
	template.abbr = "CBC" + str(idx)
	template.is_billable = 1
	child_idx = (idx if idx else 0) + 1
	obs_template = create_observation_template(obs_name, child_idx, sample_required)
	template.append(
		"observation_component",
		{
			"observation_template": obs_template.name,
			"abbr": "CBC" + str(child_idx),
		},
	)
	template.save()
	return template
