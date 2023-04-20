# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
import json
from frappe import _, msgprint
from frappe.model.document import Document

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


@frappe.whitelist()
def get_service_requests(date):
	filters = [
		["order_date", "=", date],
	]
	return frappe.get_list("Service Request", fields="*", filters=filters)


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
	frappe.db.set_value("Procedure Schedules", sched.name, "appointment_reference", appointment.name)


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
		