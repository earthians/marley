# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import now_datetime

from healthcare.healthcare.api.nursing_common import default_company

FDAR_PARTS = ("fdar_focus", "fdar_data", "fdar_action", "fdar_response")
RECENT_NOTES = 10


class ClinicalNoteRecorder:
	"""Writes a nursing note against the document it was opened from."""

	def __init__(self, patient, reference_doctype=None, reference_name=None, practitioner=None):
		self.patient = patient
		self.reference_doctype = reference_doctype
		self.reference_name = reference_name
		self.practitioner = practitioner

	def record(self, note_type, values):
		document = frappe.get_doc(
			{
				"doctype": "Clinical Note",
				"patient": self.patient,
				"clinical_note_type": note_type,
				"reference_doc": self.reference_doctype,
				"reference_name": self.reference_name,
				"practitioner": self.practitioner,
				"user": frappe.session.user,
				"posting_date": now_datetime(),
				**values,
			}
		)
		document.insert(ignore_permissions=True)
		return document.name


@frappe.whitelist()
def get_note_types():
	"""The types a site actually uses. Seeded ones are only defaults: add your
	own, or disable what you do not want, without touching code."""
	return frappe.get_all(
		"Clinical Note Type",
		filters={"disabled": 0},
		fields=["name", "is_fdar"],
		order_by="name asc",
	)


@frappe.whitelist()
def record_note(
	patient, values, note_type=None, reference_doctype=None, reference_name=None, practitioner=None
):
	"""The type decides the note's shape: F-DAR keeps its four parts, anything
	else is written as free text."""
	if isinstance(values, str):
		values = frappe.parse_json(values)

	if not note_type:
		frappe.throw(_("Choose a note type"))

	fields = FDAR_PARTS if is_fdar_type(note_type) else ("note",)
	written = {field: values.get(field) for field in fields}

	if not any(str(value or "").strip() for value in written.values()):
		frappe.throw(_("Write the note before saving"))

	recorder = ClinicalNoteRecorder(patient, reference_doctype, reference_name, practitioner)
	return recorder.record(note_type, written)


def is_fdar_type(note_type):
	return bool(frappe.db.get_value("Clinical Note Type", note_type, "is_fdar"))


@frappe.whitelist()
def get_recent_notes(patient, limit=RECENT_NOTES, note_types=None):
	filters = {"patient": patient, "docstatus": ["<", 2]}
	if note_types:
		filters["clinical_note_type"] = ["in", note_types]

	return frappe.get_all(
		"Clinical Note",
		filters=filters,
		fields=[
			"name",
			"clinical_note_type",
			"posting_date",
			"user",
			"note",
			*FDAR_PARTS,
		],
		order_by="posting_date desc, creation desc",
		limit=limit,
	)
