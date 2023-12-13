# -*- coding: utf-8 -*-
# Copyright (c) 2015, ESS and contributors
# For license information, please see license.txt


import json

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime

from healthcare.healthcare.doctype.observation.observation import add_observation
from healthcare.healthcare.doctype.observation_template.observation_template import (
	get_observation_template_details,
)


class SampleCollection(Document):
	def after_insert(self):
		if self.observation_sample_collection:
			for obs in self.observation_sample_collection:
				if obs.get("has_component"):
					data = set_component_observation_data(obs.get("observation_template"))
					if data and len(data) > 0:
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
					if not any((comp["status"] == "Open") for comp in component_observations):
						obs.status = "Collected"

		if not any((obs.get("status") == "Open") for obs in self.observation_sample_collection):
			self.status = "Collected"
		else:
			self.status = "Partly Collected"

	# def before_submit(self):
	# 	if [sample for sample in self.observation_sample_collection if sample.status != "Collected"]:
	# 		frappe.throw(
	# 			msg=_("Cannot Submit, not all samples are marked as 'Collected'."), title=_("Not Allowed")
	# 		)


@frappe.whitelist()
def create_observation(selected, sample_collection, component_observations=None, child_name=None):
	sample_col_doc = frappe.db.get_value(
		"Sample Collection",
		sample_collection,
		["reference_name", "patient", "referring_practitioner"],
		as_dict=1,
	)
	selected = json.loads(selected)
	if component_observations and len(component_observations) > 0:
		component_observations = json.loads(component_observations)
	comp_obs_ref = create_specimen(sample_col_doc.get("patient"), selected, component_observations)
	for i, obs in enumerate(selected):
		parent_observation = obs.get("component_observation_parent")

		if child_name:
			parent_observation = frappe.db.get_value(
				"Observation Sample Collection", child_name, "component_observation_parent"
			)

		if obs.get("status") == "Open":
			# non has_component templates
			if not obs.get("has_component") or obs.get("has_component") == 0:
				observation = add_observation(
					patient=sample_col_doc.get("patient"),
					template=obs.get("observation_template"),
					doc="Sample Collection",
					docname=sample_collection,
					parent=parent_observation,
					specimen=comp_obs_ref.get(obs.get("name"))
					or comp_obs_ref.get(i + 1)
					or comp_obs_ref.get(obs.get("idx")),
					invoice=sample_col_doc.get("reference_name"),
					practitioner=sample_col_doc.get("referring_practitioner"),
					child=obs.get("reference_child") if obs.get("reference_child") else "",
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
							sample_col_doc.get("patient"),
							comp.get("observation_template"),
							doc="Sample Collection",
							docname=sample_collection,
							parent=obs.get("component_observation_parent"),
							specimen=comp_obs_ref.get(j + 1) or comp_obs_ref.get(obs.get("name")),
							invoice=sample_col_doc.get("reference_name"),
							practitioner=sample_col_doc.get("referring_practitioner"),
							child=obs.get("reference_child") if obs.get("reference_child") else "",
						)
						if observation:
							comp["status"] = "Collected"
							comp["collection_date_time"] = now_datetime()
							comp["specimen"] = comp_obs_ref.get(j + 1) or comp_obs_ref.get(obs.get("name"))

					frappe.db.set_value(
						"Observation Sample Collection",
						obs.get("name"),
						{
							"collection_date_time": now_datetime(),
							"component_observations": json.dumps(component_observations, default=str),
							"status": "Collected",
							"specimen": comp_obs_ref.get(j + 1) or comp_obs_ref.get(obs.get("name")),
						},
					)
		# to deal individually checked from component dialog
		if component_observations:
			for j, comp in enumerate(component_observations):
				if comp.get("observation_template") == obs.get("observation_template"):
					comp["status"] = "Collected"
					comp["collection_date_time"] = now_datetime()
					comp["specimen"] = comp_obs_ref.get(j + 1)

	child_db_set_dict = {"component_observations": json.dumps(component_observations, default=str)}
	# to set child table status Collected if all childs are Collected
	if component_observations and not any(
		(comp["status"] == "Open") for comp in component_observations
	):
		child_db_set_dict["status"] = "Collected"

	if child_name:
		frappe.db.set_value(
			"Observation Sample Collection",
			child_name,
			child_db_set_dict,
		)
	if sample_collection:
		non_collected_samples = frappe.db.get_all(
			"Observation Sample Collection", {"parent": sample_collection, "status": ["!=", "Collected"]}
		)
		if non_collected_samples and len(non_collected_samples) > 0:
			set_status = "Partly Collected"
		else:
			set_status = "Collected"

		frappe.db.set_value("Sample Collection", sample_collection, "status", set_status)


def create_specimen(patient, selected, component_observations):
	groups = {}
	# to group by
	for sel in selected:
		if not sel.get("has_component") or sel.get("has_component") == 0:
			key = (sel.get("medical_department"), sel.get("sample"), sel.get("container_closure_color"))
			if key in groups:
				groups[key].append(sel)
			else:
				groups[key] = [sel]
		else:
			if sel.get("component_observations"):
				comp_observations = json.loads(sel.get("component_observations"))
				for comp in comp_observations:
					comp["name"] = sel.get("name")
					key = (
						comp.get("medical_department"),
						comp.get("sample"),
						comp.get("container_closure_color"),
					)
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


def set_component_observation_data(observation_template):
	sample_reqd_component_obs, non_sample_reqd_component_obs = get_observation_template_details(
		observation_template
	)
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
	return data
