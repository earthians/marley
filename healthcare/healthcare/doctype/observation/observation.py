# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import json
import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.workflow import get_workflow_name, get_workflow_state_field
from frappe.utils import flt, get_link_to_form, getdate, now_datetime, nowdate

from erpnext.setup.doctype.terms_and_conditions.terms_and_conditions import (
	get_terms_and_conditions,
)

DAYS_PER_AGE_TYPE = {"Years": 365.2425, "Months": 30.436875, "Days": 1}


class Observation(Document):
	@property
	def sales_invoice_status(self):
		if self.sales_invoice:
			return frappe.db.get_value("Sales Invoice", self.sales_invoice, "status")

	def validate(self):
		self.set_age()
		self.set_result_time()
		self.set_status()
		self.reference = get_observation_reference(self)
		self.validate_input()
		self.sanitize_input()

	def on_update(self):
		set_diagnostic_report_status(self)
		if (
			self.parent_observation
			and self.result_data
			and self.permitted_data_type in ["Quantity", "Numeric"]
		):
			set_calculated_result(self)

	def before_insert(self):
		set_observation_idx(self)
		self.render_templates()

	def after_insert(self):
		if self.appointment:
			frappe.db.set_value("Patient Appointment", self.appointment, "status", "Closed")

	def on_submit(self):
		if self.service_request:
			frappe.db.set_value("Service Request", self.service_request, "status", "completed-Request Status")

	def on_cancel(self):
		if self.service_request:
			frappe.db.set_value("Service Request", self.service_request, "status", "active-Request Status")

	def set_age(self):
		patient_doc = frappe.get_doc("Patient", self.patient)
		if patient_doc.dob:
			self.age = patient_doc.calculate_age().get("age_in_string")
			self.days = patient_doc.calculate_age().get("age_in_days")

	def set_status(self):
		if self.status not in ["Approved", "Rejected"]:
			if self.has_result() and self.status != "Final":
				self.status = "Preliminary"
			elif self.amended_from and self.status not in ["Amended", "Corrected"]:
				self.status = "Amended"
			elif self.status not in ["Final", "Cancelled", "Entered in Error", "Unknown"]:
				self.status = "Registered"

	def set_result_time(self):
		if not self.time_of_result:
			if self.has_result():
				self.time_of_result = now_datetime()
			else:
				self.time_of_result = ""

		if self.status == "Final" and not self.time_of_approval:
			self.time_of_approval = now_datetime()
		else:
			self.time_of_approval = ""

	def has_result(self):
		result_fields = [
			"result_attach",
			"result_boolean",
			"result_data",
			"result_text",
			"result_float",
			"result_select",
		]
		for field in result_fields:
			if self.get(field, None):
				return True

		# TODO: handle fields defaulting to now
		# "result_datetime",
		# "result_time",
		# "result_period_from",
		# "result_period_to",

		return False

	def component_has_result(self):
		component_obs = frappe.db.get_all("Observation", {"parent_observation": self.name}, pluck="name")
		for obs in component_obs:
			obs_doc = frappe.get_doc("Observation", obs)
			if obs_doc.has_component:
				if not obs_doc.component_has_result():
					return False
			else:
				if not obs_doc.has_result():
					return False

		return True

	def validate_input(self):
		if self.permitted_data_type in ["Quantity", "Numeric"]:
			if self.result_data and not is_numbers_with_exceptions(self.result_data):
				frappe.throw(
					_("Non numeric result {0} is not allowed for Permitted Data Type {1}").format(
						frappe.bold(self.result_data), frappe.bold(self.permitted_data_type)
					)
				)

	def sanitize_input(self):
		html_fields = ["result_text", "result_interpretation", "note"]
		for field in html_fields:
			value = self.get(field)
			if value:
				self.set(field, frappe.utils.sanitize_html(value))

	def render_templates(self):
		if self.result_template and not self.result_text:
			self.result_text = get_terms_and_conditions(self.result_template, self.as_dict())

		if self.interpretation_template and not self.result_interpretation:
			self.result_interpretation = get_terms_and_conditions(
				self.interpretation_template, self.as_dict()
			)


