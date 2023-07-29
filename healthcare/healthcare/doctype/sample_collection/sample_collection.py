# -*- coding: utf-8 -*-
# Copyright (c) 2015, ESS and contributors
# For license information, please see license.txt


import frappe
import json
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

from healthcare.healthcare.doctype.observation.observation import add_observation

from healthcare.healthcare.doctype.observation_template.observation_template import get_observation_template_details

from frappe.utils import now_datetime


class SampleCollection(Document):
	def after_insert(self):
		if self.observation_sample_collection:
			for obs in self.observation_sample_collection:
				if obs.get("has_component"):
					sample_reqd_component_obs, non_sample_reqd_component_obs = get_observation_template_details(obs.get("observation_template"))
					data = []
					for d in sample_reqd_component_obs:
						obs_temp = frappe.get_value(
							"Observation Template",
							d,
							[
								"sample_type",
								"sample",
								"medical_department",
								"container_closure_color",
								"name as observation_template",
								"sample_qty",
							],
							as_dict=True,
						)
						obs_temp["status"] = "Open"
						data.append(obs_temp)
					frappe.db.set_value(
						"Observation Sample Collection",
						obs.get("name"),
						{
							"component_observations": json.dumps(data),
						},
					)

	def validate(self):
		if self.observation_sample_collection:
			for obs in self.observation_sample_collection:
				if obs.get("has_component") and obs.get("component_observations"):
					component_observations = json.loads(obs.get("component_observations"))
					if not any((comp['status'] == "Open") for comp in component_observations):
						obs.status = "Collected"

		if not any((obs.get("status") == "Open") for obs in self.observation_sample_collection):
			self.status = "Collected"
		else:
			self.status = "Partly Collected"

	def before_submit(self):
		if [sample for sample in self.observation_sample_collection if sample.status != "Collected"]:
			frappe.throw(
				msg=_("Cannot Submit, not all samples are marked as 'Collected'."), title=_("Not Allowed")
			)


@frappe.whitelist()
def create_observation(selected, sample_collection, component_observations=[], child_name=None):
	invoice = frappe.db.get_value("Sample Collection", sample_collection, "reference_name")
	selected = json.loads(selected)
	if len(component_observations) > 0:
		component_observations = json.loads(component_observations)
	patient = frappe.db.get_value("Sample Collection", sample_collection, "patient")
	comp_obs_ref = create_specimen(patient, selected, component_observations)
	for i, obs in enumerate(selected):
		parent_observation = obs.get("component_observation_parent")

		if child_name:
			parent_observation = frappe.db.get_value("Observation Sample Collection", child_name, "component_observation_parent")

		if obs.get("status") == "Open":
			# non has_component templates
			if not obs.get("has_component") or obs.get("has_component") == 0:
				observation = add_observation(
					patient,
					obs.get("observation_template"),
					"",
					"",
					"Sample Collection",
					sample_collection,
					parent_observation,
					comp_obs_ref.get(obs.get("name")) or comp_obs_ref.get(i+1) or comp_obs_ref.get(obs.get("idx")),
					invoice
				)
				if observation:
					frappe.db.set_value(
						"Observation Sample Collection",
						obs.get("name"),
						{
							"status": "Collected",
							"collection_date_time": now_datetime(),
							"specimen": comp_obs_ref.get(obs.get("name")),
						},
					)
			else:
				# to deal the component template checked from main table and collected
				if obs.get("component_observations"):
					component_observations = json.loads(obs.get("component_observations"))
					for j, comp in enumerate(component_observations):
						observation = add_observation(
							patient,
							comp.get("observation_template"),
							"",
							"",
							"Sample Collection",
							sample_collection,
							obs.get("component_observation_parent"),
							comp_obs_ref.get(j+1) or comp_obs_ref.get(obs.get("name")),
							invoice
						)
						if observation:
							comp["status"] = "Collected"
							comp["collection_date_time"] = now_datetime()
							comp["specimen"] = comp_obs_ref.get(j+1) or comp_obs_ref.get(obs.get("name"))

					frappe.db.set_value(
						"Observation Sample Collection",
						obs.get("name"),
						{
							"collection_date_time": now_datetime(),
							"component_observations": json.dumps(component_observations, default=str),
							"status": "Collected",
							"specimen": comp_obs_ref.get(j+1) or comp_obs_ref.get(obs.get("name")),
						},
					)
		# to deal individually checked from component dialog
		if component_observations:
			for j, comp in enumerate(component_observations):
				if comp.get("observation_template") == obs.get("observation_template"):
					comp["status"] = "Collected"
					comp["collection_date_time"] = now_datetime()
					comp["specimen"] = comp_obs_ref.get(j+1)

	child_db_set_dict = {"component_observations": json.dumps(component_observations, default=str)}
	# to set child table status Collected if all childs are Collected
	if not any((comp['status'] == "Open") for comp in component_observations):
		child_db_set_dict["status"] = "Collected"

	if child_name:
		frappe.db.set_value(
			"Observation Sample Collection",
			child_name,
			child_db_set_dict,
		)

def create_specimen(patient, selected, component_observations):
	groups = {}
	# to group by
	for sel in selected:
		if not sel.get("has_component") or sel.get("has_component") == 0:
			key = (sel.get('medical_department'), sel.get('sample'), sel.get("container_closure_color"))
			if key in groups:
				groups[key].append(sel)
			else:
				groups[key] = [sel]
		else:
			comp_observations = json.loads(sel.get("component_observations"))
			for comp in comp_observations:
				comp["name"] = sel.get("name")
				key = (comp.get('medical_department'), comp.get('sample'), comp.get("container_closure_color"))
				if key in groups:
					groups[key].append(comp)
				else:
					groups[key] = [comp]
	obs_ref = {}
	for gr in groups:
		specimen = frappe.new_doc("Specimen")
		specimen.received_time = now_datetime()
		specimen.patient = patient
		specimen.specimen_type = groups[gr][0].get("sample_type")
		specimen.save()
		for sub_grp in groups[gr]:
			if component_observations:
				obs_ref[sub_grp.get("idx")] = specimen.name
			else:
				obs_ref[sub_grp.get("name")] = specimen.name

	return obs_ref
