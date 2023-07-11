# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import json
from frappe import _
import frappe
from frappe.model.document import Document
from frappe.utils import date_diff, getdate, now_datetime, today


class Observation(Document):
	def validate(self):
		self.set_age()
		self.set_result_time()
		self.set_status()
		self.reference = get_observation_reference(
			self.observation_template, self.age, self.gender)[0].get("display_reference"
		)
		self.validate_input()

	def before_insert(self):
		set_observation_idx(self)

	def set_age(self):
		if not self.age:
			dob = frappe.db.get_value("Patient", self.patient, "dob")
			if dob:
				self.age = calculate_age(dob)

	def set_status(self):
		if self.has_result() and self.status != "Final":
			self.status = "Preliminary"
		elif self.amended_from and self.status not in ["Amended", "Corrected"]:
			self.status = "Amended"
		elif self.status not in ["Final", "Cancelled", "Entered in Error", "Unknown"]:
			self.status = "Registered"

	def set_result_time(self):
		if not self.time_of_result and self.has_result():
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

	def validate_input(self):
		if self.permitted_data_type in ["Quantity", "Numeric"]:
			if self.result_data and not self.result_data.isdigit():
				frappe.throw(_("Non numeric result {0} is not allowed for Permitted Type {1}").format(frappe.bold(self.result_data), frappe.bold(self.permitted_data_type)))


def calculate_age(dob):
	age = date_diff(today(), getdate(dob))

	# Check if the birthday has already occurred this year
	if getdate(today()).month < getdate(dob).month or (
		getdate(today()).month == getdate(dob).month and getdate(today()).day < getdate(dob).day
	):
		age -= 1
	if age:
		return age / 365.25


@frappe.whitelist()
def get_observation_details(docname):
	patient, gender, reference, age = frappe.get_value(
		"Diagnostic Report", docname, ["patient", "gender", "docname", "age"]
	)
	observation = frappe.get_all(
		"Observation",
		fields=[
			"*"
		],
		filters={"sales_invoice": reference, "parent_observation": ""},
		order_by="creation",
	)
	out_data = []
	obs_length = len(observation)
	for obs in observation:
		if not obs.get("has_component"):
			observation_data = {}
			if obs.get("permitted_data_type") == "Select" and obs.get("options"):
				obs["options_list"] = obs.get("options").split("\n")
			if obs.get("observation_template"):
				reference_details = get_observation_reference(obs.get("observation_template"), age, gender)
				if reference_details:
					observation_data["template_reference"] = reference_details[0]
				if obs.get("specimen"):
					obs["received_time"] = frappe.get_value("Specimen", obs.get("specimen"), "received_time")
				out_data.append(observation_data)
				observation_data["observation"] = obs

		else:
			obs_length -= 1
			child_observations = frappe.get_all(
				"Observation",
				fields=[
					"*"
				],
				filters={"parent_observation": obs.get("name"), "status": ["!=", "Cancelled"]},
				order_by="observation_idx",
			)
			obs_list = []
			obs_dict = {}
			for child in child_observations:
				if child.get("permitted_data_type") == "Select" and child.get("options"):
					child["options_list"] = child.get("options").split("\n")
				if child.get("specimen"):
					child["received_time"] = frappe.get_value("Specimen", child.get("specimen"), "received_time")
				observation_data = {}
				reference_details = get_observation_reference(child.get("observation_template"), age, gender)
				observation_data["template_reference"] = reference_details[0]
				observation_data["observation"] = child
				obs_list.append(observation_data)
			if len(child_observations) > 0:
				obs_dict["has_component"] = True
				obs_dict["observation"] = obs.get("name")
				obs_dict[obs.get("name")] = obs_list
				obs_dict["display_name"] = obs.get("observation_template")
				obs_dict["practitioner_name"] = obs.get("practitioner_name")
				obs_dict["healthcare_practitioner"] = obs.get("healthcare_practitioner")
			out_data.append(obs_dict)
			obs_length += len(child_observations)

	return out_data, obs_length