@frappe.whitelist()
def get_observation_details(docname):
	reference = frappe.get_value("Diagnostic Report", docname, ["docname", "ref_doctype"], as_dict=True)
	observation = []

	if reference.get("ref_doctype") == "Sales Invoice":
		observation = frappe.get_list(
			"Observation",
			fields=["*"],
			filters={
				"sales_invoice": reference.get("docname"),
				"parent_observation": "",
				"status": ["!=", "Cancelled"],
				"docstatus": ["!=", 2],
			},
			order_by="creation",
		)
	elif reference.get("ref_doctype") == "Patient Encounter":
		service_requests = frappe.get_all(
			"Service Request",
			filters={
				"source_doc": reference.get("ref_doctype"),
				"order_group": reference.get("docname"),
				"status": ["!=", "revoked-Request Status"],
				"docstatus": ["!=", 2],
			},
			order_by="creation",
			pluck="name",
		)
		observation = frappe.get_list(
			"Observation",
			fields=["*"],
			filters={
				"service_request": ["in", service_requests],
				"parent_observation": "",
				"status": ["!=", "Cancelled"],
				"docstatus": ["!=", 2],
			},
			order_by="creation",
		)

	out_data, obs_length = aggregate_and_return_observation_data(observation)

	return out_data, obs_length


def aggregate_and_return_observation_data(observations):
	out_data = []
	obs_length = 0

	for obs in observations:
		if not obs.get("has_component"):
			obs_length += 1

			if obs.get("permitted_data_type") == "Select" and obs.get("options"):
				obs["options_list"] = obs.get("options").split("\n")

			if obs.get("observation_template") and obs.get("specimen"):
				obs["received_time"] = frappe.get_value("Specimen", obs.get("specimen"), "received_time")

			out_data.append({"observation": obs})

		else:
			child_observations = get_child_observations(obs)
			obs_dict, obs_length = return_child_observation_data_as_dict(child_observations, obs, obs_length)

			if len(obs_dict) > 0:
				out_data.append(obs_dict)

	return out_data, obs_length


def get_child_observations(obs):
	return frappe.get_list(
		"Observation",
		fields=["*"],
		filters={
			"parent_observation": obs.get("name"),
			"status": ["!=", "Cancelled"],
			"docstatus": ["!=", 2],
		},
		order_by="observation_idx",
	)


def return_child_observation_data_as_dict(child_observations, obs, obs_length=0):
	obs_list = []
	has_result = False
	obs_approved = False
	all_children_approved = True

	for child in child_observations:
		if child.get("has_component"):
			grand_children = get_child_observations(child)
			grand_dict, obs_length = return_child_observation_data_as_dict(grand_children, child, obs_length)
			obs_list.append(grand_dict)
			if not grand_dict.get("obs_approved", False):
				all_children_approved = False
		else:
			obs_length += 1
			if child.get("permitted_data_type") == "Select" and child.get("options"):
				child["options_list"] = child.get("options").split("\n")
			if child.get("specimen"):
				child["received_time"] = frappe.get_value("Specimen", child.get("specimen"), "received_time")
			if child.get("status") != "Approved":
				all_children_approved = False
			observation_data = {"observation": child}
			obs_list.append(observation_data)

		if (
			child.get("result_data")
			or child.get("result_text")
			or child.get("result_select") not in [None, "", "Null"]
		):
			has_result = True

	if all_children_approved and child_observations:
		obs_approved = True

	obs_dict = {
		"has_component": True,
		"observation": obs.get("name"),
		obs.get("name"): obs_list,
		"display_name": obs.get("observation_template"),
		"practitioner_name": obs.get("practitioner_name"),
		"healthcare_practitioner": obs.get("healthcare_practitioner"),
		"description": obs.get("description"),
		"has_result": has_result,
		"obs_approved": obs_approved,
	}

	return obs_dict, obs_length


def get_observation_reference(doc):
	template_doc = frappe.get_doc("Observation Template", doc.observation_template)
	display_reference = ""

	for child in template_doc.observation_reference_range:
		if reference_applies_to_patient(child, doc) and reference_matches_age(child, doc):
			display_reference += set_reference_string(child)

	return display_reference


def reference_applies_to_patient(child, doc):
	if child.applies_to == "All":
		return True
	return child.applies_to == doc.gender


def reference_matches_age(child, doc):
	missing_days = doc.days is None or doc.days == ""
	if child.age != "Range":
		return child.age == "All" or missing_days

	if missing_days:
		return False

	day_from = age_value_in_days(child.age_from, child.from_age_type)
	day_to = age_value_in_days(child.age_to, child.to_age_type)
	if day_from is None or day_to is None:
		return False

	return day_from <= float(doc.days) <= day_to


def age_value_in_days(value, age_type):
	if value in (None, "") or age_type not in DAYS_PER_AGE_TYPE:
		return None
	try:
		return float(value) * DAYS_PER_AGE_TYPE[age_type]
	except (ValueError, TypeError):
		return None


