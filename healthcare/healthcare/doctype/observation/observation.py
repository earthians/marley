# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import json
import re

import frappe
from erpnext.setup.doctype.terms_and_conditions.terms_and_conditions import (
	get_terms_and_conditions,
)

from healthcare.healthcare.doctype.patient_history_settings.patient_history_settings import validate_medical_record_required
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, get_link_to_form, now_datetime
from frappe.model.workflow import (get_workflow_name, get_workflow_state_field)


class Observation(Document):
	def validate(self):
		self.set_age()
		self.set_result_time()
		self.set_status()
		self.reference = get_observation_reference(self)
		self.validate_input()

	def on_update(self):
		set_diagnostic_report_status(self)
		if self.parent_observation and self.result_data and self.permitted_data_type in ["Quantity", "Numeric"]:
			set_calculated_result(self)

	def before_insert(self):
		set_observation_idx(self)

	def on_submit(self):
		update_patient_medical_record(self)

	def set_age(self):
		patient_doc = frappe.get_doc("Patient", self.patient)
		if patient_doc.dob:
			self.age = patient_doc.calculate_age().get("age_in_string")
			self.days = patient_doc.calculate_age().get("age_in_days")

	def set_status(self):
		if self.status not in ["Approved", "Disapproved"]:
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
		component_obs = frappe.get_all("Observation", {"parent_observation": self.name}, pluck="name")
		for obs in component_obs:
			obs_doc = frappe.get_doc("Observation", obs)
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


@frappe.whitelist()
def get_observation_details(docname, observation_status=None):
	reference = frappe.get_value("Diagnostic Report", docname, ["docname", "ref_doctype"], as_dict=True)
	observation = []
	if reference.get("ref_doctype") == "Sales Invoice":
		observation = frappe.get_list(
			"Observation",
			fields=["*"],
			filters={"sales_invoice": reference.get("docname"), "parent_observation": "", "status": ["!=", "Cancelled"], "docstatus":["!=", 2]},
			order_by="creation",
		)
	elif reference.get("ref_doctype") == "Patient Encounter":
		service_requests = frappe.get_all(
			"Service Request",
			filters={"source_doc": reference.get("ref_doctype"), "order_group": reference.get("docname"), "status": ["!=", "Cancelled"], "docstatus":["!=", 2]},
			order_by="creation",
			pluck="name",
		)
		observation = frappe.get_list(
			"Observation",
			fields=["*"],
			filters={"service_request": ["in", service_requests], "parent_observation": "", "status": ["!=", "Cancelled"], "docstatus":["!=", 2]},
			order_by="creation",
		)

	out_data = []
	obs_length = 0
	for obs in observation:
		has_result = False
		obs_approved = False
		if not obs.get("has_component"):
			if observation_status and obs.get("status") != observation_status:
				continue

			if obs.get("permitted_data_type"):
				obs_length += 1
			observation_data = {}
			if obs.get("permitted_data_type") == "Select" and obs.get("options"):
				obs["options_list"] = obs.get("options").split("\n")
			if obs.get("observation_template"):
				if obs.get("specimen"):
					obs["received_time"] = frappe.get_value("Specimen", obs.get("specimen"), "received_time")
				out_data.append(observation_data)
				observation_data["observation"] = obs

		else:
			filters={"parent_observation": obs.get("name"), "status": ["!=", "Cancelled"], "docstatus":["!=", 2]}
			if observation_status:
				filters["status"] = observation_status

			child_observations = frappe.get_list(
				"Observation",
				fields=["*"],
				filters=filters,
				order_by="observation_idx",
			)
			obs_list = []
			obs_dict = {}
			for child in child_observations:
				if child.get("permitted_data_type"):
					obs_length += 1
				if child.get("permitted_data_type") == "Select" and child.get("options"):
					child["options_list"] = child.get("options").split("\n")
				if child.get("specimen"):
					child["received_time"] = frappe.get_value("Specimen", child.get("specimen"), "received_time")
				observation_data = {}
				observation_data["observation"] = child
				obs_list.append(observation_data)
				if (
					child.get("result_data")
					or child.get("result_text")
					or child.get("result_select") not in [None, "", "Null"]
				):
					has_result = True
			if any(child.get("status") != "Approved" for child in child_observations):
				obs_approved = False
			else:
				obs_approved = True
			if len(child_observations) > 0:
				obs_dict["has_component"] = True
				obs_dict["observation"] = obs.get("name")
				obs_dict[obs.get("name")] = obs_list
				obs_dict["display_name"] = obs.get("observation_template")
				obs_dict["practitioner_name"] = obs.get("practitioner_name")
				obs_dict["healthcare_practitioner"] = obs.get("healthcare_practitioner")
				obs_dict["description"] = obs.get("description")
				obs_dict["has_result"] = has_result
				obs_dict["obs_approved"] = obs_approved
			if len(obs_dict) > 0:
				out_data.append(obs_dict)
	return out_data, obs_length


