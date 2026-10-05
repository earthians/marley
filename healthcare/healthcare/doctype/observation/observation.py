# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import json
import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.workflow import get_workflow_name, get_workflow_state_field
from frappe.utils import flt, get_link_to_form, get_time, getdate, now_datetime, nowdate

from erpnext.setup.doctype.terms_and_conditions.terms_and_conditions import (
	get_terms_and_conditions,
)

from healthcare.healthcare.api.nursing_common import has_value

DAYS_PER_AGE_TYPE = {"Years": 365.2425, "Months": 30.436875, "Days": 1}

# Types whose result is a plain number, matched against reference ranges numerically.
NUMERIC_DATA_TYPES = ("Quantity", "Numeric", "Range", "Percent")


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
		self.result_flag, self.result_flag_color = get_observation_result_flag(self)
		self.validate_input()
		self.sanitize_input()

	def on_update(self):
		set_diagnostic_report_status(self)
		if self.parent_observation and self.result and self.permitted_data_type in ["Quantity", "Numeric"]:
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
		return has_value(self.result)

	def component_has_result(self):
		component_obs = frappe.db.get_all(
			"Observation",
			{
				"parent_observation": self.name,
				"docstatus": ["!=", 2],
			},
			pluck="name",
		)
		for obs in component_obs:
			obs_doc = frappe.get_doc("Observation", obs)
			if obs_doc.has_component:
				if not obs_doc.component_has_result():
					return False
			else:
				if not obs_doc.has_result():
					return False

		return True

	def is_ready_for_approval(self):
		if self.has_component:
			return self.component_has_result()

		return self.has_result()

	def validate_input(self):
		if self.permitted_data_type in NUMERIC_DATA_TYPES:
			if self.result and not is_numbers_with_exceptions(self.result):
				frappe.throw(
					_("Non numeric result {0} is not allowed for Permitted Data Type {1}").format(
						frappe.bold(self.result), frappe.bold(self.permitted_data_type)
					)
				)

	def sanitize_input(self):
		html_fields = ["result_interpretation", "note"]
		if self.permitted_data_type == "Text" or self.observation_category == "Imaging":
			html_fields.append("result")

		for field in html_fields:
			value = self.get(field)
			if value:
				self.set(field, frappe.utils.sanitize_html(value))

	def render_templates(self):
		if self.result_template and not self.result:
			self.result = get_terms_and_conditions(self.result_template, self.as_dict())

		if self.interpretation_template and not self.result_interpretation:
			self.result_interpretation = get_terms_and_conditions(
				self.interpretation_template, self.as_dict()
			)


@frappe.whitelist()
def get_observation_details(docname: str) -> tuple[list[dict], int]:
	observation = get_root_observations(docname)

	out_data, obs_length = aggregate_and_return_observation_data(observation)

	return out_data, obs_length


def get_root_observations(docname):
	"""Observations of a Diagnostic Report that are not components of another Observation"""
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

	return observation


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

			ensure_result_flag(obs)
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
			ensure_result_flag(child)
			observation_data = {"observation": child}
			obs_list.append(observation_data)

		if has_value(child.get("result")):
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


def get_observation_result_flag(doc):
	"""Text and color for the indicator shown next to a result, for whichever
	reference-range band the result falls in — only when that band's author
	opted in via "Show Indicator on Report". Returns (text, color), either of
	which may be empty."""
	if not doc.observation_template or not has_value(doc.result):
		return "", ""

	template_doc = frappe.get_doc("Observation Template", doc.observation_template)
	candidates = [
		child
		for child in template_doc.observation_reference_range
		if reference_applies_to_patient(child, doc) and reference_matches_age(child, doc)
	]
	matched = match_reference_band(doc, candidates)
	if not matched or not matched.show_indicator_on_report:
		return "", ""

	text = matched.short_interpretation or get_reference_type_display(matched.reference_type)
	return text or "", matched.indicator_color or ""


def get_reference_type_display(reference_type):
	if not reference_type:
		return ""
	return frappe.db.get_value("Code Value", reference_type, "display") or ""


