# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
import json
from frappe import _, msgprint
from frappe.model.document import Document
from frappe.utils import get_datetime, get_weekday, get_time

from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import create_appointment


class OTSchedule(Document):
	def on_submit(self):
		if self.procedure_schedules:
			for sched in self.procedure_schedules:
				if not sched.appointment_reference:
					create_appointment(self, sched)
			msgprint(_("Appointment Booked"),alert=True,)

	def on_update_after_submit(self):
		if self.procedure_schedules:
			for sched in self.procedure_schedules:
				if not sched.appointment_reference:
					create_appointment(self, sched)
				else:
					update_appointment(sched)
			msgprint(_("Appointment Updated"),alert=True,)

	def validate(self):
		validate_practitioner_schedule(self)

@frappe.whitelist()
def get_service_requests(date):
	filters = [
		["order_date", "=", date],
	]
	# return frappe.get_list("Service Request", fields="*", filters=filters)


@frappe.whitelist()
def set_procedure_schedule(service_requests):
	service_requests = json.loads(service_requests)
	return_list = []
	for serv in service_requests:
		service_request_doc = frappe.get_doc("Service Request", serv)
		return_dict = {
			"practitioner": service_request_doc.referred_to_practitioner if service_request_doc.referred_to_practitioner else service_request_doc.practitioner,
			"patient": service_request_doc.patient,
			"clinical_procedure_template": service_request_doc.template_dn,
			"total_duration": frappe.db.get_value('Clinical Procedure Template', service_request_doc.template_dn, 'total_duration'),
			"service_request": serv,
		}
		return_list.append(return_dict)
	return return_list


def create_appointment(self, sched):
	appointment = frappe.new_doc("Patient Appointment")
	appointment.patient = sched.patient
	appointment.practitioner = sched.practitioner
	appointment.procedure_template = sched.clinical_procedure_template
	appointment.department = self.medical_department
	appointment.appointment_date = self.schedule_date
	appointment.service_unit = self.healthcare_service_unit
	appointment.company = self.company
	appointment.duration = sched.duration
	appointment.appointment_time = sched.from_time
	appointment.save(ignore_permissions=True)
	if sched.service_request:
		appointment.service_request = sched.service_request
		frappe.db.set_value("Service Request", sched.service_request, "status", "OT Scheduled")
	frappe.db.set_value("Procedure Schedule", sched.name, "appointment_reference", appointment.name)


def update_appointment(sched):
	appointment_doc = frappe.get_doc("Patient Appointment", sched.appointment_reference)
	changed = False
	if appointment_doc.appointment_time != sched.from_time:
		changed = True
	if appointment_doc.duration != sched.duration:
		changed = True
	if appointment_doc.procedure_template != sched.clinical_procedure_template:
		changed = True
	if appointment_doc.patient != sched.patient:
		changed = True
	if appointment_doc.practitioner != sched.practitioner:
		changed = True
	if changed:
		appointment_doc.appointment_time = sched.from_time
		appointment_doc.duration = sched.duration
		appointment_doc.procedure_template = sched.clinical_procedure_template
		appointment_doc.patient = sched.patient
		appointment_doc.practitioner = sched.practitioner
		appointment_doc.flags.ignore_validate = True
		appointment_doc.save(ignore_permissions=True)
		appointment_doc.flags.ignore_validate = False


def validate_practitioner_schedule(self):
	validate = False
	pract_list = []
	if self.procedure_schedules:
		for sched in self.procedure_schedules:
			pract_schedules = frappe.get_all(
				"Practitioner Service Unit Schedule",
				filters={"parent": sched.practitioner},
				pluck="schedule", as_list=False
			)
			weekday = get_weekday(get_datetime(self.schedule_date))
			pract_sched_data = frappe.db.sql("""
					SELECT
						min(from_time) as from_time,
						max(to_time) as to_time
					FROM
						`tabHealthcare Schedule Time Slot`
					WHERE
						parent in ({pract_schedules}) AND day = {weekday}
					GROUP BY
						day
				"""
				.format(
					pract_schedules=",".join(["%s"] * len(pract_schedules)),
					weekday=frappe.db.escape(weekday),
				), tuple(pract_schedules), as_dict=True
			)
			if pract_sched_data[0] and get_time(pract_sched_data[0].get("from_time")) > get_time(sched.get("from_time")):
				validate = True
			if pract_sched_data[0] and get_time(pract_sched_data[0].get("to_time")) < get_time(sched.get("to_time")):
				validate = True
			if validate:
				pract_list.append(sched.get("practitioner"))
	if validate:
		frappe.throw(_("Practitioners {0} not available in the OT schedule time").format(pract_list), title=_("Not Available"))
