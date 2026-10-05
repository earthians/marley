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
				# Skip a row that already has its tree chained (e.g. the
				# Service Request flow builds it eagerly).
				if obs.get("has_component") and not obs.get("component_observations"):
					data = set_component_observation_data(obs.get("observation_template"))
					if data and len(data) > 0:
						create_component_observations(
							self.patient,
							self.company,
							self.referring_practitioner,
							data,
							obs.get("component_observation_parent"),
						)
						frappe.db.set_value(
							"Observation Sample Collection",
							obs.get("name"),
							{
								"component_observations": json.dumps(data, default=str),
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

		self.status = get_collection_status(self.observation_sample_collection)

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
		for obs in context.selected:
			collect_row(context, obs)
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
		["reference_name", "reference_doc", "patient", "referring_practitioner", "company"],
		as_dict=1,
	)
	return context


def collect_row(context, obs):
	if obs.get("status") == "Open":
		if not obs.get("has_component"):
			collect_sample(context, obs)
		elif obs.get("component_observations"):
			collect_components(context, obs)
	# A component template checked individually from the main table is marked here.
	mark_matching_components(context, obs)


def collect_sample(context, obs):
	# A nested leaf has no real row name, so it falls back to its
	# observation_template instead of idx, which isn't unique across levels.
	observation = add_observation(
		patient=context.sample_col.get("patient"),
		template=obs.get("observation_template"),
		doc="Sample Collection",
		docname=context.sample_collection,
		company=context.sample_col.get("company"),
		parent=parent_observation(context, obs),
		specimen=context.comp_obs_ref.get(obs.get("name"))
		or context.comp_obs_ref.get(obs.get("observation_template")),
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
	for comp in context.component_observations:
		specimen = context.comp_obs_ref.get(comp.get("observation_template")) or context.comp_obs_ref.get(
			obs.get("name")
		)
		observation = add_observation(
			patient=context.sample_col.get("patient"),
			template=comp.get("observation_template"),
			doc="Sample Collection",
			docname=context.sample_collection,
			company=context.sample_col.get("company"),
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
			"specimen": context.comp_obs_ref.get(obs.get("name")),
		},
	)


def mark_matching_components(context, obs):
	if not context.component_observations:
		return
	mark_component_collected(
		context.component_observations, obs, context.comp_obs_ref, obs.get("parent_observation_template")
	)


def mark_component_collected(components, obs, comp_obs_ref, parent_template=None):
	"""Find and mark `obs` Collected, bubbling status up through its
	sub-panels. `parent_template` scopes the match to one specific
	sub-panel, since the same leaf template can be reused under two."""
	for comp in components:
		if comp.get("has_component"):
			nested = comp.get("component_observations")
			if not nested:
				continue
			if isinstance(nested, str):
				nested = json.loads(nested)
			is_target_panel = (
				parent_template is not None and comp.get("observation_template") == parent_template
			)
			next_parent_template = None if is_target_panel else parent_template
			if not mark_component_collected(nested, obs, comp_obs_ref, next_parent_template):
				continue
			comp["component_observations"] = json.dumps(nested, default=str)
			if not any(c.get("status") == "Open" for c in nested):
				comp["status"] = "Collected"
				comp["collection_date_time"] = now_datetime()
			return True
		elif (
			parent_template is None
			and comp.get("observation_template") == obs.get("observation_template")
			and comp.get("status") == "Open"
		):
			comp["status"] = "Collected"
			comp["collection_date_time"] = now_datetime()
			comp["specimen"] = comp_obs_ref.get(comp.get("observation_template"))
			return True

	return False


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
	child_rows = frappe.db.get_all(
		"Observation Sample Collection",
		{"parent": context.sample_collection},
		["status"],
	)
	status = get_collection_status(child_rows)
	frappe.db.set_value("Sample Collection", context.sample_collection, "status", status)


def get_collection_status(child_rows):
	# An empty table has nothing collected yet, not vacuously Collected.
	if not child_rows:
		return "Pending"
	if all(row.get("status") == "Collected" for row in child_rows):
		return "Collected"
	if all(row.get("status") == "Open" for row in child_rows):
		return "Pending"
	return "Partly Collected"


def parent_observation(context, obs):
	# A leaf nested inside a sub-panel needs that sub-panel's own
	# Observation, not the top row's.
	if context.component_observations:
		found = find_parent_observation(
			context.component_observations,
			obs.get("observation_template"),
			obs.get("parent_observation_template"),
		)
		if found:
			return found
	if context.child_name:
		return frappe.db.get_value(
			"Observation Sample Collection", context.child_name, "component_observation_parent"
		)
	return obs.get("component_observation_parent")


def find_parent_observation(components, template, parent_template=None):
	"""Find the Observation of the sub-panel that should parent `template`.
	`parent_template` scopes the match to one specific sub-panel, since the
	same leaf template can be reused under two."""
	for comp in components:
		if not comp.get("has_component"):
			continue
		nested = comp.get("component_observations")
		if not nested:
			continue
		if isinstance(nested, str):
			nested = json.loads(nested)
		if parent_template:
			if comp.get("observation_template") == parent_template:
				return comp.get("component_observation_parent")
		elif any(c.get("observation_template") == template for c in nested):
			return comp.get("component_observation_parent")
		found = find_parent_observation(nested, template, parent_template)
		if found:
			return found
	return None


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
	# Nested leaves have no real row name, so they're referenced back by
	# observation_template, not idx (not unique across nesting levels).
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
				obs_ref[sub_grp.get("observation_template")] = specimen.name
			else:
				obs_ref[sub_grp.get("name")] = specimen.name

	return obs_ref


def set_component_observation_data(observation_template):
	"""The sample-collection-relevant component tree under
	`observation_template`, nested recursively to any depth."""
	sample_reqd_component_obs, non_sample_reqd_component_obs = get_observation_template_details(
		observation_template
	)
	data = []
	for d in sample_reqd_component_obs + non_sample_reqd_component_obs:
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
				"has_component",
				"sample_collection_required",
			],
			as_dict=True,
		)
		if obs_temp.get("has_component"):
			nested = set_component_observation_data(d)
			if not nested:
				continue
			obs_temp["component_observations"] = json.dumps(nested, default=str)
			obs_temp["status"] = "Open"
			data.append(obs_temp)
		elif obs_temp.get("sample_collection_required"):
			obs_temp["status"] = "Open"
			data.append(obs_temp)
		# Neither a panel nor itself sample-required - nothing to collect here.
	return data


def create_component_observations(patient, company, practitioner, components, parent_observation_name):
	"""Eagerly create an Observation for every sub-panel in `components`,
	at any depth, parented to its own containing panel's Observation."""
	from healthcare.healthcare.utils import create_non_sample_observations

	for comp in components:
		if not comp.get("has_component"):
			continue

		observation_name = add_observation(
			patient=patient,
			template=comp.get("observation_template"),
			company=company,
			practitioner=practitioner,
			parent=parent_observation_name,
		)
		comp["component_observation_parent"] = observation_name

		# A mixed panel's own non-sample-required children aren't in `nested`.
		create_non_sample_observations(
			comp.get("observation_template"),
			observation_name,
			{"patient": patient, "company": company, "practitioner": practitioner},
		)

		nested = comp.get("component_observations")
		if nested:
			if isinstance(nested, str):
				nested = json.loads(nested)
			create_component_observations(patient, company, practitioner, nested, observation_name)
			comp["component_observations"] = json.dumps(nested, default=str)
