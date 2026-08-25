# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from healthcare.healthcare.api.nursing_common import admitted_patients, has_value
from healthcare.healthcare.api.nursing_tasks import OPEN_TASK_STATUSES
from healthcare.healthcare.api.vitals import vital_sign_templates

# Documents whose number a nurse might scan or type to reach a patient.
PATIENT_DOCUMENTS = (
	"Inpatient Record",
	"Emergency Record",
	"Patient Encounter",
	"Clinical Procedure",
	"Therapy Session",
	"Patient Appointment",
)

# Each source document names its doctor differently.
PRACTITIONER_FIELDS = (
	"practitioner",
	"primary_practitioner",
	"attending_practitioner",
	"triage_practitioner",
)


class PatientSnapshot:
	"""The read-only panel a nurse keeps open while recording."""

	def __init__(self, patient, limit=10):
		self.patient = patient
		self.limit = limit

	def as_dict(self):
		return {
			"vitals": self.vitals(),
			"medications": self.medications(),
			"care_plan": self.care_plan(),
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

	def care_plan(self):
		from healthcare.healthcare.api.nursing_care_plan import get_care_plan

		return get_care_plan(self.patient)

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
			# an F-DAR entry leaves `note` empty, so its parts come back too
			fields=[
				"name",
				"note",
				"clinical_note_type",
				"posting_date",
				"practitioner",
				"fdar_focus",
				"fdar_data",
				"fdar_action",
				"fdar_response",
			],
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


@frappe.whitelist()
def find_patients(term, admitted_only=0):
	return PatientFinder(term, int(admitted_only)).find()


@frappe.whitelist()
def get_banner(patient, reference_doctype=None, reference_name=None):
	return PatientBanner(patient, reference_doctype, reference_name).as_dict()


@frappe.whitelist()
def get_snapshot(patient, limit=10):
	return PatientSnapshot(patient, int(limit)).as_dict()
