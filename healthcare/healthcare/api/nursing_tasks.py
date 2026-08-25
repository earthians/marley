# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_to_date, now_datetime

OPEN_TASK_STATUSES = ("Requested", "Received", "Accepted", "Ready", "In Progress")

# Waiting on someone, so still lapsable. A task in progress or on hold is not:
# somebody has it in hand, or has deliberately parked it.
LAPSABLE_TASK_STATUSES = ("Requested", "Received", "Accepted", "Ready")

# How long a task may sit past its start time before it counts as missed.
TASK_LAPSE_HOURS = 12


def lapse_missed_tasks(patient=None):
	"""A task nobody picked up was missed. Record that rather than leaving it
	sitting on the worklist as though it were still due."""
	filters = {
		"status": ["in", LAPSABLE_TASK_STATUSES],
		"docstatus": 1,
		"requested_start_time": ["<", add_to_date(now_datetime(), hours=-TASK_LAPSE_HOURS)],
	}
	if patient:
		filters["patient"] = patient

	missed = frappe.get_all("Nursing Task", filters=filters, pluck="name")
	for name in missed:
		frappe.db.set_value("Nursing Task", name, "status", "Missed")

	return missed


@frappe.whitelist()
def get_nursing_tasks(patient, hours=24):
	"""The worklist: what is still outstanding, plus anything that fell over
	this shift. A completed task is done with, so it drops off."""
	lapse_missed_tasks(patient)
	since = add_to_date(now_datetime(), hours=-int(hours))

	return frappe.get_all(
		"Nursing Task",
		filters={"patient": patient, "docstatus": ["<", 2], "status": ["!=", "Completed"]},
		or_filters=[
			["status", "in", ("Draft", "Missed", *OPEN_TASK_STATUSES)],
			["requested_start_time", ">", since],
		],
		fields=[
			"name",
			"activity",
			"description",
			"status",
			"docstatus",
			"requested_start_time",
			"task_start_time",
			"mandatory",
		],
		order_by="requested_start_time asc",
	)


@frappe.whitelist()
def update_nursing_task(task, status):
	"""Moves a task along its own workflow; the controller stamps the times."""
	document = frappe.get_doc("Nursing Task", task)
	document.status = status
	document.save(ignore_permissions=True)
	return document.status
