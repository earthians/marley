# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _
from frappe.utils import add_to_date, now_datetime

from healthcare.healthcare.api.nursing_common import default_company


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