def ensure_result_flag(obs):
	"""result_flag/result_flag_color are only ever (re)computed when an
	Observation is saved — a template's reference ranges can change (or this
	logic itself can change) without every existing Observation being resaved.
	A stored flag isn't just possibly blank, it can be actively wrong: stale
	text/color from a band that no longer matches, or from an indicator that
	has since been turned off. Always recompute live here, in the single
	function the Diagnostic Report widget and its print format both read
	through, rather than trusting whatever is already stored. Also derives a
	light tint of the indicator color for the badge background, and a
	display-formatted version of `result` for the same two consumers.
	"""
	obs["result_flag"], obs["result_flag_color"] = get_observation_result_flag(frappe._dict(obs))

	if obs.get("result_flag_color"):
		obs["result_flag_bg"] = hex_to_rgba(obs["result_flag_color"], 0.12)

	obs["result_display"] = get_result_display(obs)

	return obs


def hex_to_rgba(hex_color, alpha):
	hex_color = (hex_color or "").lstrip("#")
	if len(hex_color) != 6:
		return None
	r, g, b = (int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
	return f"rgba({r}, {g}, {b}, {alpha})"


def get_result_display(obs):
	"""Period results are stored as a JSON {"from", "to"} pair — fine for the
	editable control to round-trip, but raw JSON shouldn't leak into the
	Diagnostic Report or Patient Medical Record. Every other type passes
	through unchanged."""
	result = obs.get("result")
	if obs.get("permitted_data_type") != "Period" or not has_value(result):
		return result

	try:
		parsed = json.loads(result)
	except (TypeError, ValueError):
		return result
	if not isinstance(parsed, dict):
		return result

	from_value, to_value = parsed.get("from") or "", parsed.get("to") or ""
	if not from_value and not to_value:
		return ""

	return f"{from_value} - {to_value}"


SHORTHAND_CONDITION = re.compile(r"^\s*(<=|>=|<|>|==|!=)\s*-?[\d.]+\s*$")


def normalize_condition(condition):
	"""Reference ranges have always been authored as informal shorthand, e.g.
	"<200" or ">239" — display-only text, not a Python expression (there's no
	left-hand operand). Prepend the operand so these now evaluate correctly,
	without requiring every existing template to be rewritten."""
	if SHORTHAND_CONDITION.match(condition):
		return f"value{condition.strip()}"

	return condition


def match_reference_band(doc, candidates):
	matches = [child for child in candidates if reference_band_matches_result(child, doc)]
	if len(matches) <= 1:
		return matches[0] if matches else None

	# More than one band matches the same result — this happens with
	# overlapping conditions, e.g. ">6.5" and ">7.0" are both true for 7.8.
	# Prefer whichever band's boundary the result sits nearest to: that's the
	# more specific band, not just whichever was listed first in the table.
	value = flt(doc.result) if has_value(doc.result) else None
	if value is None:
		return matches[0]

	def sort_key(indexed_child):
		index, child = indexed_child
		distance = band_boundary_distance(child, value)
		return (distance if distance is not None else float("inf"), index)

	return min(enumerate(matches), key=sort_key)[1]


def band_boundary_distance(child, value):
	"""How close `value` sits to whichever boundary made `child` match — used
	by match_reference_band to break ties between overlapping bands."""
	if child.conditions:
		threshold = condition_threshold(child.conditions)
		return abs(value - threshold) if threshold is not None else None

	bounds = [flt(b) for b in (child.reference_from, child.reference_to) if has_value(b)]
	return min((abs(value - b) for b in bounds), default=None)


NUMBER_IN_CONDITION = re.compile(r"[-+]?[0-9]*\.?[0-9]+")


def condition_threshold(condition):
	if not SHORTHAND_CONDITION.match(condition):
		return None
	match = NUMBER_IN_CONDITION.search(condition)
	return flt(match.group()) if match else None


def reference_band_matches_result(child, doc):
	# An authored condition always takes priority: it can express things a
	# plain from/to pair cannot (open-ended bounds, compound checks).
	if child.conditions:
		try:
			return bool(
				frappe.safe_eval(normalize_condition(child.conditions), {}, {"value": flt(doc.result)})
			)
		except Exception:
			return False

	data_type = doc.permitted_data_type

	if data_type in NUMERIC_DATA_TYPES:
		return numeric_value_in_band(doc.result, child.reference_from, child.reference_to)

	if data_type == "Boolean":
		return bool(child.boolean_value) and doc.result == child.boolean_value

	if data_type == "Select":
		return bool(child.options) and doc.result == child.options

	if data_type == "Ratio":
		return bool(child.ratio) and doc.result == child.ratio

	if data_type == "DateTime":
		return bool(child.datetime) and doc.result == str(child.datetime)

	if data_type == "Time":
		return duration_value_in_band(doc.result, child.from_duration, child.to_duration)

	if data_type == "Duration":
		return numeric_value_in_band(doc.result, child.from_duration, child.to_duration)

	if data_type == "Period":
		return period_value_in_band(doc.result, child.from_datetime, child.to_datetime)

	return False


def numeric_value_in_band(value, band_from, band_to):
	value = flt(value) if has_value(value) else None
	if value is None:
		return False

	band_from = flt(band_from) if has_value(band_from) else None
	band_to = flt(band_to) if has_value(band_to) else None

	if band_from is None and band_to is None:
		return False
	if band_from is not None and band_to is not None:
		return band_from <= value <= band_to
	if band_from is not None:
		return value >= band_from

	return value <= band_to


def duration_value_in_band(result, band_from, band_to):
	if not has_value(result):
		return False
	try:
		result_time = get_time(result)
	except Exception:
		return False

	seconds = result_time.hour * 3600 + result_time.minute * 60 + result_time.second
	return numeric_value_in_band(seconds, band_from, band_to)


def period_value_in_band(result, band_from, band_to):
	if not has_value(result) or not (band_from or band_to):
		return False
	try:
		parsed = json.loads(result)
	except (TypeError, ValueError):
		return False
	if not isinstance(parsed, dict):
		return False

	value_from, value_to = parsed.get("from"), parsed.get("to")
	if band_from and value_from != str(band_from):
		return False
	if band_to and value_to != str(band_to):
		return False

	return True


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
	observation_doc.result = result
	observation_doc.save()


@frappe.whitelist()
def add_observation(**kwargs: str) -> str:
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
	observation_doc.result = kwargs.get("result")
	if kwargs.get("parent"):
		observation_doc.parent_observation = kwargs.get("parent")
	observation_doc.sales_invoice_item = kwargs.get("child") if kwargs.get("child") else ""
	observation_doc.service_request = kwargs.get("service_request")
	observation_doc.insert(ignore_permissions=True)
	return observation_doc.name


@frappe.whitelist()
def record_observation_result(values: str) -> None:
	values = json.loads(values)
	if values:
		values = [dict(t) for t in {tuple(d.items()) for d in values}]
		for val in values:
			if not val.get("observation"):
				return
			observation_doc = frappe.get_doc("Observation", val["observation"])
			# Numeric-typed controls submit a JSON number rather than a
			# string; normalize once so comparisons/storage stay consistent.
			if val.get("result") is not None:
				val["result"] = str(val["result"])

			if observation_doc.get("permitted_data_type") in NUMERIC_DATA_TYPES:
				if val.get("result") and not is_numbers_with_exceptions(val.get("result")):
					frappe.msgprint(
						_("Non numeric result {0} is not allowed for Permitted Type {1}").format(
							frappe.bold(val.get("result")),
							frappe.bold(observation_doc.get("permitted_data_type")),
						),
						indicator="orange",
						alert=True,
					)
					return

			# "result" is only present in val when the client's result control
			# itself changed (see set_result_n_name in observation_widget.js) —
			# an Interpretation-only save, or a note-only save, omits the key
			# entirely so it never touches result. When present, apply it as
			# sent, including clearing it to "" (e.g. removing an attachment).
			result_changed = "result" in val and val.get("result") != observation_doc.get("result")
			if result_changed:
				observation_doc.result = val.get("result") or ""

			if result_changed or val.get("note"):
				if val.get("note"):
					observation_doc.note = val.get("note")
				if observation_doc.docstatus == 0:
					observation_doc.save()
				elif observation_doc.docstatus == 1:
					observation_doc.save("Update")

			if observation_doc.get("observation_category") == "Imaging":
				if val.get("result"):
					observation_doc.result = val.get("result")
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
def add_note(note: str, observation: str) -> None:
	if note and observation:
		frappe.db.set_value("Observation", observation, "note", frappe.utils.sanitize_html(note))


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
	# Numeric-typed controls (Float/Percent) submit an actual
	# JSON number, not a string, once decoded — only Data-style free text
	# results ever reach here as a str.
	pattern = r"^[0-9{}]+$".format(re.escape(".<>"))
	return re.match(pattern, str(value)) is not None


@frappe.whitelist()
def get_observation_result_template(template_name: str, observation: str) -> str:
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
def set_observation_status(
	observation: str, status: str, reason: str | None = None, parent_obs: str | None = None
) -> None:
	observation_doc = frappe.get_doc("Observation", observation)

	if not observation_doc.is_ready_for_approval():
		if observation_doc.has_component:
			frappe.throw(_("Please enter result for all components to Approve."))
		frappe.throw(_("Please enter result to Approve."))

	observation_doc.status = status
	if reason:
		observation_doc.disapproval_reason = reason

	if status == "Approved":
		observation_doc.submit()
	elif status == "Rejected":
		if not observation_doc.has_component:
			observation_doc.cancel()
		new_doc = frappe.copy_doc(observation_doc)
		new_doc.docstatus = 0
		new_doc.status = ""
		new_doc.disapproval_reason = ""
		if parent_obs:
			new_doc.parent_observation = parent_obs
		new_doc.insert()
		if observation_doc.has_component:
			parent_obs = new_doc.name

	if observation_doc.has_component:
		for obs in get_component_observations(observation, status):
			set_observation_status(obs, status, reason, parent_obs)
		if status == "Rejected":
			observation_doc.cancel()


def get_component_observations(observation, status):
	filters = {"parent_observation": observation}
	if status == "Approved":
		# already approved components are submitted, approving them again is not possible
		filters.update({"status": ["!=", "Approved"], "docstatus": 0})

	return frappe.db.get_all("Observation", filters=filters, pluck="name")


@frappe.whitelist()
def approve_all_observations(diagnostic_report: str) -> dict[str, list[str]]:
	"""Approve every Observation of the report that has a result, skip the rest"""
	approved, skipped = [], []

	for observation in get_root_observations(diagnostic_report):
		if observation.get("status") == "Approved" or observation.get("docstatus") != 0:
			continue

		observation_doc = frappe.get_doc("Observation", observation.get("name"))
		if not observation_doc.is_ready_for_approval():
			skipped.append(get_observation_label(observation_doc))
			continue

		set_observation_status(observation_doc.name, "Approved")
		approved.append(observation_doc.name)

	return {"approved": approved, "skipped": skipped}


@frappe.whitelist()
def reject_all_observations(diagnostic_report: str, reason: str) -> dict[str, list[str]]:
	"""Reject every approved Observation of the report"""
	if not reason:
		frappe.throw(_("Please enter a reason to Reject."))

	rejected, skipped = [], []

	for observation in get_root_observations(diagnostic_report):
		if observation.get("status") != "Approved":
			skipped.append(get_observation_label(observation))
			continue

		set_observation_status(observation.get("name"), "Rejected", reason)
		rejected.append(observation.get("name"))

	return {"rejected": rejected, "skipped": skipped}


def get_observation_label(observation_doc):
	return (
		observation_doc.preferred_display_name or observation_doc.observation_template or observation_doc.name
	)


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

				result_observation_name, existing_result = frappe.db.get_value(
					"Observation",
					{
						"parent_observation": doc.parent_observation,
						"observation_template": component.get("observation_template"),
					},
					["name", "result"],
				)
				if result_observation_name and existing_result != str(result):
					frappe.db.set_value(
						"Observation",
						result_observation_name,
						"result",
						str(result),
					)


def get_data(doc, parent_template_doc):
	data = frappe._dict()
	observation_details = frappe.get_all(
		"Observation",
		{"parent_observation": doc.parent_observation},
		["observation_template", "result"],
	)

	# to get all results to map against abbs of all table rows
	for component in parent_template_doc.observation_component:
		result = [
			d["result"]
			for d in observation_details
			if (d["observation_template"] == component.get("observation_template") and d["result"])
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

		ensure_result_flag(obs_doc)
		out_data.append({"observation": obs_doc})

	else:
		child_observations = get_child_observations(obs_doc)
		obs_dict, _obs_length = return_child_observation_data_as_dict(child_observations, obs_doc)

		if len(obs_dict) > 0:
			out_data.append(obs_dict)

	return out_data