def get_observation_reference(observation_template, age, patient_sex):
	template_doc = frappe.get_doc("Observation Template", observation_template)
	data = []
	reference_data = {}
	reference_data["method"] = template_doc.method_value
	reference_data["observation_options"] = template_doc.options
	reference_data["permitted_unit"] = template_doc.permitted_unit
	reference_data["preferred_display_name"] = template_doc.preferred_display_name
	reference_data["sample"] = template_doc.sample
	display_reference = ""
	for child in template_doc.observation_reference_range:
		if child.age == "All" or (
			child.age == "Range" and float(child.age_from) <= float(age) <= float(child.age_to)
		):
			if child.short_interpretation and (
				(child.reference_from and child.reference_to) or child.conditions
			):
				display_reference += (
					str(child.short_interpretation)
					+ ":"
					+ (
						(str(child.reference_from) + "-" + str(child.reference_to))
						if child.reference_from
						else str(child.conditions)
					)
					+ "<br>"
				)
	reference_data["display_reference"] = display_reference
	data.append(reference_data)
	return data


@frappe.whitelist()
def edit_observation(observation, data_type, result):
	observation_doc = frappe.get_doc("Observation", observation)
	if data_type in ["Range", "Ratio", "Quantity", "Numeric"]:
		observation_doc.result_data = result
	# elif data_type in ["Quantity", "Numeric"]:
	# 	observation_doc.result_float = result
	elif data_type == "Text":
		observation_doc.result_text = result
	observation_doc.save()


@frappe.whitelist()
def add_observation(
	patient,
	template,
	data_type=None,
	result=None,
	doc=None,
	docname=None,
	parent=None,
	specimen=None,
	invoice="",
):
	observation_doc = frappe.new_doc("Observation")
	observation_doc.posting_datetime = now_datetime()
	observation_doc.patient = patient
	observation_doc.observation_template = template
	observation_doc.permitted_data_type = data_type
	observation_doc.reference_doctype = doc
	observation_doc.reference_docname = docname
	observation_doc.sales_invoice = invoice
	observation_doc.specimen = specimen
	if data_type in ["Range", "Ratio", "Quantity", "Numeric"]:
		observation_doc.result_data = result
	# elif data_type in ["Quantity", "Numeric"]:
	# 	observation_doc.result_float = result
	elif data_type == "Text":
		observation_doc.result_text = result
	if parent:
		observation_doc.parent_observation = parent
	observation_doc.insert()
	return observation_doc.name


@frappe.whitelist()
def record_observation_result(values):
	values = json.loads(values)
	if values:
		for val in values:
			if not val.get("observation"):
				return
			observation_details = frappe.db.get_value(
				"Observation",
				val.get("observation"),
				[
					"permitted_data_type",
					"result_float",
					"result_attach",
					"result_data",
					"result_text",
					"result_select",
				],
				as_dict=True,
			)

			if observation_details.get("permitted_data_type") in ["Range", "Ratio", "Quantity", "Numeric"]:
				if observation_details.get("permitted_data_type")  in ["Quantity", "Numeric"] and val.get("result") and not val.get("result").isdigit():
					return
				if val.get("result") != observation_details.get("result_data"):
					frappe.db.set_value("Observation", val["observation"], {"result_data": val.get("result"), "time_of_result": now_datetime()})
			elif observation_details.get("permitted_data_type") == "Text":
				if val.get("result") != observation_details.get("result_text"):
					frappe.db.set_value("Observation", val["observation"], {"result_text": val.get("result"), "time_of_result": now_datetime()})
			elif observation_details.get("permitted_data_type") == "Select":
				if val.get("result") != observation_details.get("result_select"):
					frappe.db.set_value("Observation", val["observation"], {"result_select": val.get("result"), "time_of_result": now_datetime()})


@frappe.whitelist()
def add_note(note, observation):
	if note and observation:
		frappe.db.set_value("Observation", observation, "note", note)


def set_observation_idx(doc):
	if doc.parent_observation:
		parent_template = frappe.db.get_value("Observation", doc.parent_observation, "observation_template")
		idx = frappe.db.get_value("Observation Component", {"parent": parent_template, "observation_template":doc.observation_template}, "idx")
		if idx:
			doc.observation_idx = idx
