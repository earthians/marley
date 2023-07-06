# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
import json
from frappe.model.document import Document
from frappe.utils import date_diff, getdate, today


class Observation(Document):
	def validate(self):
		dob  = frappe.db.get_value("Patient", self.patient, "dob")
		if dob and not self.age:
			self.age = calculate_age(dob)


def calculate_age(dob):
	age = date_diff(today(), getdate(dob))

	# Check if the birthday has already occurred this year
	if getdate(today()).month < getdate(dob).month or (
		getdate(today()).month == getdate(dob).month
		and getdate(today()).day < getdate(dob).day
	):
		age -= 1
	if age:
		return age / 365.25

@frappe.whitelist()
def get_observation_template_reference(docname):
	patient, gender, reference = frappe.get_value("Diagnostic Report", docname, ["patient", "gender", "docname"])
	observation = frappe.get_all("Observation", fields=["name", "observation_template", "posting_datetime", "result_data", "result_text", "result_float", "result_select", "permitted_data_type", "has_component", "parent_observation", "remarks", "options"], filters={"sales_invoice": reference, "parent_observation": ""})#, "has_component":0})
	age = calculate_age(frappe.db.get_value("Patient", patient, "dob"))
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
				observation_data["observation"] = obs
				out_data.append(observation_data)

		else:
			obs_length -= 1
			child_observations = frappe.get_all("Observation", fields=["name", "observation_template", "posting_datetime", "result_data", "result_text", "result_float", "result_select", "permitted_data_type", "parent_observation", "remarks", "options"], filters={"parent_observation": obs.get("name"), "status":["!=", "Cancelled"]})
			obs_list = []
			obs_dict = {}
			for child in child_observations:
				if child.get("permitted_data_type") == "Select" and child.get("options"):
					child["options_list"] = child.get("options").split("\n")
				observation_data = {}
				reference_details = get_observation_reference(child.get("observation_template"), age, gender)
				observation_data["template_reference"] = reference_details[0]
				observation_data["observation"] = child
				obs_list.append(observation_data)
			obs_dict["has_component"] = True
			obs_dict["observation"] = obs.get("name")
			obs_dict[obs.get("name")] = obs_list
			obs_dict["display_name"] = obs.get("observation_template")
			# obs_dict[str(obs.get("observation_template")) + "|" + str(obs.get("name"))] = obs_list
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
	display_reference = ""
	for child in template_doc.observation_reference_range:
		if child.age == "All" or (child.age == "Range" and float(child.age_from) <= float(age) <= float(child.age_to)):
			if child.short_interpretation and ((child.reference_from and child.reference_to) or child.conditions):
				display_reference += str(child.short_interpretation) + ":" + ((str(child.reference_from) +"-"+ str(child.reference_to)) if child.reference_from else str(child.conditions)) + "<br>"
	reference_data["display_reference"] = display_reference
	data.append(reference_data)
	return data

@frappe.whitelist()
def edit_observation(observation, data_type, result):
	observation_doc = frappe.get_doc("Observation", observation)
	if data_type in ["Range", "Ratio"]:
		observation_doc.result_data = result
	elif data_type in ["Quantity", "Numeric"]:
		observation_doc.result_float = result
	elif data_type == "Text":
		observation_doc.result_text = result
	observation_doc.save()

@frappe.whitelist()
def add_observation(patient, template, data_type, result, doc, docname, parent=None, sample_id=None, invoice=""):

	observation_doc = frappe.new_doc("Observation")
	observation_doc.posting_datetime = now_datetime()
	observation_doc.patient = patient
	observation_doc.observation_template = template
	# observation_doc.permitted_data_type = data_type
	observation_doc.reference_doctype = doc
	observation_doc.reference_docname = docname
	observation_doc.sales_invoice = invoice
	observation_doc.sample_id = sample_id
	if data_type in ["Range", "Ratio"]:
		observation_doc.result_data = result
	elif data_type in ["Quantity", "Numeric"]:
		observation_doc.result_float = result
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
			observation_details = frappe.db.get_value("Observation", val.get("observation"), ["permitted_data_type", "result_float", "result_attach", "result_data", "result_text", "result_select"], as_dict=True)

			if observation_details.get("permitted_data_type") in ["Quantity", "Numeric"]:
				if val.get("result") != observation_details.get("result_float"):
					frappe.db.set_value("Observation", val["observation"], "result_float", val.get("result"))
			elif observation_details.get("permitted_data_type") == "Text":
				if val.get("result") != observation_details.get("result_text"):
					frappe.db.set_value("Observation", val["observation"], "result_text", val.get("result"))
			elif observation_details.get("permitted_data_type") == "Select":
				if val.get("result") != observation_details.get("result_select"):
					frappe.db.set_value("Observation", val["observation"], "result_select", val.get("result"))

@frappe.whitelist()
def add_remarks(remarks, observation):
	if remarks and observation:
		frappe.db.set_value("Observation", observation, "remarks", remarks)