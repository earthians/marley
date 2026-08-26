# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import add_to_date, get_datetime, now_datetime

# Used when the setting has never been saved. A Single doctype does not write
# its declared default until the form is saved once, and a null there would
# otherwise read as zero minutes, hiding a dose until the moment it is due.
DEFAULT_LEAD_TIME_MINUTES = 30

# An admission in any other state still has the patient on a ward.
CLOSED_ADMISSION_STATUSES = ("Discharged", "Cancelled")

# The round a nurse is working: how far back the pane and the snapshot look.
ROUND_WINDOW_HOURS = 12

# A dose that was given is done with. The exceptions stay in view, because a
# held or refused dose is something the next nurse needs to know about.
ROUND_STATUSES = ("Scheduled", "Held", "Refused", "Not Available")

# A missed dose falls outside the round by definition, but it is the exception
# that most needs attention, so it stays visible for a day.
MISSED_LOOKBACK_HOURS = 24

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
	"""Doses falling due for a patient between two moments.

	Only inpatient orders are scheduled: administration is a ward activity, and
	an outpatient takes their own medication.
	"""

	def __init__(self, patient, until, since=None):
		self.patient = patient
		self.until = get_datetime(until)
		self.since = get_datetime(since) if since else None

	def due(self):
		return self.from_inpatient_orders()

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
		return [dose for order in orders if self.on_the_ward(order) for dose in self.doses_on(order)]

	def on_the_ward(self, order):
		"""Doses are given at the bedside, so the admission has to be open."""
		status = frappe.db.get_value("Inpatient Record", order.inpatient_record, "status")
		return bool(status) and status not in CLOSED_ADMISSION_STATUSES

	def doses_on(self, order):
		entries = frappe.get_all(
			"Inpatient Medication Order Entry",
			# Inpatient Medication Entry sets the status when it moves the stock;
			# a drug that has not reached the ward cannot be administered.
			filters={"parent": order.name, "status": ["in", ["Transferred", "Completed"]]},
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


def lapse_missed_doses(patient=None):
	"""A dose still waiting once it leaves the round was never given. Mark it
	so, rather than letting it drop out of sight as though it never existed."""
	filters = {
		"status": "Scheduled",
		"scheduled_time": ["<", add_to_date(now_datetime(), hours=-ROUND_WINDOW_HOURS)],
	}
	if patient:
		filters["patient"] = patient

	missed = frappe.get_all("Medication Administration", filters=filters, pluck="name")
	for name in missed:
		frappe.db.set_value("Medication Administration", name, "status", "Missed")

	return missed


@frappe.whitelist()
def schedule_due_medications(patient=None):
	"""Called by the scheduler for every patient, and by the pane for one."""
	settings = MedicationScheduleSettings()
	if not settings.enabled:
		return []

	lapse_missed_doses(patient)

	patients = [patient] if patient else patients_with_open_orders()
	return [name for one in patients for name in MedicationScheduler(one, settings).build()]


def patients_with_open_orders():
	return list(set(frappe.get_all("Inpatient Medication Order", filters={"docstatus": 1}, pluck="patient")))


def doses_on_the_round(patient, hours=ROUND_WINDOW_HOURS, statuses=None, limit=None):
	"""One definition of the round, so the pane and the snapshot agree."""
	filters = {
		"patient": patient,
		"scheduled_time": [">", add_to_date(now_datetime(), hours=-int(hours))],
	}
	if statuses:
		filters["status"] = ["in", statuses]

	return frappe.get_all(
		"Medication Administration",
		filters=filters,
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
		limit=limit,
	)


@frappe.whitelist()
def get_due_medications(patient, hours=ROUND_WINDOW_HOURS):
	"""The round, plus any dose recently missed so it is not quietly forgotten."""
	schedule_due_medications(patient)

	doses = doses_on_the_round(patient, hours, statuses=ROUND_STATUSES) + missed_doses(patient)
	return sorted(doses, key=lambda dose: dose.scheduled_time)


def missed_doses(patient, hours=MISSED_LOOKBACK_HOURS):
	return doses_on_the_round(patient, hours, statuses=["Missed"])


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