def set_reference_string(child):
	display_reference = ""
	if (child.reference_from and child.reference_to) or child.conditions:
		if child.reference_from and child.reference_to:
			display_reference = f"{child.reference_from!s} - {child.reference_to!s}"
		elif child.conditions:
			display_reference = f"{child.conditions!s}"

		if child.short_interpretation:
			display_reference = f"{display_reference}: {child.short_interpretation!s}<br>"

	elif child.short_interpretation or child.long_interpretation:
		display_reference = (
			f"{(child.short_interpretation if child.short_interpretation else child.long_interpretation)}<br>"
		)

	return display_reference


@frappe.whitelist()
def edit_observation(observation: str, data_type: str, result: str) -> None:
	observation_doc = frappe.get_doc("Observation", observation)
	if data_type in ["Range", "Ratio", "Quantity", "Numeric"]:
		observation_doc.result_data = result

	elif data_type == "Text":
		observation_doc.result_text = result
	observation_doc.save()


@frappe.whitelist()
def add_observation(**kwargs):
	observation_doc = frappe.new_doc("Observation")
	observation_doc.posting_datetime = now_datetime()
	observation_doc.patient = kwargs.get("patient")
	observation_doc.observation_template = kwargs.get("template")
	observation_doc.permitted_data_type = kwargs.get("data_type")
	observation_doc.reference_doctype = kwargs.get("doc")
	observation_doc.reference_docname = kwargs.get("docname")
	observation_doc.sales_invoice = kwargs.get("invoice")
	observation_doc.healthcare_practitioner = kwargs.get("practitioner")
	observation_doc.specimen = kwargs.get("specimen")
	observation_doc.company = kwargs.get("company")
	if kwargs.get("data_type") in ["Range", "Ratio", "Quantity", "Numeric"]:
		observation_doc.result_data = kwargs.get("result")

	elif kwargs.get("data_type") == "Text":
		observation_doc.result_text = kwargs.get("result")
	if kwargs.get("parent"):
		observation_doc.parent_observation = kwargs.get("parent")
	observation_doc.sales_invoice_item = kwargs.get("child") if kwargs.get("child") else ""
	observation_doc.service_request = kwargs.get("service_request")
	observation_doc.insert(ignore_permissions=True)
	return observation_doc.name


@frappe.whitelist()
def record_observation_result(values):
	values = json.loads(values)
	if values:
		values = [dict(t) for t in {tuple(d.items()) for d in values}]
		for val in values:
			if not val.get("observation"):
				return
			observation_doc = frappe.get_doc("Observation", val["observation"])
			if observation_doc.get("permitted_data_type") in [
				"Range",
				"Ratio",
				"Quantity",
				"Numeric",
			]:
				if (
					observation_doc.get("permitted_data_type")
					in [
						"Quantity",
						"Numeric",
					]
					and val.get("result")
					and not is_numbers_with_exceptions(val.get("result"))
				):
					frappe.msgprint(
						_("Non numeric result {0} is not allowed for Permitted Type {1}").format(
							frappe.bold(val.get("result")),
							frappe.bold(observation_doc.get("permitted_data_type")),
						),
						indicator="orange",
						alert=True,
					)
					return

				if val.get("result") != observation_doc.get("result_data"):
					if val.get("result"):
						observation_doc.result_data = val.get("result")
					if val.get("note"):
						observation_doc.note = val.get("note")
					if observation_doc.docstatus == 0:
						observation_doc.save()
					elif observation_doc.docstatus == 1:
						observation_doc.save("Update")
			elif observation_doc.get("permitted_data_type") == "Text":
				if val.get("result") != observation_doc.get("result_text"):
					if val.get("result"):
						observation_doc.result_text = val.get("result")
					if val.get("note"):
						observation_doc.note = val.get("note")
					if observation_doc.docstatus == 0:
						observation_doc.save()
					elif observation_doc.docstatus == 1:
						observation_doc.save("Update")
			elif observation_doc.get("permitted_data_type") == "Select":
				if val.get("result") != observation_doc.get("result_select"):
					if val.get("result"):
						observation_doc.result_select = val.get("result")
					if val.get("note"):
						observation_doc.note = val.get("note")
					if observation_doc.docstatus == 0:
						observation_doc.save()
					elif observation_doc.docstatus == 1:
						observation_doc.save("Update")

			if observation_doc.get("observation_category") == "Imaging":
				if val.get("result"):
					observation_doc.result_text = val.get("result")
				if val.get("interpretation"):
					observation_doc.result_interpretation = val.get("interpretation")
				if val.get("result") or val.get("interpretation"):
					if val.get("note"):
						observation_doc.note = val.get("note")
					if observation_doc.docstatus == 0:
						observation_doc.save()
					elif observation_doc.docstatus == 1:
						observation_doc.save("Update")

			if not val.get("result") and val.get("note"):
				observation_doc.note = val.get("note")
				if observation_doc.docstatus == 0:
					observation_doc.save()
				elif observation_doc.docstatus == 1:
					observation_doc.save("Update")