def get_observation_reference(doc):
	template_doc = frappe.get_doc("Observation Template", doc.observation_template)
	display_reference = ""

	for child in template_doc.observation_reference_range:
		if not child.applies_to == "All":
			if not child.applies_to == doc.gender:
				continue
		if child.age == "Range":
			day_from = day_to = 0
			if child.from_age_type == "Months":
				day_from = float(child.age_from) * 30.436875
			elif child.from_age_type == "Years":
				day_from = float(child.age_from) * 365.2425
			elif child.from_age_type == "Days":
				day_from = float(child.age_from)

			if child.to_age_type == "Months":
				day_to = float(child.age_to) * 30.436875
			elif child.to_age_type == "Years":
				day_to = float(child.age_to) * 365.2425
			elif child.to_age_type == "Days":
				day_to = float(child.age_to)

			if doc.days and float(day_from) <= float(doc.days) <= float(day_to):
				display_reference += set_reference_string(child)

		elif child.age == "All" or not doc.days:
			display_reference += set_reference_string(child)

	return display_reference


def set_reference_string(child):
	display_reference = ""
	if (child.reference_from and child.reference_to) or child.conditions:
		if child.reference_from and child.reference_to:
			display_reference = f"{str(child.reference_from)} - {str(child.reference_to)}"
		elif child.conditions:
			display_reference = f"{str(child.conditions)}"

		if child.short_interpretation:
			display_reference = f"{display_reference}: {str(child.short_interpretation)}<br>"

	elif child.short_interpretation or child.long_interpretation:
		display_reference = f"{(child.short_interpretation if child.short_interpretation else child.long_interpretation)}<br>"

	return display_reference


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
def add_observation(**args):
	observation_doc = frappe.new_doc("Observation")
	observation_doc.posting_datetime = now_datetime()
	observation_doc.patient = args.get("patient")
	observation_doc.observation_template = args.get("template")
	observation_doc.permitted_data_type = args.get("data_type")
	observation_doc.reference_doctype = args.get("doc")
	observation_doc.reference_docname = args.get("docname")
	observation_doc.sales_invoice = args.get("invoice")
	observation_doc.healthcare_practitioner = args.get("practitioner")
	observation_doc.specimen = args.get("specimen")
	observation_doc.service_request = args.get("service_request")
	if args.get("data_type") in ["Range", "Ratio", "Quantity", "Numeric"]:
		observation_doc.result_data = args.get("result")
	# elif data_type in ["Quantity", "Numeric"]:
	# 	observation_doc.result_float = result
	elif args.get("data_type") == "Text":
		observation_doc.result_text = args.get("result")
	if args.get("parent"):
		observation_doc.parent_observation = args.get("parent")
	observation_doc.sales_invoice_item = args.get("child") if args.get("child") else ""
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
		parent_template = frappe.db.get_value(
			"Observation", doc.parent_observation, "observation_template"
		)
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
	if observation_doc.has_result() or observation_doc.has_component:
		if observation_doc.has_component:
			parent_obs = None
			if not observation_doc.component_has_result():
				frappe.throw(_("Please enter result for all components to Approve."))

		observation_doc.status = status
		if reason:
			observation_doc.disapproval_reason = reason
		if status == "Approved":
			observation_doc.submit()
		if status == "Disapproved":
			new_doc = frappe.copy_doc(observation_doc)
			new_doc.status = ""
			new_doc.disapproval_reason = ""
			if parent_obs:
				new_doc.parent_observation = parent_obs
			new_doc.insert()
			observation_doc.cancel()
			if observation_doc.has_component:
				parent_obs = new_doc.name
		if observation_doc.has_component:
			if status == "Approved":
				docstatus = 0
			elif status == "Disapproved":
				docstatus = 1
			component_obs = frappe.get_all("Observation", {"parent_observation": observation, "docstatus":["=", docstatus]}, pluck="name")
			for obs in component_obs:
				set_observation_status(obs, status, reason, parent_obs)
	else:
		frappe.throw(_("Please enter result to Approve."))

