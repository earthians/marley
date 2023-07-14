# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
import json
from frappe.model.document import Document
from frappe.utils import format_date

from healthcare.healthcare.doctype.observation.observation import calculate_age, get_observation_details


class DiagnosticReport(Document):
	def validate(self):
		self.set_age()
		self.set_invoice_status()

	def before_insert(self):
		if self.ref_doctype == "Sales Invoice" and self.docname:
			self.practitioner =  frappe.db.get_value(self.ref_doctype, self.docname, "ref_practitioner")

	def set_age(self):
		if not self.age:
			dob = frappe.db.get_value("Patient", self.patient, "dob")
			if dob:
				self.age = calculate_age(dob)

	def set_invoice_status(self):
		if self.ref_doctype == "Sales Invoice" and self.docname:
			self.sales_invoice_status = frappe.db.get_value("Sales Invoice", self.docname, "status")


def diagnostic_report_print(diagnostic_report):
	obs_data = get_observation_details(diagnostic_report)[0]
	indiv_html = ""
	comp_html = ""
	for obs in obs_data:
		if not obs.get("has_component"):
			indiv_html += create_individual_html(obs)
		else:
			comp_html += create_component_html(obs)
	return [indiv_html, comp_html]

def create_individual_html(observation_details):
	r_html = ""
	observation_name = ""
	if observation_details.get("template_reference").get("preferred_display_name"):
		observation_name = observation_details.get("template_reference").get("preferred_display_name")
	else:
		observation_name = observation_details.get("observation").get("observation_template")

	if (observation_details.get("observation") or observation_details.get("template_reference")):
		if (observation_details.get("observation").get("result_data") or observation_details.get("observation").get("result_text")
			or observation_details.get("observation").get("result_select") not in [None, "", "Null"]):
			r_html += '''
			<div class="observation-section">
			'''
			r_html +=	f'''
			<div class="observation single-obs">
			<div class="observation-details" style="width: 100%;">
			<div class="obs-field" style="width: 20%;">'''
			if observation_details.get("template_reference").get("sample"):
				r_html +=	f'''<div>
					{observation_details.get("template_reference").get("sample")}
				</div>'''
			if observation_details.get("observation").get("received_time"):
				r_html +=	f'''<div class="text-muted">
					{frappe.utils.format_datetime(observation_details.get("observation").get("received_time"))}
				</div>'''
			r_html += '</div>'

			r_html +=	f'''
			<div class="obs-field" style="width: 30%;">'''
			r_html +=	f'''<div>
				{observation_name}
			</div>'''
			if observation_details.get("template_reference").get("method"):
				r_html +=	f'''<div>
					Method:{observation_details.get("template_reference").get("method")}
				</div>'''
			r_html += '</div>'

			r_html +=	f'''
			<div class="obs-field" style="width: 20%;">'''
			r_html +=	f'''<div style="float:right; padding-right:20px;">
				{observation_details.get("observation").get("result_data") or observation_details.get("observation").get("result_text")
				or observation_details.get("observation").get("result_select")}
			</div><br>'''
			if observation_details.get("observation").get("time_of_result"):
				r_html +=	f'''<div class="text-muted" style="float:left;">
					{frappe.utils.format_datetime(observation_details.get("observation").get("time_of_result"))}
				</div>'''
			r_html += '</div>'

			r_html +=	f'''
			<div class="obs-field" style="width: 10%;">'''
			if observation_details.get("template_reference").get("permitted_unit"):
				r_html +=	f'''<div>
					{observation_details.get("template_reference").get("permitted_unit")}
				</div>'''
			r_html += '</div>'

			r_html +=	f'''
			<div class="obs-field" style="width: 20%;">'''
			if observation_details.get("template_reference").get("display_reference"):
				r_html +=	f'''<div>
					{observation_details.get("template_reference").get("display_reference")}
				</div>'''
			r_html += '</div>'

			r_html +=	f'''
			</div>'''
			if observation_details.get("observation").get("note"):
				r_html +=	f'''
				<div class="note">
					{observation_details.get("observation").get("note")}
				</div>'''
			if observation_details.get("observation").get("description"):
				r_html +=	f'''
				<div class="note">
					{observation_details.get("observation").get("description")}
				</div>'''
			r_html +=	f'''
			</div>
			'''
			r_html += '''
			</div>
			'''
	return r_html



