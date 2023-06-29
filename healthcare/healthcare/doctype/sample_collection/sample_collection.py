# -*- coding: utf-8 -*-
# Copyright (c) 2015, ESS and contributors
# For license information, please see license.txt


import frappe
import json
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

from healthcare.healthcare.doctype.observation.observation import add_observation
from frappe.utils import now_datetime


class SampleCollection(Document):
	def after_insert(self):
		if self.observation_sample_collection:
			for obs in self.observation_sample_collection:
				if obs.get("has_component"):
					observation = add_observation(
						self.patient,
						obs.get("observation_template"),
						"",
						"",
						"Sample Collection",
						self.name,
						"",
						"",
						self.reference_name
					)
					component_observations = frappe.get_all(
						"Observation Component",
						{"parent": obs.get("observation_template")},
						"observation_template",
					)
					data = []
					for d in component_observations:
						obs_temp = frappe.get_value(
							"Observation Template",
							d.get("observation_template"),
							[
								"sample_Type",
								"sample",
								"medical_department",
								"container_closure_color",
								"name as observation_template",
								"sample_qty",
							],
							as_dict=True,
						)
						obs_temp["status"] = "Open"
						obs_temp["component_observation_parent"] = observation
						data.append(obs_temp)
					frappe.db.set_value(
						"Observation Sample Collection",
						obs.get("name"),
						{
							"component_observation_parent": observation,
							"component_observations": json.dumps(data),
						},
					)

	def validate(self):
		if self.observation_sample_collection:
			for obs in self.observation_sample_collection:
				if obs.get("has_component") and obs.get("component_observations"):
					component_observations = json.loads(obs.get("component_observations"))
					if not any((comp['status'] == "Open") for comp in component_observations):
						obs.status = "Completed"

		if not any((obs.get("status") == "Open") for obs in self.observation_sample_collection):
			self.status = "Completed"
		else:
			self.status = "Partly Completed"


@frappe.whitelist()
def create_observation(selected, sample_collection, component_observations=[], child_name=None):
	invoice = frappe.db.get_value("Sample Collection", sample_collection, "reference_name")
	selected = json.loads(selected)
	if len(component_observations) > 0:
		component_observations = json.loads(component_observations)
	patient = frappe.db.get_value("Sample Collection", sample_collection, "patient")
	for obs in selected:
		if obs.get("status") == "Open":
			if not obs.get("has_component") or obs.get("has_component") == 0:
				observation = add_observation(
					patient,
					obs.get("observation_template"),
					"",
					"",
					"Sample Collection",
					sample_collection,
					obs.get("component_observation_parent"),
					obs.get("sample_id"),
					invoice
				)
				if observation:
					frappe.db.set_value(
						"Observation Sample Collection",
						obs.get("name"),
						{"status": "Completed", "collection_date_time": now_datetime()},
					)
			else:
				# to deal the component template checket from main table and collected
				if obs.get("component_observations"):
					component_observations = json.loads(obs.get("component_observations"))
					for comp in component_observations:
						observation = add_observation(
							patient,
							comp.get("observation_template"),
							"",
							"",
							"Sample Collection",
							sample_collection,
							obs.get("component_observation_parent"),
							obs.get("sample_id"),
							invoice
						)
						if observation:
							comp["status"] = "Completed"
							comp["collection_date_time"] = now_datetime()

					frappe.db.set_value(
						"Observation Sample Collection",
						obs.get("name"),
						{
							"component_observations": json.dumps(component_observations, default=str),
							"status": "Completed"
						},
					)
		# to deal individually checked from component dialog
		if component_observations:
			for comp in component_observations:
				if comp.get("observation_template") == obs.get("observation_template"):
					comp["status"] = "Completed"
					comp["collection_date_time"] = now_datetime()
	if child_name:
		frappe.db.set_value(
			"Observation Sample Collection",
			child_name,
			{"component_observations": json.dumps(component_observations, default=str)},
		)
