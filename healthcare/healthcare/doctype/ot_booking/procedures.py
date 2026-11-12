# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from healthcare.healthcare.doctype.clinical_procedure.clinical_procedure import set_stock_items
from healthcare.healthcare.doctype.ot_booking.busy import INACTIVE_STATUSES
from healthcare.healthcare.doctype.ot_booking.procedure_status import (
	in_place,
	procedures_of,
	rows_with_start,
	schedule,
)
from healthcare.healthcare.doctype.service_request.service_request import make_clinical_procedure

ACTIVE_REQUEST_STATUS = "active-Request Status"
WITH_PROCEDURES = ("Scheduled", "In Progress", "Completed")


def create_procedures(booking):
	held = procedures_of(booking)
	made = []
	for row, start in rows_with_start(booking):
		if row.name not in held:
			procedure = new_procedure(booking, row, start)
			procedure.insert()
			made.append(procedure.name)
	return made


def validate_procedures_held(booking):
	if booking.is_new():
		return
	held = procedures_of(booking)
	if not held:
		return
	validate_patient_kept(booking, held)
	rows = {row.name: row for row in booking.procedures}
	for row_name, procedure in held.items():
		validate_row_kept(rows.get(row_name), procedure)
	validate_submitted_kept(booking, held)


def validate_patient_kept(booking, held):
	if booking.has_value_changed("patient"):
		frappe.throw(
			_("Clinical Procedure {0} is made for this case, so its patient cannot change").format(
				frappe.bold(next(iter(held.values())).name)
			),
			title=_("Procedure Made"),
		)


def validate_row_kept(row, procedure):
	if not row:
		frappe.throw(
			_("Clinical Procedure {0} is made for a row, so the row cannot be removed").format(
				frappe.bold(procedure.name)
			)
		)
	same_request = (row.service_request or None) == (procedure.service_request or None)
	if row.procedure_template != procedure.procedure_template or not same_request:
		frappe.throw(
			_("Row {0}: its Clinical Procedure is made, so its procedure cannot change").format(row.idx)
		)


def validate_submitted_kept(booking, held):
	submitted = [procedure for procedure in held.values() if procedure.docstatus == 1]
	if submitted and is_stopping(booking):
		refuse_submitted(submitted[0], _("so this case cannot be {0}").format(_(booking.status)))
	for row, start in rows_with_start(booking):
		procedure = held.get(row.name)
		if procedure and procedure.docstatus == 1 and not in_place(procedure, schedule(booking, row, start)):
			refuse_submitted(procedure, _("so its theatre, times and surgeon cannot change"))


def refuse_submitted(procedure, consequence):
	frappe.throw(
		_("Clinical Procedure {0} is already submitted, {1}").format(
			frappe.bold(procedure.name), consequence
		),
		title=_("Procedure Submitted"),
	)


def update_procedures(booking):
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
