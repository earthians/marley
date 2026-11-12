# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_to_date, cint, getdate

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import ot_setting
from healthcare.healthcare.doctype.ot_booking.availability import validate_availability
from healthcare.healthcare.doctype.ot_booking.busy import INACTIVE_STATUSES
from healthcare.healthcare.doctype.ot_booking.day_rules import log_change_reason, validate_day_rules
from healthcare.healthcare.doctype.ot_booking.fasting import is_fasting_confirmed, sync_fasting_task
from healthcare.healthcare.doctype.ot_booking.priority import set_priority
from healthcare.healthcare.doctype.ot_booking.procedure_status import procedures_of
from healthcare.healthcare.doctype.ot_booking.procedures import (
	create_procedures,
	update_procedures,
	validate_procedures_held,
)
from healthcare.healthcare.doctype.ot_booking.same_patient import warn_other_cases

STATUS_CHANGES = {
	"Tentative": ("Scheduled", "Postponed", "Cancelled"),
	"Scheduled": ("Tentative", "In Progress", "Postponed", "Cancelled"),
	# cancelling a started case is refused while it has a submitted procedure (procedures.py)
	"In Progress": ("Completed", "Cancelled"),
	"Postponed": ("Tentative", "Cancelled"),
}
NEW_STATUSES = ("Tentative", "Scheduled")
ACTIVE_REQUEST_STATUS = "active-Request Status"
A_DAY = 24 * 60 * 60


class OTBooking(Document):
	@property
	def fasting_confirmed(self):
		return is_fasting_confirmed(self, [row.procedure_template for row in self.procedures])

	def onload(self):
		self.set_onload("procedures_to_create", len(self.procedures) - len(procedures_of(self)))

	def validate(self):
		self.patient_name = frappe.db.get_value("Patient", self.patient, "patient_name")
		set_priority(self)
		self.validate_status_change()
		self.set_procedure_rows()
		self.set_schedule()
		self.validate_theatre()
		self.validate_procedures()
		self.validate_service_requests()
		self.validate_inpatient_record()
		self.validate_primary_surgeon()
		validate_day_rules(self)
		validate_procedures_held(self)
		validate_availability(self)

	def on_update(self):
		update_procedures(self)
		sync_fasting_task(self)
		log_change_reason(self)
		warn_other_cases(self)

	@frappe.whitelist()
	def create_clinical_procedures(self):
		# from the saved booking, not from edits the form has not saved yet
		saved = frappe.get_doc(self.doctype, self.name)
		saved.check_permission("write")
		frappe.has_permission("Clinical Procedure", "create", throw=True)
		if saved.status in (*INACTIVE_STATUSES, "Completed"):
			frappe.throw(_("Procedures cannot be created for a {0} case").format(_(saved.status)))
		return create_procedures(saved)

	def validate_status_change(self):
		before = self.get_doc_before_save()
		if not before:
			if self.status not in NEW_STATUSES:
				frappe.throw(_("A new case cannot be {0}").format(_(self.status)), title=_("Not Allowed"))
		elif self.status != before.status and self.status not in STATUS_CHANGES.get(before.status, ()):
			frappe.throw(
				_("A {0} case cannot become {1}").format(_(before.status), _(self.status)),
				title=_("Not Allowed"),
			)

	def set_procedure_rows(self):
		for row in self.procedures:
			if row.service_request:
				row.procedure_template = frappe.db.get_value(
					"Service Request", row.service_request, "template_dn"
				)
			row.duration = row.duration or template_duration(row.procedure_template)
			if cint(row.duration) <= 0:
				frappe.throw(
					_("Row {0}: the duration of {1} must be greater than zero").format(
						row.idx, frappe.bold(row.procedure_template)
					)
				)

	def set_schedule(self):
		length = sum(cint(row.duration) for row in self.procedures)
		if length >= A_DAY:
			frappe.throw(_("A case must take less than 24 hours"), title=_("Case Too Long"))
		self.scheduled_date = getdate(self.scheduled_start)
		self.scheduled_end = add_to_date(self.scheduled_start, seconds=length)
		if self.cleaning_minutes in (None, ""):
			self.cleaning_minutes = cint(ot_setting("ot_cleaning_minutes"))

	def validate_theatre(self):
		is_ot, company = frappe.db.get_value("Healthcare Service Unit", self.theatre, ["is_ot", "company"])
		if not is_ot:
			frappe.throw(_("{0} is not an operation theatre").format(frappe.bold(self.theatre)))
		if company != self.company:
			frappe.throw(
				_("Theatre {0} belongs to {1}, not to {2}").format(
					frappe.bold(self.theatre), frappe.bold(company), frappe.bold(self.company)
				)
			)

	def validate_procedures(self):
		theatre_type = frappe.db.get_value("Healthcare Service Unit", self.theatre, "service_unit_type")
		for row in self.procedures:
			requires_ot, required_type = frappe.db.get_value(
				"Clinical Procedure Template",
				row.procedure_template,
				["requires_ot", "required_theatre_type"],
			)
			template = frappe.bold(row.procedure_template)
			if not requires_ot:
				refuse_row(row, _("{0} does not require an operation theatre").format(template))
			if required_type and required_type != theatre_type:
				refuse_row(row, _("{0} needs a {1} theatre").format(template, frappe.bold(required_type)))

	def validate_service_requests(self):
		before = self.get_doc_before_save()
		attached = {row.name: row.service_request for row in before.procedures} if before else {}
		requests = [row.service_request for row in self.procedures if row.service_request]
		for row in self.procedures:
			if row.service_request:
				newly_attached = attached.get(row.name) != row.service_request
				self.validate_service_request(row, newly_attached, requests.count(row.service_request) > 1)

	def validate_service_request(self, row, newly_attached, repeated):
		request_name = frappe.bold(row.service_request)
		if repeated:
			refuse_row(row, _("Service Request {0} is already in this booking").format(request_name))
		request = request_details(row.service_request)
		if newly_attached:
			validate_open_surgical_request(request)
		if request.patient != self.patient:
			refuse_row(row, _("Service Request {0} is for another patient").format(request_name))
		other = find_active_booking(row.service_request, exclude=self.name)
		if other:
			message = _("Service Request {0} is already booked in {1}")
			refuse_row(row, message.format(request_name, frappe.bold(other)))

	def validate_inpatient_record(self):
		if not self.inpatient_record:
			return
		if frappe.db.get_value("Inpatient Record", self.inpatient_record, "patient") != self.patient:
			frappe.throw(
				_("Inpatient Record {0} is not this patient's admission").format(
					frappe.bold(self.inpatient_record)
				),
				title=_("Another Patient's Admission"),
			)

	def validate_primary_surgeon(self):
		primary = [member for member in self.team if member.is_primary]
		if len(primary) != 1:
			frappe.throw(_("Mark exactly one team member as the primary surgeon"))
		if primary[0].role != "Surgeon":
			frappe.throw(_("The primary team member must have the role Surgeon"))


