# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _
from frappe.utils import add_to_date, now_datetime

import erpnext

VITAL_SIGNS_CATEGORY = "Vital Signs"
IN_HOSPITAL_STATUSES = ("Admitted", "Discharge Scheduled")

# Documents whose number a nurse might scan or type to reach a patient.
PATIENT_DOCUMENTS = (
	"Inpatient Record",
	"Emergency Record",
	"Patient Encounter",
	"Clinical Procedure",
	"Therapy Session",
	"Patient Appointment",
)
OPEN_TASK_STATUSES = ("Requested", "Received", "Accepted", "Ready", "In Progress")

# Each source document names its doctor differently.
PRACTITIONER_FIELDS = (
	"practitioner",
	"primary_practitioner",
	"attending_practitioner",
	"triage_practitioner",
)


class VitalsRecorder:
	"""Records vital sign readings as Observations of category Vital Signs."""

	def __init__(self, patient, reference_doctype=None, reference_name=None, practitioner=None):
		self.patient = patient
		self.reference_doctype = reference_doctype
		self.reference_name = reference_name
		self.practitioner = practitioner
		self.company = default_company()

	def record(self, readings):
		"""Takes {observation_template: value} and returns the observations created."""
		return [
			self.record_reading(template, value) for template, value in readings.items() if has_value(value)
		]

	def record_reading(self, template, value):
		observation = frappe.new_doc("Observation")
		observation.update(self.observation_defaults(template))
		self.set_result(observation, value)
		observation.insert(ignore_permissions=True)
		return observation.name

	def observation_defaults(self, template):
		return {
			"patient": self.patient,
			"observation_template": template,
			"reference_doctype": self.reference_doctype,
			"reference_docname": self.reference_name,
			"healthcare_practitioner": self.practitioner,
			"company": self.company,
			"result_datetime": now_datetime(),
		}

	def set_result(self, observation, value):
		data_type = observation.permitted_data_type or "Quantity"
		if data_type == "Text":
			observation.result_text = value
		else:
			observation.result_data = str(value)


class PatientSnapshot:
	"""The read-only panel a nurse keeps open while recording."""

	def __init__(self, patient, limit=10):
		self.patient = patient
		self.limit = limit

	def as_dict(self):
		return {
			"vitals": self.vitals(),
			"medications": self.medications(),
			"missed_medications": self.missed_medications(),
			"next_tasks": self.next_tasks(),
			"last_note": self.last_note(),
		}

	def vitals(self):
		"""Last `limit` readings per vital sign template, oldest first."""
		return [self.vital_entry(template) for template in vital_sign_templates()]

	def vital_entry(self, template):
		return {
			"template": template.name,
			"label": template.observation or template.name,
			"abbr": template.abbr,
			"unit": template.permitted_unit,
			"readings": self.readings_for(template.name),
		}

	def readings_for(self, template):
		readings = frappe.get_all(
			"Observation",
			filters={"patient": self.patient, "observation_template": template, "docstatus": ["<", 2]},
			fields=["result_data as value", "result_datetime as recorded_at"],
			order_by="result_datetime desc, creation desc",
			limit=self.limit,
		)
		return list(reversed([reading for reading in readings if has_value(reading.value)]))

	def medications(self):
		"""Doses still waiting on the same round the medication pane shows."""
		from healthcare.healthcare.api.medication import doses_on_the_round

		return doses_on_the_round(self.patient, statuses=["Scheduled"], limit=5)

	def missed_medications(self):
		from healthcare.healthcare.api.medication import missed_doses

		return missed_doses(self.patient)

	def next_tasks(self):
		return frappe.get_all(
			"Nursing Task",
			filters={"patient": self.patient, "status": ["in", OPEN_TASK_STATUSES], "docstatus": ["<", 2]},
			fields=["name", "activity", "description", "status", "requested_start_time"],
			order_by="requested_start_time asc",
			limit=5,
		)

	def last_note(self):
		notes = frappe.get_all(
			"Clinical Note",
			filters={"patient": self.patient, "docstatus": ["<", 2]},
			fields=["name", "note", "clinical_note_type", "posting_date", "practitioner"],
			order_by="posting_date desc, creation desc",
			limit=1,
		)
		return notes[0] if notes else None


