# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import add_to_date, flt, format_time, get_datetime

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import ot_setting

OPEN_TASK_STATUSES = ("Requested", "Received", "Accepted", "Ready", "In Progress", "On Hold", "Missed")


def sync_fasting_task(booking):
	task = current_task(booking.name)
	hours = fasting_hours([row.procedure_template for row in booking.procedures])
	if booking.status != "Scheduled" or not hours:
		return cancel_if_open(task)
	if task and not out_of_date(task, booking, hours):
		return
	cancel_if_open(task)
	activity = ot_setting("ot_fasting_activity")
	if activity:
		create_task(booking, activity, hours)


def fasting_hours(procedure_templates):
	templates = frappe.get_all(
		"Clinical Procedure Template",
		fields=["requires_fasting", "fasting_hours"],
		filters={"name": ["in", procedure_templates]},
	)
	default = flt(ot_setting("ot_fasting_hours"))
	return max((flt(row.fasting_hours) or default for row in templates if row.requires_fasting), default=0)


def is_fasting_confirmed(booking, procedure_templates):
	# read from the task, never written back from it: the ward's save locks the task first and a
	# booking's save locks the booking first, so a write-back could deadlock
	task = current_task(booking.name)
	if not task or task.status != "Completed":
		return False
	return not out_of_date(task, booking, fasting_hours(procedure_templates))


def current_task(booking):
	return frappe.db.get_value(
		"Nursing Task",
		{"reference_doctype": "OT Booking", "reference_name": booking, "status": ["!=", "Cancelled"]},
		["name", "status", "patient", "requested_end_time", "duration"],
		as_dict=True,
		order_by="creation desc",
	)


def out_of_date(task, booking, hours):
	case_start = get_datetime(booking.scheduled_start)
	return (
		get_datetime(task.requested_end_time) != case_start
		or flt(task.duration) != hours * 3600
		or task.patient != booking.patient
	)


def cancel_if_open(task):
	if not task or task.status not in OPEN_TASK_STATUSES:
		return
	nursing_task = frappe.get_doc("Nursing Task", task.name)
	nursing_task.flags.ignore_permissions = True
	nursing_task.cancel()


def create_task(booking, activity, hours):
	start = get_datetime(booking.scheduled_start)
	frappe.get_doc(
		{
			"doctype": "Nursing Task",
			"status": "Requested",
			"activity": activity,
			"reference_doctype": "OT Booking",
			"reference_name": booking.name,
			"patient": booking.patient,
			"company": booking.company,
			"service_unit": current_bed(booking),
			"requested_start_time": add_to_date(start, hours=-hours),
			"requested_end_time": start,
			"duration": hours * 3600,
			"description": _("Nil by mouth from {0}, for the case at {1} in {2}").format(
				format_time(add_to_date(start, hours=-hours)), format_time(start), booking.theatre
			),
		}
	).insert(ignore_permissions=True)


def current_bed(booking):
	if not booking.inpatient_record:
		return None
	return frappe.db.get_value(
		"Inpatient Occupancy", {"parent": booking.inpatient_record, "left": 0}, "service_unit"
	)
