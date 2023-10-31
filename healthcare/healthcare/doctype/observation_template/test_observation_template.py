# Copyright (c) 2023, healthcare and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase


class TestObservationTemplate(FrappeTestCase):
	def test_observation_item(self):
		obs_template = create_observation_template("Total Cholesterol", sample_required=False)
		self.assertTrue(frappe.db.exists("Item", obs_template.item_code))
		self.assertEqual(
			frappe.db.get_value("Item Price", {"item_code": obs_template.item_code}, "price_list_rate"),
			obs_template.rate,
		)


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