def refuse_row(row, message):
	frappe.throw(_("Row {0}: {1}").format(row.idx, message))


@frappe.whitelist()
def make_ot_booking(service_request: str) -> Document:
	frappe.has_permission("Service Request", "read", service_request, throw=True)
	frappe.has_permission("OT Booking", "create", throw=True)
	request = frappe.get_doc("Service Request", service_request)
	validate_open_surgical_request(request)
	booking = find_active_booking(request.name)
	if booking:
		frappe.throw(
			_("Service Request {0} is already booked in {1}").format(
				frappe.bold(request.name), frappe.bold(booking)
			)
		)
	surgeon = request.referred_to_practitioner or request.practitioner
	return frappe.get_doc(
		{
			"doctype": "OT Booking",
			"patient": request.patient,
			"company": request.company,
			"inpatient_record": request.inpatient_record,
			"priority": request.priority,
			"procedures": [
				{
					"service_request": request.name,
					"procedure_template": request.template_dn,
					"duration": template_duration(request.template_dn),
				}
			],
			"team": [{"practitioner": surgeon, "role": "Surgeon", "is_primary": 1}],
		}
	)


def request_details(service_request):
	fields = ["name", "patient", "template_dt", "template_dn", "docstatus", "status"]
	return frappe.db.get_value("Service Request", service_request, fields, as_dict=True)


def validate_open_surgical_request(request):
	is_surgical = request.template_dt == "Clinical Procedure Template" and frappe.db.get_value(
		"Clinical Procedure Template", request.template_dn, "requires_ot"
	)
	if not is_surgical:
		frappe.throw(
			_("Service Request {0} is not for a procedure that requires an operation theatre").format(
				frappe.bold(request.name)
			)
		)
	if request.docstatus != 1 or request.status != ACTIVE_REQUEST_STATUS:
		frappe.throw(_("Service Request {0} is not active").format(frappe.bold(request.name)))


def find_active_booking(service_request, exclude=None):
	booking = frappe.qb.DocType("OT Booking")
	row = frappe.qb.DocType("OT Booking Procedure")
	found = (
		frappe.qb.from_(row)
		.join(booking)
		.on(booking.name == row.parent)
		.select(booking.name)
		.where(row.parenttype == "OT Booking")
		.where(row.service_request == service_request)
		.where(booking.status != "Cancelled")
		.where(booking.name != (exclude or ""))
		.limit(1)
	).run()
	return found[0][0] if found else None


def template_duration(template):
	return frappe.db.get_value("Clinical Procedure Template", template, "default_duration")


def on_doctype_update():
	frappe.db.add_index("OT Booking", ["theatre", "scheduled_date"])
