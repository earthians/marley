# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import date_diff, getdate, today, now_datetime


class Observation(Document):
	def validate(self):
		dob  = frappe.db.get_value("Patient", self.patient, "dob")
		if dob:
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
def get_observation_template_reference(docname, patient, sex):
	observation = frappe.get_all("Observation", fields=["name", "observation_template", "posting_datetime", "result_data", "result_text", "result_float", "permitted_data_type", "has_component", "parent_observation"], filters={"reference_docname": docname, "parent_observation": ""})#, "has_component":0})
	age = calculate_age(frappe.db.get_value("Patient", patient, "dob"))
	out_data = []
	for obs in observation:
		if not obs.get("has_component"):
			observation_data = {}
			if obs.get("observation_template"):
				reference_details = get_observation_reference(obs.get("observation_template"), age, sex)
				if reference_details:
					observation_data["template_reference"] = reference_details[0]
				observation_data["observation"] = obs
				out_data.append(observation_data)
		else:
			child_observations = frappe.get_all("Observation", fields=["name", "observation_template", "posting_datetime", "result_data", "result_text", "result_float", "permitted_data_type", "parent_observation"], filters={"parent_observation": obs.get("name")})
			obs_list = []
			obs_dict = {}
			for child in child_observations:
				observation_data = {}
				reference_details = get_observation_reference(child.get("observation_template"), age, sex)
				observation_data["template_reference"] = reference_details[0]
				observation_data["observation"] = child
				obs_list.append(observation_data)
			obs_dict[str(obs.get("observation_template")) + "|" + str(obs.get("name"))] = obs_list
			out_data.append(obs_dict)

	return out_data

def get_observation_reference(observation_template, age, patient_sex):
	template_dict = frappe.db.get_value("Observation Template", observation_template, ["method", "options as observation_options", "permitted_unit", "preferred_display_name"], as_dict=True)
	data = frappe.db.sql(f"""
		select
			orr.*
		from
			`tabObservation Reference Range` as orr join
			`tabObservation Template` as ot on ot.name=orr.parent
		where
			parent="{observation_template}"
			and "{age}" between age_from and age_to
			and applies_to = "{patient_sex}"
			""", as_dict=True)
	data.append(template_dict)
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
def add_observation(patient, template, data_type, result, doc, docname, parent=None):

	observation_doc = frappe.new_doc("Observation")
	observation_doc.posting_datetime = now_datetime()
	observation_doc.patient = patient
	observation_doc.observation_template = template
	observation_doc.permitted_data_type = data_type
	observation_doc.reference_doctype = doc
	observation_doc.reference_docname = docname
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