def set_diagnostic_report_status(doc):
	if doc.has_result() and doc.sales_invoice and not doc.has_component and doc.sales_invoice:
		observations = frappe.db.get_all("Observation", {"sales_invoice": doc.sales_invoice, "docstatus": 0, "status": ["!=", "Approved"], "has_component":0})
		diagnostic_report = frappe.db.get_value("Diagnostic Report", {"ref_doctype": "Sales Invoice", "docname":doc.sales_invoice}, ["name"], as_dict=True)
		if diagnostic_report:
			workflow_name = get_workflow_name("Diagnostic Report")
			workflow_state_field = get_workflow_state_field(workflow_name)
			if observations and len(observations)>0:
				set_status = "Partially Approved"
			else:
				set_status = "Approved"
			set_value_dict = {"status": set_status}
			if workflow_state_field:
				set_value_dict[workflow_state_field] = set_status
			frappe.db.set_value("Diagnostic Report", diagnostic_report.get("name"), set_value_dict, update_modified=False)


def update_patient_medical_record(doc):
	if doc.sales_invoice:
		diagnostic_report = frappe.db.get_value("Diagnostic Report", {"docname": doc.sales_invoice}, "name")
		if not diagnostic_report:
			return

		daig_doc = frappe.get_doc("Diagnostic Report", diagnostic_report)
		medical_record_required = validate_medical_record_required(daig_doc)
		if not medical_record_required:
			return

		if diagnostic_report:
			daig_data = get_observation_details(diagnostic_report, observation_status="Approved")
			if daig_data and daig_data[0] and len(daig_data[0])>0:
				obs_html = set_observation_html(daig_data)
				if obs_html:
					exist = frappe.db.exists("Patient Medical Record", {"reference_name": diagnostic_report})
					if exist:
						frappe.db.set_value("Patient Medical Record", exist, "subject", obs_html)
					else:
						create_medical_record(daig_doc, obs_html)


def set_observation_html(daig_data, obs_as_link=True):
	out_html = """
		<table style="border-collapse: collapse; width: 100%;">
			<tr style="background-color: #f2f2f2; border: 1px solid #dddddd;">
				<td style="border: 1px solid #dddddd; text-align: left; padding: 8px;">Observation</td>
				<td style="border: 1px solid #dddddd; text-align: left; padding: 8px;">Result</td>
				<td style="border: 1px solid #dddddd; text-align: left; padding: 8px;">Reference</td>
				<td style="border: 1px solid #dddddd; text-align: left; padding: 8px;">Result Entered On</td>
			</tr>
		"""
	for diag in daig_data[0]:
		if diag.get("has_component") and diag.get("observation"):
			out_html += f"""
						<tr>
							<td style='border: 1px solid #dddddd; text-align: left; padding: 8px;'><b>{diag.get("display_name")}</b></td>
							<td> </td>
							<td> </td>
							<td> </td>
						</tr>
						"""
			for comp_data in diag.get(diag.get("observation")):
				comp_obs_data = comp_data.get("observation")
				if obs_as_link:
					href = f'<a href="/app/observation/{comp_obs_data.get("name")}">{comp_obs_data.get("observation_template")}</a>'
				else:
					href = comp_obs_data.get("observation_template")
				out_html += f"""
					<tr>
						<td style='border: 1px solid #dddddd; text-align: left; padding: 8px;'>&nbsp;&nbsp;&nbsp;{href}</td>
						<td style='border: 1px solid #dddddd; text-align: left; padding: 8px;'>{comp_obs_data.get("result_text") or comp_obs_data.get("result_data") or comp_obs_data.get("result_select") or "-"} {comp_obs_data.get("permitted_unit") or ""}</td>
						<td style='border: 1px solid #dddddd; text-align: left; padding: 8px; font-size:10px;'>{comp_obs_data.get("reference") or "-"}</td>
						<td style='border: 1px solid #dddddd; text-align: left; padding: 8px; font-size:11px;'>{get_datetime(comp_obs_data.get("time_of_result")).strftime("%Y-%m-%d %H:%M") if comp_obs_data.get("time_of_result") else "-"}</td>
					</tr>
					"""
		elif diag.get("observation"):
			single_data = diag.get("observation")
			if obs_as_link:
					href = f'<a href="/app/observation/{single_data.get("name")}"><b>{single_data.get("observation_template")}</b></a>'
			else:
				href = single_data.get("observation_template")
			out_html += f"""
				<tr>
					<td style='border: 1px solid #dddddd; text-align: left; padding: 8px;'>{href} </td>
					<td style='border: 1px solid #dddddd; text-align: left; padding: 8px;'>{single_data.get("result_text") or single_data.get("result_data") or single_data.get("result_select") or "-"} {single_data.get("permitted_unit") or ""}</td>
					<td style='border: 1px solid #dddddd; text-align: left; padding: 8px; font-size:10px;'>{single_data.get("reference") or "-"}</td>
					<td style='border: 1px solid #dddddd; text-align: left; padding: 8px; font-size:11px;'>{get_datetime(single_data.get("time_of_result")).strftime("%Y-%m-%d %H:%M") if single_data.get("time_of_result") else "-"}</td>
				</tr>
			"""
	out_html += "</table>"
	return out_html


