# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import now_datetime

from healthcare.healthcare.api.medication import get_due_medications
from healthcare.healthcare.api.nursing_common import default_company
from healthcare.healthcare.api.nursing_tasks import get_nursing_tasks

SBAR_PARTS = ("situation", "background", "assessment", "recommendation")

# A handover nobody has taken yet is still the live one for that patient.
PENDING_STATUS = "Handed Over"
RECENT_HANDOVERS = 5


class HandoverRecorder:
	"""A handover names who is taking over, so it is more than a note."""

	def __init__(self, patient, reference_doctype=None, reference_name=None):
		self.patient = patient
		self.reference_doctype = reference_doctype
		self.reference_name = reference_name

	def record(self, values):
		document = frappe.get_doc(
			{
				"doctype": "Shift Handover",
				"patient": self.patient,
				"handover_time": now_datetime(),
				"reference_doctype": self.reference_doctype,
				"reference_name": self.reference_name,
				"inpatient_record": frappe.db.get_value("Patient", self.patient, "inpatient_record"),
				"company": default_company(),
				**values,
			}
		)
		document.insert(ignore_permissions=True)
		return document.name


@frappe.whitelist()
def get_outstanding(patient):
	"""What the next nurse is inheriting, gathered rather than retyped."""
	tasks = get_nursing_tasks(patient)
	doses = [dose for dose in get_due_medications(patient) if dose.status != "Given"]

	return {
		"tasks": [
			{"label": task.activity or task.name, "when": task.requested_start_time, "status": task.status}
			for task in tasks
		],
		"medications": [
			{
				"label": f"{dose.drug_name or dose.drug_code} {dose.dosage or ''}".strip(),
				"when": dose.scheduled_time,
				"status": dose.status,
			}
			for dose in doses
		],
	}


@frappe.whitelist()
def record_handover(patient, values, reference_doctype=None, reference_name=None):
	if isinstance(values, str):
		values = frappe.parse_json(values)

	# The same two the form marks: everything else is optional detail.
	missing = [
		label
		for field, label in (("handed_over_to", _("Handed Over To")), ("situation", _("Situation")))
		if not str(values.get(field) or "").strip()
	]
	if missing:
		frappe.throw(_("Fill in {0}").format(", ".join(missing)))

	waiting = pending_handover(patient)
	if waiting:
		frappe.throw(
			_("A handover for this patient is already waiting on {0}").format(
				frappe.bold(waiting.handed_over_to)
			)
		)

	fields = ("handed_over_to", "from_shift", "to_shift", *SBAR_PARTS)
	written = {field: values.get(field) for field in fields}
	return HandoverRecorder(patient, reference_doctype, reference_name).record(written)


def pending_handover(patient):
	"""One patient, one live handover: a queue of them helps nobody."""
	waiting = frappe.get_all(
		"Shift Handover",
		filters={"patient": patient, "status": PENDING_STATUS, "docstatus": ["<", 2]},
		fields=["name", "handed_over_to"],
		order_by="handover_time desc",
		limit=1,
	)
	return waiting[0] if waiting else None


@frappe.whitelist()
def is_handover_waiting(patient):
	"""Whether this nurse has a handover to take on this patient."""
	waiting = pending_handover(patient)
	return bool(waiting and waiting.handed_over_to == frappe.session.user)


@frappe.whitelist()
def get_handovers(patient, limit=RECENT_HANDOVERS):
	return frappe.get_all(
		"Shift Handover",
		filters={"patient": patient, "docstatus": ["<", 2]},
		fields=[
			"name",
			"handover_time",
			"handed_over_by",
			"handed_over_to",
			"status",
			"situation",
			"accepted_at",
		],
		order_by="handover_time desc",
		limit=limit,
	)


@frappe.whitelist()
def accept_handover(handover):
	"""Only the nurse it was handed to can accept it."""
	document = frappe.get_doc("Shift Handover", handover)

	if document.handed_over_to != frappe.session.user:
		frappe.throw(_("This handover was given to {0}").format(document.handed_over_to))

	document.status = "Accepted"
	document.save(ignore_permissions=True)
	return document.status
