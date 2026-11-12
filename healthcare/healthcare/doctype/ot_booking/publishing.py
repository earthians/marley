# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import getdate, today

from healthcare.healthcare.doctype.ot_booking.refusal import refusal_text
from healthcare.healthcare.doctype.ot_booking.theatres import get_theatres


@frappe.whitelist(methods=["POST"])
def publish_day(date: str, company: str | None = None, department: str | None = None) -> dict:
	frappe.has_permission("OT Booking", "write", throw=True)
	company = company or frappe.defaults.get_user_default("Company")
	published, failed = for_each_case(day_cases(getdate(date), company, department, ["Tentative"]), publish)
	return {"published": published, "failed": failed}


@frappe.whitelist(methods=["POST"])
def start_over_day(date: str, company: str | None = None, department: str | None = None) -> dict:
	frappe.has_permission("OT Booking", "write", throw=True)
	day = getdate(date)
	if day < getdate(today()):
		frappe.throw(_("Only today or a day to come can be started over"), title=_("Day Has Passed"))
	company = company or frappe.defaults.get_user_default("Company")
	moved, failed = for_each_case(day_cases(day, company, department, ["Tentative"]), reschedule)
	return {"moved": moved, "failed": failed}


def day_cases(date, company, department, statuses):
	theatres = list(get_theatres(company, department))
	if not theatres:
		return []
	filters = {"scheduled_date": date, "status": ["in", statuses], "theatre": ["in", theatres]}
	if company:
		filters["company"] = company
	return frappe.get_list("OT Booking", filters=filters, order_by="scheduled_start", pluck="name", limit=0)


def for_each_case(names, change):
	done, failed = [], []
	for name in names:
		error = change_case(name, change)
		if error:
			patient = frappe.db.get_value("OT Booking", name, "patient_name")
			failed.append({"name": name, "patient_name": patient, "message": error})
		else:
			done.append(name)
	return done, failed


def change_case(name, change):
	savepoint = f"day_{frappe.scrub(name)}"
	messages = len(frappe.local.message_log)
	frappe.db.savepoint(savepoint)
	try:
		change(frappe.get_doc("OT Booking", name))
	except frappe.ValidationError as error:
		frappe.db.rollback(save_point=savepoint)
		return refusal_text(error, messages)
	frappe.db.release_savepoint(savepoint)
	return None


def publish(booking):
	booking.status = "Scheduled"
	booking.save()


def reschedule(booking):
	booking.check_permission("write")
	booking.status = "Postponed"
	booking.save()
