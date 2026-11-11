# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""The ward's nil-by-mouth Nursing Task for a Scheduled case whose procedures need fasting.
It starts the longest fasting time any of them needs before the case, follows the case when
it moves, and goes when the case is no longer Scheduled. Fasting counts as confirmed while the
current task is Completed. That is read when needed, never written from the task: the ward's
save locks the task first, while a booking's own saves lock the booking first and then its
task, so writing the booking from the task could deadlock. The task is the system's, so it is
made and cancelled without the user's own Nursing Task permissions."""

import frappe
from frappe import _
from frappe.utils import add_to_date, flt, format_time, get_datetime

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import ot_setting

# a missed task is cancelled with the open ones, so an old one never stays on the worklist
OPEN_TASK_STATUSES = ("Requested", "Received", "Accepted", "Ready", "In Progress", "On Hold", "Missed")


def sync_fasting_task(booking):
	"""A task the case no longer needs is cancelled even when new ones are switched off, so
	clearing the Fasting Activity never leaves an old task on the ward's worklist"""
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
	"""The longest fasting any of the case's procedures needs, or 0 when none needs it. A
	procedure with no hours of its own takes the Operation Theatre default."""
	templates = frappe.get_all(
		"Clinical Procedure Template",
		fields=["requires_fasting", "fasting_hours"],
		filters={"name": ["in", procedure_templates]},
	)
	default = flt(ot_setting("ot_fasting_hours"))
	return max((flt(row.fasting_hours) or default for row in templates if row.requires_fasting), default=0)


def is_fasting_confirmed(booking, procedure_templates):
	"""Whether the ward completed the task for the case's current fasting window, never an old
	one. `booking` needs its name and scheduled_start."""
	task = current_task(booking.name)
	if not task or task.status != "Completed":
		return False
	return not out_of_date(task, booking, fasting_hours(procedure_templates))


def current_task(booking):
	"""The booking's latest fasting task that was not cancelled"""
	return frappe.db.get_value(
		"Nursing Task",
		{"reference_doctype": "OT Booking", "reference_name": booking, "status": ["!=", "Cancelled"]},
		["name", "status", "patient", "requested_end_time", "duration"],
		as_dict=True,
		order_by="creation desc",
	)


def out_of_date(task, booking, hours):
	"""Whether the task no longer asks for the fasting the case now needs: the case moved, its
	procedures now need a different number of hours, or it names another patient. It is matched on
	its end and duration, not its start: a task made after its fasting should have begun has its
	start moved to now."""
	case_start = get_datetime(booking.scheduled_start)
	return (
		get_datetime(task.requested_end_time) != case_start
		or flt(task.duration) != hours * 3600
		or (booking.get("patient") and task.patient != booking.patient)
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
