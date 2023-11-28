# -*- coding: utf-8 -*-
# Copyright (c) 2018, ESS LLP and contributors
# For license information, please see license.txt


import json

import frappe
from frappe.utils import cint, get_datetime


@frappe.whitelist()
def get_feed(name, document_types=None, date_range=None, start=0, page_length=20):
	"""get feed"""
	filters = get_filters(name, document_types, date_range)

	result = frappe.db.get_all(
		"Patient Medical Record",
		fields=["name", "owner", "communication_date", "reference_doctype", "reference_name", "subject"],
		filters=filters,
		order_by="communication_date DESC",
		limit=cint(page_length),
		start=cint(start),
	)

	return result


def get_filters(name, document_types=None, date_range=None):
	filters = {"patient": name}
	if document_types:
		document_types = json.loads(document_types)
		if len(document_types):
			filters["reference_doctype"] = ["IN", document_types]

	if date_range:
		try:
			date_range = json.loads(date_range)
			if date_range:
				filters["communication_date"] = ["between", [date_range[0], date_range[1]]]
		except json.decoder.JSONDecodeError:
			pass

	return filters


@frappe.whitelist()
def get_feed_for_dt(doctype, docname):
	"""get feed"""
	result = frappe.db.get_all(
		"Patient Medical Record",
		fields=["name", "owner", "communication_date", "reference_doctype", "reference_name", "subject"],
		filters={"reference_doctype": doctype, "reference_name": docname},
		order_by="communication_date DESC",
	)

	return result


@frappe.whitelist()
def get_patient_history_doctypes():
	document_types = []
	settings = frappe.get_single("Patient History Settings")

	for entry in settings.standard_doctypes:
		document_types.append(entry.document_type)

	for entry in settings.custom_doctypes:
		document_types.append(entry.document_type)

	return document_types


@frappe.whitelist()
def get_patient_data(patient):
	from healthcare.healthcare.utils import render_doc_as_html
	from healthcare.healthcare.doctype.observation.observation import get_observation_details, set_observation_html
	from healthcare.healthcare.doctype.patient_history_settings.patient_history_settings import set_subject_field
	html = ""
	html += set_initial_data(patient, html)
	for doc in get_patient_history_doctypes():
		if doc not in  ["Diagnostic Report"]:
			data = frappe.db.get_all(doc, {"patient": patient}, pluck="name")
			for val in data:
				val_data = frappe.get_doc(doc, val)
				html += f'<br><div style="font-size:20px; background-color: #bde6f2;"><b>{doc} {val_data.get("name")} - {get_datetime(val_data.get("creation")).strftime("%Y-%m-%d %H:%M")}</b></div><br>'
				html += set_subject_field(val_data)
		elif doc == "Diagnostic Report":
			diagnost_list = frappe.db.get_all("Diagnostic Report", {"patient": patient}, ["name", "creation"])
			for diagnostic_report in diagnost_list:
				daig_data = get_observation_details(diagnostic_report.get("name"), observation_status="Approved")
				if daig_data and daig_data[0] and len(daig_data[0])>0:
					html += f'<br><div style="page-break-inside: avoid;"> <div style="font-size:20px; background-color: #bde6f2;"><b>Diagnostic Report {diagnostic_report.get("name")} - {get_datetime(diagnostic_report.get("creation")).strftime("%Y-%m-%d %H:%M")}</b></div><br>'
					html += set_observation_html(daig_data, obs_as_link=False)
					html += "</div>"
	html += f'<div style="font-size:12px; padding-top:20px; text-align:center;"><b>*End of Report*</b></div>'
	return html


def set_initial_data(patient, html):
	letter_head=frappe.get_doc("Letter Head", "DiagKare Report Letter Head")
	if letter_head and letter_head.content:
		html += f'''<div class="letter-head">{letter_head.content}</div>
		'''

	dob = frappe.db.get_value("Patient", patient, "dob")
	now  = frappe.utils.nowdate()
	if dob:
		diff = frappe.utils.date_diff(now, dob)
		years = diff//365
		months = (diff - (years * 365))//30
		days = ( (diff - (years * 365)) - (months * 30) )
	else:
		years = frappe.db.get_value("Patient", patient, "patient_age")
		months = 0
		days = 0

	patient_data = frappe.db.get_value("Patient", patient, ["sex", "patient_name"], as_dict=True)

	salutation = "Ms"

	if years <= 1:
		salutation = "Baby"
	elif patient_data.get("sex") == "Male" and years <= 13:
		salutation = "Master"
	elif patient_data.get("sex") == "Female" and years <= 18:
		salutation = "Miss"
	elif patient_data.get("sex") == "Male":
		salutation = "Mr"

	html += f'''<div class="row section-break col-xs-12" style="margin-top: 20px;">
			<div class="col-xs-4" style="float:left;"><label>
				Patient Name:<br>
				Number:<br>
				Age: <br>
				Gender: <br>
				</label>
			</div>
			<div class="col-xs-8 value" style= "margin-left:15px;">
				<b>{salutation } { patient_data.get("patient_name").upper() }</b><br>
				<b>{ patient }</b><br>
				<b>{ years }Y { months }M { days }D</b><br>
				<b>{ patient_data.get("sex") }</b><br>
			</div>
	</div>'''
	return html