class PatientBanner:
	"""Who the nurse is looking at, and where they are."""

	def __init__(self, patient, reference_doctype=None, reference_name=None):
		self.patient = frappe.get_doc("Patient", patient)
		self.reference_doctype = reference_doctype
		self.reference_name = reference_name

	def as_dict(self):
		return {
			"patient": self.patient.name,
			"patient_name": self.patient.patient_name,
			"gender": self.patient.sex,
			"age": self.age(),
			"blood_group": self.patient.blood_group,
			"allergies": self.patient.allergies,
			"identifier": self.patient.uid,
			"practitioner": self.practitioner(),
			"location": self.location(),
		}

	def age(self):
		"""Short form for a banner chip: years, or months and days for infants."""
		age = self.patient.calculate_age()
		if not age:
			return None

		days = age.get("age_in_days") or 0
		years = days // 365
		if years:
			return f"{years} Y"

		months = days // 30
		return f"{months} M" if months else f"{days} D"

	def practitioner(self):
		"""The doctor named on the source document."""
		if not self.reference_doctype or not self.reference_name:
			return None

		meta = frappe.get_meta(self.reference_doctype)
		for fieldname in PRACTITIONER_FIELDS:
			if not meta.has_field(fieldname):
				continue

			practitioner = frappe.db.get_value(self.reference_doctype, self.reference_name, fieldname)
			if practitioner:
				return (
					frappe.db.get_value("Healthcare Practitioner", practitioner, "practitioner_name")
					or practitioner
				)

		return None

	def location(self):
		"""Bed and ward, when the source document is an admission."""
		if self.reference_doctype != "Inpatient Record" or not self.reference_name:
			return None

		record = frappe.get_doc("Inpatient Record", self.reference_name)
		occupancy = [row for row in record.inpatient_occupancies if not row.left]
		return {
			"service_unit": occupancy[-1].service_unit if occupancy else None,
			"status": record.status,
		}


class IntakeOutputRecorder:
	"""Records intake and output rows, one Intake Output Entry each."""

	def __init__(self, patient, reference_doctype=None, reference_name=None, practitioner=None):
		self.patient = patient
		self.reference_doctype = reference_doctype
		self.reference_name = reference_name
		self.practitioner = practitioner
		self.company = default_company()

	def record(self, entries):
		return [self.record_entry(entry) for entry in entries]

	def record_entry(self, entry):
		document = frappe.new_doc("Intake Output Entry")
		document.update(
			{
				"patient": self.patient,
				"intake_output_type": entry.get("intake_output_type"),
				"volume": entry.get("volume"),
				"description": entry.get("description"),
				"recorded_at": entry.get("recorded_at") or now_datetime(),
				"reference_doctype": self.reference_doctype,
				"reference_name": self.reference_name,
				"practitioner": self.practitioner,
				"company": self.company,
			}
		)
		document.insert(ignore_permissions=True)
		return document.name


class IntakeOutputSummary:
	"""Totals and rows for the last `hours` of intake and output."""

	def __init__(self, patient, hours=24):
		self.patient = patient
		self.hours = hours

	def as_dict(self):
		entries = self.entries()
		intake = self.total(entries, "Intake")
		output = self.total(entries, "Output")
		return {
			"entries": entries,
			"intake": intake,
			"output": output,
			"balance": intake - output,
			"hours": self.hours,
		}

	def entries(self):
		return frappe.get_all(
			"Intake Output Entry",
			filters={
				"patient": self.patient,
				"docstatus": ["<", 2],
				"recorded_at": [">", add_to_date(now_datetime(), hours=-self.hours)],
			},
			fields=[
				"name",
				"intake_output_type",
				"direction",
				"volume",
				"uom",
				"description",
				"recorded_at",
			],
			order_by="recorded_at desc",
		)

	def total(self, entries, direction):
		return sum(entry.volume or 0 for entry in entries if entry.direction == direction)


