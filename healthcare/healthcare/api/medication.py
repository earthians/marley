# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import add_to_date, get_datetime, getdate, now_datetime

from healthcare.healthcare.doctype.patient_encounter.patient_encounter import (
	get_prescription_dates,
)

# Used when the setting has never been saved. A Single doctype does not write
# its declared default until the form is saved once, and a null there would
# otherwise read as zero minutes, hiding a dose until the moment it is due.
DEFAULT_LEAD_TIME_MINUTES = 30

# How far back a run will reach. Without a floor, switching the setting on
# would materialise every dose since each order began; with one, a missed
# scheduler run is still caught up within a shift.
BACKFILL_HOURS = 12


class MedicationScheduleSettings:
	"""When a scheduled dose becomes a record a nurse can act on."""

	def __init__(self):
		self.settings = frappe.get_cached_doc("Healthcare Settings")

	@property
	def enabled(self):
		return bool(self.settings.auto_schedule_medication_doses)

	@property
	def lead_time_minutes(self):
		return int(self.settings.medication_dose_lead_time or DEFAULT_LEAD_TIME_MINUTES)


class MedicationSchedule:
	"""Doses falling due for a patient between two moments."""

	def __init__(self, patient, until, since=None):
		self.patient = patient
		self.until = get_datetime(until)
		self.since = get_datetime(since) if since else None

	def due(self):
		return self.from_inpatient_orders() + self.from_medication_requests()

	def in_window(self, scheduled_time):
		if scheduled_time > self.until:
			return False

		return self.since is None or scheduled_time >= self.since

	# ---- inpatient order sheet ----

	def from_inpatient_orders(self):
		orders = frappe.get_all(
			"Inpatient Medication Order",
			filters={"patient": self.patient, "docstatus": 1},
			fields=["name", "inpatient_record", "practitioner", "company"],
		)
		return [dose for order in orders for dose in self.doses_on(order)]

	def doses_on(self, order):
		entries = frappe.get_all(
			"Inpatient Medication Order Entry",
			filters={"parent": order.name, "is_completed": 0},
			fields=["name", "drug", "drug_name", "dosage", "dosage_form", "date", "time"],
		)

		doses = []
		for entry in entries:
			scheduled_time = get_datetime(f"{entry.date} {entry.time}")
			if not self.in_window(scheduled_time):
				continue

			doses.append(
				{
					"drug_code": entry.drug,
					"drug_name": entry.drug_name,
					"dosage": entry.dosage,
					"dosage_form": entry.dosage_form,
					"scheduled_time": scheduled_time,
					"order_doctype": "Inpatient Medication Order",
					"order_name": order.name,
					"order_entry": entry.name,
					"inpatient_record": order.inpatient_record,
					"practitioner": order.practitioner,
					"company": order.company,
				}
			)
		return doses

	# ---- standalone medication requests ----

	def from_medication_requests(self):
		requests = frappe.get_all(
			"Medication Request",
			filters={"patient": self.patient, "docstatus": ["<", 2]},
			fields=[
				"name",
				"medication",
				"medication_item",
				"dosage",
				"dosage_form",
				"period",
				"order_date",
				"practitioner",
				"company",
				"inpatient_record",
			],
		)
		return [dose for request in requests for dose in self.doses_for(request)]

	def doses_for(self, request):
		if not (request.medication_item and request.dosage and request.period):
			return []

		strengths = frappe.get_all(
			"Dosage Strength",
			filters={"parent": request.dosage},
			fields=["strength", "strength_time"],
		)
		dates = get_prescription_dates(request.period, request.order_date)

		doses = []
		for date in dates:
			for strength in strengths:
				scheduled_time = get_datetime(f"{getdate(date)} {strength.strength_time}")
				if not self.in_window(scheduled_time):
					continue

				doses.append(
					{
						"drug_code": request.medication_item,
						"medication": request.medication,
						"dosage": strength.strength,
						"dosage_form": request.dosage_form,
						"scheduled_time": scheduled_time,
						"order_doctype": "Medication Request",
						"order_name": request.name,
						"inpatient_record": request.inpatient_record,
						"practitioner": request.practitioner,
						"company": request.company,
					}
				)
		return doses


class MedicationScheduler:
	"""Turns due doses into Medication Administration records."""

	def __init__(self, patient, settings=None):
		self.patient = patient
		self.settings = settings or MedicationScheduleSettings()

	def build(self, until=None):
		if not self.settings.enabled:
			return []

		until = until or add_to_date(now_datetime(), minutes=self.settings.lead_time_minutes)
		since = add_to_date(now_datetime(), hours=-BACKFILL_HOURS)
		doses = MedicationSchedule(self.patient, until, since).due()
		return [name for name in map(self.record_dose, doses) if name]

	def record_dose(self, dose):
		"""The unique dose key means a dose described by two orders lands once."""
		if frappe.db.exists("Medication Administration", {"dose_key": self.dose_key(dose)}):
			return None

		administration = frappe.get_doc(
			{"doctype": "Medication Administration", "patient": self.patient, **dose}
		)
		administration.insert(ignore_permissions=True)
		return administration.name

	def dose_key(self, dose):
		return f"{self.patient}::{dose['drug_code']}::{dose['scheduled_time']}"


@frappe.whitelist()
def schedule_due_medications(patient=None):
	"""Called by the scheduler for every patient, and by the pane for one."""
	settings = MedicationScheduleSettings()
	if not settings.enabled:
		return []

	patients = [patient] if patient else patients_with_open_orders()
	return [name for one in patients for name in MedicationScheduler(one, settings).build()]


def patients_with_open_orders():
	return list(
		set(
			frappe.get_all("Inpatient Medication Order", filters={"docstatus": 1}, pluck="patient")
			+ frappe.get_all("Medication Request", filters={"docstatus": ["<", 2]}, pluck="patient")
		)
	)


@frappe.whitelist()
def get_due_medications(patient, hours=12):
	"""Doses to show on the round: everything still open, plus what was just done."""
	schedule_due_medications(patient)

	return frappe.get_all(
		"Medication Administration",
		filters={
			"patient": patient,
			"scheduled_time": [">", add_to_date(now_datetime(), hours=-int(hours))],
		},
		fields=[
			"name",
			"drug_code",
			"drug_name",
			"dosage",
			"dosage_form",
			"route",
			"scheduled_time",
			"administered_time",
			"status",
			"reason",
		],
		order_by="scheduled_time asc",
	)


@frappe.whitelist()
def record_administration(administration, status, reason=None, route=None, second_check_by=None):
	dose = frappe.get_doc("Medication Administration", administration)
	dose.status = status
	dose.reason = reason
	if route:
		dose.route = route
	if second_check_by:
		dose.second_check_by = second_check_by
	dose.save(ignore_permissions=True)
	return dose.name
