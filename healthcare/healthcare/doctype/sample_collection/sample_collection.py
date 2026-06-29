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

		if self.appointment:
			frappe.db.set_value("Patient Appointment", self.appointment, "status", "Closed")

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

	def on_submit(self):
		if self.observation_sample_collection:
			for obs in self.observation_sample_collection:
				if obs.get("service_request"):
					frappe.db.set_value(
						"Service Request", obs.get("service_request"), "status", "completed-Request Status"
					)

	def on_cancel(self):
		if self.observation_sample_collection:
			for obs in self.observation_sample_collection:
				if obs.get("service_request"):
					frappe.db.set_value(
						"Service Request", obs.get("service_request"), "status", "active-Request Status"
					)

		exist_diagnostic_report = frappe.db.exists(
			"Diagnostic Report",
			{"sample_collection": self.name},
		)
		if exist_diagnostic_report:
			frappe.delete_doc("Diagnostic Report", exist_diagnostic_report)


@frappe.whitelist()
def create_observation(
	selected: str,
	sample_collection: str,
	component_observations: str | None = None,
	child_name: str | None = None,
) -> None:
	insert_observation(
		selected=selected,
		sample_collection=sample_collection,
		component_observations=component_observations,
		child_name=child_name,
	)


def insert_observation(
	selected: str,
	sample_collection: str,
	component_observations: str | None = None,
	child_name: str | None = None,
) -> None:
	try:
		context = build_context(selected, sample_collection, component_observations, child_name)
		context.comp_obs_ref = create_specimen(
			context.sample_col.get("patient"), context.selected, context.component_observations
		)
		for index, obs in enumerate(context.selected):
			collect_row(context, index, obs)
		update_child_status(context)
		update_collection_status(context)
	except Exception as exception:
		frappe.db.rollback()
		frappe.log_error(message=exception, title="Failed to mark Collected!")
		raise
	else:
		publish_progress(sample_collection)


def build_context(selected, sample_collection, component_observations, child_name):
	context = frappe._dict(
		sample_collection=sample_collection,
		child_name=child_name,
		selected=json.loads(selected),
		# Parsed once; reassigned per component row below, mirroring the legacy flow.
		component_observations=component_observations,
	)
	if component_observations and len(component_observations) > 0:
		context.component_observations = json.loads(component_observations)
	context.sample_col = frappe.db.get_value(
		"Sample Collection",
		sample_collection,
		["reference_name", "reference_doc", "patient", "referring_practitioner"],
		as_dict=1,
	)
	return context


def collect_row(context, index, obs):
	if obs.get("status") == "Open":
		if not obs.get("has_component"):
			collect_sample(context, index, obs)
		elif obs.get("component_observations"):
			collect_components(context, obs)
	# A component template checked individually from the main table is marked here.
	mark_matching_components(context, obs)


def collect_sample(context, index, obs):
	observation = add_observation(
		patient=context.sample_col.get("patient"),
		template=obs.get("observation_template"),
		doc="Sample Collection",
		docname=context.sample_collection,
		parent=parent_observation(context, obs),
		specimen=context.comp_obs_ref.get(obs.get("name"))
		or context.comp_obs_ref.get(index + 1)
		or context.comp_obs_ref.get(obs.get("idx")),
		invoice=invoice(context),
		practitioner=context.sample_col.get("referring_practitioner"),
		child=obs.get("reference_child") or "",
		service_request=obs.get("service_request"),
	)

	if observation and obs.get("name"):
		frappe.db.set_value(
			"Observation Sample Collection",
			obs.get("name"),
			{
				"status": "Collected",
				"collection_date_time": now_datetime(),
				"specimen": context.comp_obs_ref.get(obs.get("name")),
			},
		)


def collect_components(context, obs):
	context.component_observations = json.loads(obs.get("component_observations"))
	for j, comp in enumerate(context.component_observations):
		specimen = context.comp_obs_ref.get(j + 1) or context.comp_obs_ref.get(obs.get("name"))
		observation = add_observation(
			patient=context.sample_col.get("patient"),
			template=comp.get("observation_template"),
			doc="Sample Collection",
			docname=context.sample_collection,
			parent=obs.get("component_observation_parent"),
			specimen=specimen,
			invoice=invoice(context),
			practitioner=context.sample_col.get("referring_practitioner"),
			child=obs.get("reference_child") or "",
			service_request=obs.get("service_request"),
		)
		if observation:
			comp["status"] = "Collected"
			comp["collection_date_time"] = now_datetime()
			comp["specimen"] = specimen

	frappe.db.set_value(
		"Observation Sample Collection",
		obs.get("name"),
		{
			"collection_date_time": now_datetime(),
			"component_observations": json.dumps(context.component_observations, default=str),
			"status": "Collected",
			"specimen": context.comp_obs_ref.get(j + 1) or context.comp_obs_ref.get(obs.get("name")),
		},
	)


def mark_matching_components(context, obs):
	if not context.component_observations:
		return
	for j, comp in enumerate(context.component_observations):
		if comp.get("observation_template") == obs.get("observation_template"):
			comp["status"] = "Collected"
			comp["collection_date_time"] = now_datetime()
			comp["specimen"] = context.comp_obs_ref.get(j + 1)


def update_child_status(context):
	child_values = {"component_observations": json.dumps(context.component_observations, default=str)}
	# Mark the child row Collected once none of its components are still Open.
	if context.component_observations and not any(
		comp["status"] == "Open" for comp in context.component_observations
	):
		child_values["status"] = "Collected"

	if context.child_name:
		frappe.db.set_value("Observation Sample Collection", context.child_name, child_values)


def update_collection_status(context):
	if not context.sample_collection:
		return
	non_collected = frappe.db.get_all(
		"Observation Sample Collection",
		{"parent": context.sample_collection, "status": ["!=", "Collected"]},
	)
	status = "Partly Collected" if non_collected else "Collected"
	frappe.db.set_value("Sample Collection", context.sample_collection, "status", status)


def parent_observation(context, obs):
	if context.child_name:
		return frappe.db.get_value(
			"Observation Sample Collection", context.child_name, "component_observation_parent"
		)
	return obs.get("component_observation_parent")


def invoice(context):
	if context.sample_col.reference_doc == "Sales Invoice":
		return context.sample_col.get("reference_name")
	return None


def publish_progress(sample_collection):
	frappe.publish_realtime(
		event="observation_creation_progress",
		message="Completed",
		doctype="Sample Collection",
		docname=sample_collection,
	)


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
		specimen.specimen_type = groups[gr][0].get("sample") or groups[gr][0].get("sample_type")
		specimen.save()
		for sub_grp in groups[gr]:
			if component_observations:
				obs_ref[sub_grp.get("idx")] = specimen.name
			else:
				obs_ref[sub_grp.get("name")] = specimen.name

	return obs_ref


def set_component_observation_data(observation_template):
	sample_reqd_component_obs, _non_sample_reqd_component_obs = get_observation_template_details(
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