def create_component_html(observation_details):
	r_html = '''
	<div class="observation-section">
	<div class="section-body">
	<div class="observations pr-1">'''
	if observation_details[observation_details.get("observation")] and len(observation_details[observation_details.get("observation")])>0:
		r_html = f'''<div class="grouped-obs">
		<div class="flex" style="padding-bottom: 5px; margin-left:5px;">
			<b>
				{observation_details.get("display_name")}
			</b>
		</div>'''
		for val in observation_details[observation_details.get("observation")]:
			if val.get("observation") or val.get("template_reference"):
				if (val.get("observation").get("result_data") or val.get("observation").get("result_text")
					or val.get("observation").get("result_select") not in [None, "", "Null"]):
					observation_name = ""
					if val.get("template_reference").get("preferred_display_name"):
						observation_name = val.get("template_reference").get("preferred_display_name")
					else:
						observation_name = val.get("observation").get("observation_template")
					r_html +=	f'''
					<div class="observation">
					<div class="observation-details obs-grped" style="width: 100%;">'''

					r_html +=	f'''
					<div class="obs-field" style="width: 20%;">'''
					if val.get("template_reference").get("sample"):
						r_html +=	f'''<div>
							{val.get("template_reference").get("sample")}
						</div>'''
					if val.get("observation").get("received_time"):
						r_html +=	f'''<div class="text-muted">
						{frappe.utils.format_datetime(val.get("observation").get("received_time"))}
						</div>'''
					r_html += '</div>'

					r_html +=	f'''
					<div class="obs-field" style="width: 30%;">'''
					r_html +=	f'''<div>
						{observation_name}
					</div>'''
					if val.get("template_reference").get("method"):
						r_html +=	f'''<div>
							Method:{val.get("template_reference").get("method")}
						</div>'''
					r_html += '</div>'

					r_html +=	f'''
					<div class="obs-field" style="width: 20%;">'''
					r_html +=	f'''<div style="float:right; padding-right:20px;">
						{val.get("observation").get("result_data") or val.get("observation").get("result_text")
						or val.get("observation").get("result_select")}
					</div><br>'''
					if val.get("observation").get("time_of_result"):
						r_html +=	f'''<div class="text-muted" style="float:left";>
							{frappe.utils.format_datetime(val.get("observation").get("time_of_result"))}
						</div>'''
					r_html += '</div>'

					r_html +=	f'''
					<div class="obs-field" style="width: 10%;">'''
					if  val.get("template_reference").get("permitted_unit"):
						r_html +=	f'''<div>
							{val.get("template_reference").get("permitted_unit")}
						</div>'''
					r_html += '</div>'

					r_html +=	f'''
					<div class="obs-field" style="width: 20%;">'''
					if val.get("template_reference").get("display_reference"):
						r_html +=	f'''<div>
							{val.get("template_reference").get("display_reference")}
						</div>'''
					r_html += '</div>'

					r_html +=	f'''
					</div>'''
					if val.get("template_reference").get("note"):
						r_html +=	f'''<div class="note">
							{val.get("observation").get("note")}
						</div>'''
					if not observation_details.get("description") and val.get("observation").get("description"):
						r_html +=	f'''<div class="note">
							{val.get("observation").get("description")}
						</div>'''
					r_html +=	f'''</div>
					'''
		if observation_details.get("description"):
			r_html +=	f'''<div class="note">
				{observation_details.get("description")}
			</div>'''
		r_html += '''
		</div>'''
	r_html += '''
	</div>
	</div>
	</div>
	'''
	return r_html