@frappe.whitelist()
def add_note(note, observation):
	if note and observation:
		frappe.db.set_value("Observation", observation, "note", note)


def set_observation_idx(doc):
	if doc.parent_observation:
		parent_template = frappe.db.get_value("Observation", doc.parent_observation, "observation_template")
		idx = frappe.db.get_value(
			"Observation Component",
			{"parent": parent_template, "observation_template": doc.observation_template},
			"idx",
		)
		if idx:
			doc.observation_idx = idx


def is_numbers_with_exceptions(value):
	pattern = r"^[0-9{}]+$".format(re.escape(".<>"))
	return re.match(pattern, value) is not None


@frappe.whitelist()
def get_observation_result_template(template_name, observation):
	if observation:
		observation_doc = frappe.get_doc("Observation", observation)
		patient_doc = frappe.get_doc("Patient", observation_doc.get("patient"))
		observation_doc = json.loads(observation_doc.as_json())
		patient_doc = json.loads(patient_doc.as_json())
		# merged_dict = {"patient": patient_doc, "observation":observation_doc}
		merged_dict = {**observation_doc, **patient_doc}
		terms = get_terms_and_conditions(template_name, merged_dict)
	return terms


@frappe.whitelist()
def set_observation_status(observation, status, reason=None, parent_obs=None):
	observation_doc = frappe.get_doc("Observation", observation)

	if not (observation_doc.has_result() or observation_doc.has_component):
		frappe.throw(_("Please enter result to Approve."))

	if observation_doc.has_component and not observation_doc.component_has_result():
		frappe.throw(_("Please enter result for all components to Approve."))

	observation_doc.status = status
	if reason:
		observation_doc.disapproval_reason = reason

	if status == "Approved":
		observation_doc.submit()
	elif status == "Rejected":
		if not observation_doc.has_component:
			observation_doc.cancel()
		new_doc = frappe.copy_doc(observation_doc)
		new_doc.status = ""
		new_doc.disapproval_reason = ""
		if parent_obs:
			new_doc.parent_observation = parent_obs
		new_doc.insert()
		if observation_doc.has_component:
			parent_obs = new_doc.name

	if observation_doc.has_component:
		component_obs = frappe.db.get_all(
			"Observation",
			filters={"parent_observation": observation},
			pluck="name",
		)

		for obs in component_obs:
			set_observation_status(obs, status, reason, parent_obs)
		if status == "Rejected":
			observation_doc.cancel()


def set_diagnostic_report_status(doc):
	if not doc.has_component:
		ref_doctype = "Sales Invoice" if doc.sales_invoice else doc.reference_doctype
		ref_docname = doc.sales_invoice if doc.sales_invoice else doc.reference_docname

		if doc.reference_doctype == "Sample Collection" and doc.reference_docname:
			ref_doctype, ref_docname = frappe.get_cached_value(
				"Sample Collection", doc.reference_docname, ["reference_doc", "reference_name"]
			)

		diagnostic_report = frappe.db.get_value(
			"Diagnostic Report", {"ref_doctype": ref_doctype, "docname": ref_docname}, "name"
		)

		if diagnostic_report:
			out_data, obs_length = get_observation_details(diagnostic_report)
			approved_observations = get_approved_observations(out_data)

			workflow_name = get_workflow_name("Diagnostic Report")
			workflow_state_field = get_workflow_state_field(workflow_name)
			if obs_length == len(approved_observations):
				set_status = "Approved"
			elif len(approved_observations) > 0:
				set_status = "Partially Approved"
			else:
				set_status = "Open"

			set_value_dict = {"status": set_status}
			if workflow_state_field:
				set_value_dict[workflow_state_field] = set_status
			frappe.db.set_value("Diagnostic Report", diagnostic_report, set_value_dict, update_modified=False)


def get_approved_observations(data):
	approved_observations = []

	for item in data:
		obs = item.get("observation")
		if isinstance(obs, dict):
			if obs.get("docstatus") == 1 and obs.get("status") == "Approved":
				approved_observations.append(obs)
		else:
			approved_observations += get_approved_observations(item.get(obs))

	return approved_observations


