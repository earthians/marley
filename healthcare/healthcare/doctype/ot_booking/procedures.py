# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

"""A case's Clinical Procedures: one per procedure row, one after the other in the booked slot.
Each records its booking and row, and the booking reads them from there. A cancelled one no
longer counts, so its row can have a new one and the case can move or stop. A draft follows the
case when it moves and goes when the case stops. A submitted one keeps the theatre, times and
surgeon it was submitted with, so the case cannot change them, nor stop, while it stands."""

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, get_datetime, get_time, getdate

from healthcare.healthcare.doctype.clinical_procedure.clinical_procedure import set_stock_items
from healthcare.healthcare.doctype.ot_booking.busy import INACTIVE_STATUSES
from healthcare.healthcare.doctype.ot_booking.procedure_status import procedures_of
from healthcare.healthcare.doctype.service_request.service_request import make_clinical_procedure

ACTIVE_REQUEST_STATUS = "active-Request Status"
# a case in these statuses has its clinical work: a procedure for each row
WITH_PROCEDURES = ("Scheduled", "In Progress", "Completed")


def create_procedures(booking):
	"""A procedure for each row that has none yet; the names of those made"""
	held = procedures_of(booking)
	made = []
	for row, start in rows_with_start(booking):
		if row.name not in held:
			procedure = new_procedure(booking, row, start)
			procedure.insert()
			made.append(procedure.name)
	return made


def validate_procedures_held(booking):
	"""A row whose procedure is made keeps its procedure and stays; a submitted procedure keeps its
	theatre, times and surgeon, and stops the case from being cancelled or postponed"""
	if booking.is_new():
		return
	held = procedures_of(booking)
	rows = {row.name: row for row in booking.procedures}
	for row_name, procedure in held.items():
		validate_row_kept(rows.get(row_name), procedure)
	submitted = [procedure for procedure in held.values() if procedure.docstatus == 1]
	if submitted and is_stopping(booking):
		refuse_submitted(submitted[0], _("so this case cannot be {0}").format(_(booking.status)))
	for row, start in rows_with_start(booking):
		procedure = held.get(row.name)
		if procedure and procedure.docstatus == 1 and moved(procedure, schedule(booking, row, start)):
			refuse_submitted(procedure, _("so its theatre, times and surgeon cannot change"))


def validate_row_kept(row, procedure):
	if not row:
		frappe.throw(
			_("Clinical Procedure {0} is made for a row, so the row cannot be removed").format(
				frappe.bold(procedure.name)
			)
		)
	if row.procedure_template != procedure.procedure_template or (row.service_request or None) != (
		procedure.service_request or None
	):
		frappe.throw(
			_("Row {0}: its Clinical Procedure is made, so its procedure cannot change").format(row.idx)
		)


def refuse_submitted(procedure, consequence):
	frappe.throw(
		_("Clinical Procedure {0} is already submitted, {1}").format(
			frappe.bold(procedure.name), consequence
		),
		title=_("Procedure Submitted"),
	)


def moved(procedure, planned):
	"""Whether the case would give a procedure another theatre, time or surgeon than it holds"""
	return place_of(procedure) != place_of(frappe._dict(planned))


def place_of(procedure):
	start = get_datetime(f"{procedure.start_date} {procedure.start_time}")
	end = get_datetime(procedure.planned_end_datetime)
	return procedure.service_unit, start, end, procedure.practitioner


def update_procedures(booking):
	"""After a save: a case that stopped gives up its drafts; otherwise the drafts follow it, and a
	Scheduled, started or completed case gets a procedure for each row that has none yet"""
	held = procedures_of(booking)
	if is_stopping(booking):
		for procedure in held.values():
			frappe.delete_doc("Clinical Procedure", procedure.name, ignore_permissions=True)
		return
	for row, start in rows_with_start(booking):
		procedure = held.get(row.name)
		if procedure and procedure.docstatus == 0:
			frappe.db.set_value("Clinical Procedure", procedure.name, schedule(booking, row, start))
	if booking.status in WITH_PROCEDURES:
		create_procedures(booking)


def is_stopping(booking):
	before = booking.get_doc_before_save()
	return booking.status in INACTIVE_STATUSES and bool(before) and before.status not in INACTIVE_STATUSES


def rows_with_start(booking):
	start = get_datetime(booking.scheduled_start)
	for row in booking.procedures:
		yield row, start
		start = add_to_date(start, seconds=cint(row.duration))


def new_procedure(booking, row, start):
	if row.service_request:
		validate_request_active(row)
		procedure = make_clinical_procedure(row.service_request)
	else:
		procedure = procedure_from_template(booking, row.procedure_template)
	procedure.update(schedule(booking, row, start))
	procedure.update(
		{
			"ot_booking": booking.name,
			"ot_booking_row": row.name,
			"priority": booking.priority,
			"inpatient_record": booking.inpatient_record or procedure.inpatient_record,
		}
	)
	procedure.patient_name, procedure.patient_sex = frappe.db.get_value(
		"Patient", booking.patient, ["patient_name", "sex"]
	)
	return procedure


def validate_request_active(row):
	"""A request put on hold or revoked since it was booked makes no clinical work"""
	if frappe.db.get_value("Service Request", row.service_request, "status") != ACTIVE_REQUEST_STATUS:
		frappe.throw(
			_("Row {0}: Service Request {1} is no longer active, so no procedure is made for it").format(
				row.idx, frappe.bold(row.service_request)
			),
			title=_("Request Not Active"),
		)


def procedure_from_template(booking, template):
	procedure = frappe.new_doc("Clinical Procedure")
	procedure.update({"procedure_template": template, "patient": booking.patient, "company": booking.company})
	procedure.consume_stock = frappe.db.get_value("Clinical Procedure Template", template, "consume_stock")
	if procedure.consume_stock:
		set_stock_items(procedure, template, "Clinical Procedure Template")
	return procedure


def schedule(booking, row, start):
	"""What the case gives the row's procedure: its theatre and the theatre's store, its slot in
	the case, and the primary surgeon with their name (fetched only in the browser otherwise)"""
	surgeon = next((member.practitioner for member in booking.team if member.is_primary), None)
	return {
		"service_unit": booking.theatre,
		"warehouse": theatre_warehouse(booking),
		"start_date": getdate(start),
		"start_time": get_time(start),
		"planned_end_datetime": add_to_date(start, seconds=cint(row.duration)),
		"practitioner": surgeon,
		"practitioner_name": surgeon
		and frappe.db.get_value("Healthcare Practitioner", surgeon, "practitioner_name", cache=True),
	}


def theatre_warehouse(booking):
	"""The theatre's own store for the supplies, else the company's"""
	return frappe.db.get_value("Healthcare Service Unit", booking.theatre, "warehouse") or (
		frappe.db.get_value("Company", booking.company, "default_warehouse")
	)