def create_medical_record(daig_doc, subject):
	if frappe.db.exists("Patient Medical Record", {"reference_name": daig_doc.name}):
		return

	medical_record = frappe.new_doc("Patient Medical Record")
	medical_record.patient = daig_doc.patient
	medical_record.subject = subject
	medical_record.status = "Open"
	medical_record.communication_date = daig_doc.reference_posting_date
	medical_record.reference_doctype = "Diagnostic Report"
	medical_record.reference_name = daig_doc.name
	medical_record.reference_owner = daig_doc.owner
	medical_record.save(ignore_permissions=True)


@frappe.whitelist()
def delta_check(observation):
	obs_data = frappe.db.get_value("Observation", observation, ["patient", "observation_template"], as_dict=True)
	previous_data = frappe.get_all("Observation", {"patient": obs_data.get("patient"), "observation_template": obs_data.get("observation_template"), "docstatus": 1, "name": ["!=", observation]}, "*", limit=3)
	return previous_data


def set_calculated_result(doc):
	if doc.parent_observation:
		parent_template = frappe.db.get_value(
			"Observation", doc.parent_observation, "observation_template"
		)
		parent_template_doc = frappe.get_cached_doc(
			"Observation Template", parent_template
		)

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
				data = get_data(doc, parent_template_doc, data)

			if data and len(data)>0:
				result = eval_formula(component, data)
				if not result:
					continue

				result_observation_name, result_data = frappe.db.get_value(
					"Observation",
					{
						"parent_observation": doc.parent_observation,
						"observation_template": component.get(
							"observation_template"
						),
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


def get_data(doc, parent_template_doc, data):
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
			if (
				d["observation_template"] == component.get("observation_template")
				and d["result_data"]
			)
		]
		data[component.get("abbr")] = (
			flt(result[0]) if (result and len(result) > 0 and result[0]) else 0
		)
	return data


def eval_formula(d, data):
	try:
		if d.based_on_formula:
			amount = None
			formula = d.formula.strip().replace("\n", " ") if d.formula else None

			abbrs = list(set(re.findall(r"\b[A-Za-z]+\b", formula)))
			# check the formula abbrs has result value
			abbrs_present = all(abbr in data and data[abbr] != 0 for abbr in abbrs)
			if formula and abbrs_present:
				amount = flt(frappe.safe_eval(formula, {}, data))

		return amount

	except Exception as err:
		description = _("This error can be due to invalid formula.")
		message = _(
			f"""Error while evaluating the {d.parenttype} {get_link_to_form(d.parenttype, d.parent)}
			at row {d.idx}. <br><br> <b>Error:</b> {err} <br><br> <b>Hint:</b> {description}"""
		)

		frappe.throw(message, title=_("Error in formula"))