class PatientFinder:
	"""Resolves a scanned wristband, a record number, or a typed term to patients."""

	FIELDS = ("name", "uid", "patient_name", "mobile")

	def __init__(self, term, admitted_only=False):
		self.term = (term or "").strip()
		self.admitted_only = admitted_only

	def find(self):
		if not self.term:
			frappe.throw(_("Scan a wristband or type a patient to search"))

		# A record number identifies one patient exactly, so those come first.
		matches = self.by_document() + self.by_patient()
		return self.deduplicate(matches)

	def by_document(self):
		matches = []
		for doctype in PATIENT_DOCUMENTS:
			patient = self.patient_on(doctype)
			if not patient:
				continue

			matches.append(
				{
					"name": patient,
					"patient_name": frappe.db.get_value("Patient", patient, "patient_name"),
					"matched_via": doctype,
					"reference_doctype": doctype,
					"reference_name": self.term,
				}
			)
		return matches

	def patient_on(self, doctype):
		if not frappe.db.exists(doctype, self.term):
			return None

		return frappe.db.get_value(doctype, self.term, "patient")

	def by_patient(self):
		return frappe.get_all(
			"Patient",
			or_filters=[[field, "like", f"%{self.term}%"] for field in self.FIELDS],
			filters=self.filters(),
			fields=["name", "patient_name"],
			order_by="patient_name asc",
			limit=20,
		)

	def deduplicate(self, matches):
		seen = set()
		unique = []
		for match in matches:
			if match["name"] in seen:
				continue

			seen.add(match["name"])
			unique.append(match)
		return unique

	def filters(self):
		if not self.admitted_only:
			return {}

		return {"name": ["in", admitted_patients()]}


def admitted_patients():
	"""A patient pending discharge is still in a bed and still needs nursing care."""
	return frappe.get_all(
		"Inpatient Record",
		filters={"status": ["in", IN_HOSPITAL_STATUSES]},
		pluck="patient",
	)


def vital_sign_templates():
	"""Observation Templates seeded under the Vital Signs category."""
	return frappe.get_all(
		"Observation Template",
		filters={"observation_category": VITAL_SIGNS_CATEGORY},
		fields=["name", "observation", "abbr", "permitted_data_type", "permitted_unit"],
		order_by="creation asc",
	)


def has_value(value):
	return value is not None and str(value).strip() != ""


def default_company():
	company = frappe.defaults.get_user_default("Company") or erpnext.get_default_company()
	if company:
		return company

	companies = frappe.get_all("Company", pluck="name", limit=1)
	return companies[0] if companies else None


@frappe.whitelist()
def get_vital_sign_templates():
	return vital_sign_templates()


@frappe.whitelist()
def find_patients(term, admitted_only=0):
	return PatientFinder(term, int(admitted_only)).find()


@frappe.whitelist()
def get_banner(patient, reference_doctype=None, reference_name=None):
	return PatientBanner(patient, reference_doctype, reference_name).as_dict()


@frappe.whitelist()
def get_intake_output_types():
	return frappe.get_all(
		"Intake Output Type",
		filters={"disabled": 0},
		fields=["name", "direction", "default_uom"],
		order_by="direction asc, name asc",
	)


@frappe.whitelist()
def get_intake_output_summary(patient, hours=24):
	return IntakeOutputSummary(patient, int(hours)).as_dict()


@frappe.whitelist()
def record_intake_output(patient, entries, reference_doctype=None, reference_name=None, practitioner=None):
	if isinstance(entries, str):
		entries = json.loads(entries)

	if not entries:
		frappe.throw(_("Add at least one row"))

	recorder = IntakeOutputRecorder(patient, reference_doctype, reference_name, practitioner)
	return recorder.record(entries)


@frappe.whitelist()
def get_snapshot(patient, limit=10):
	return PatientSnapshot(patient, int(limit)).as_dict()


@frappe.whitelist()
def record_vitals(patient, readings, reference_doctype=None, reference_name=None, practitioner=None):
	if isinstance(readings, str):
		readings = json.loads(readings)

	if not readings:
		frappe.throw(_("Enter at least one reading"))

	recorder = VitalsRecorder(patient, reference_doctype, reference_name, practitioner)
	return recorder.record(readings)