def set_calculated_result(doc):
	if doc.parent_observation:
		parent_template = frappe.db.get_value("Observation", doc.parent_observation, "observation_template")
		parent_template_doc = frappe.get_cached_doc("Observation Template", parent_template)

		data = frappe._dict()
		patient_doc = frappe.get_cached_doc("Patient", doc.patient).as_dict()
		settings = frappe.get_cached_doc("Healthcare Settings").as_dict()

		data.update(doc.as_dict())
		data.update(parent_template_doc.as_dict())
		data.update(patient_doc)
		data.update(settings)

		for component in parent_template_doc.observation_component:
			"""
			Data retrieval from observations has been moved into the loop
			to accommodate component observations, which may contain formulas
			utilizing results from previous iterations.

			"""
			if component.based_on_formula and component.formula:
				obs_data = get_data(doc, parent_template_doc)
			else:
				continue

			if obs_data and len(obs_data) > 0:
				data.update(obs_data)
				result = eval_condition_and_formula(component, data)
				if not result:
					continue

				result_observation_name, result_data = frappe.db.get_value(
					"Observation",
					{
						"parent_observation": doc.parent_observation,
						"observation_template": component.get("observation_template"),
					},
					["name", "result_data"],
				)
				if result_observation_name and result_data != str(result):
					frappe.db.set_value(
						"Observation",
						result_observation_name,
						"result_data",
						str(result),
					)


def get_data(doc, parent_template_doc):
	data = frappe._dict()
	observation_details = frappe.get_all(
		"Observation",
		{"parent_observation": doc.parent_observation},
		["observation_template", "result_data"],
	)

	# to get all result_data to map against abbs of all table rows
	for component in parent_template_doc.observation_component:
		result = [
			d["result_data"]
			for d in observation_details
			if (d["observation_template"] == component.get("observation_template") and d["result_data"])
		]
		data[component.get("abbr")] = flt(result[0]) if (result and len(result) > 0 and result[0]) else 0
	return data


def eval_condition_and_formula(d, data):
	try:
		if d.get("condition"):
			cond = d.get("condition")
			parts = cond.strip().splitlines()
			condition = " ".join(parts)
			if condition:
				if not frappe.safe_eval(condition, data):
					return None

		if d.based_on_formula:
			amount = None
			formula = d.formula.strip().replace("\n", " ") if d.formula else None
			operands = re.split(r"\W+", formula)
			abbrs = [operand for operand in operands if re.search(r"[a-zA-Z]", operand)]
			if "age" in abbrs and data.get("dob"):
				age = (
					getdate(nowdate()).year
					- data.get("dob").year
					- (
						(getdate(nowdate()).month, getdate(nowdate()).day)
						< (data.get("dob").month, data.get("dob").day)
					)
				)
				if age > 0:
					data["age"] = age

			# check the formula abbrs has result value
			abbrs_present = all(abbr in data and data[abbr] != 0 for abbr in abbrs)
			if formula and abbrs_present:
				amount = flt(frappe.safe_eval(formula, {}, data))

		return amount

	except Exception as err:
		description = _("This error can be due to invalid formula.")
		error_message = str(err)
		message = _(
			"""Error while evaluating the {0} {1} at row {2}. <br><br> <b>Error:</b> {3}
			<br><br> <b>Hint:</b> {4}"""
		).format(d.parenttype, get_link_to_form(d.parenttype, d.parent), d.idx, error_message, description)

		frappe.throw(message, title=_("Error in formula"))


def get_observations_for_medical_record(observation, parent_observation=None):
	if not observation:
		return

	if parent_observation:
		obs_doc = frappe.get_doc("Observation", parent_observation)
	else:
		obs_doc = frappe.get_doc("Observation", observation)

	obs_doc = obs_doc.as_dict()
	out_data = []

	if not obs_doc.get("has_component"):
		if obs_doc.get("permitted_data_type") == "Select" and obs_doc.get("options"):
			obs_doc["options_list"] = obs_doc.get("options").split("\n")

		if obs_doc.get("observation_template") and obs_doc.get("specimen"):
			obs_doc["received_time"] = frappe.get_value("Specimen", obs_doc.get("specimen"), "received_time")

		out_data.append({"observation": obs_doc})

	else:
		child_observations = get_child_observations(obs_doc)
		obs_dict, _obs_length = return_child_observation_data_as_dict(child_observations, obs_doc)

		if len(obs_dict) > 0:
			out_data.append(obs_dict)

	return out_data
