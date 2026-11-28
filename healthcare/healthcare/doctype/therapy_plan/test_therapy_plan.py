# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt


import frappe
<<<<<<< HEAD
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, getdate, nowdate
=======
from frappe.utils import flt, nowdate, nowtime
>>>>>>> 55bdb19 (fix(therapy-plan): skip service request lookup for therapy plans without order group)

from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import (
	create_appointment,
	create_healthcare_docs,
	create_medical_department,
	create_patient,
)
from healthcare.healthcare.doctype.therapy_plan.therapy_plan import (
	make_sales_invoice,
	make_therapy_session,
)
from healthcare.healthcare.doctype.therapy_type.test_therapy_type import create_therapy_type


class TestTherapyPlan(FrappeTestCase):
	def test_creation_on_encounter_submission(self):
		patient, practitioner = create_healthcare_docs()
		medical_department = create_medical_department()
		encounter = create_encounter(patient, medical_department, practitioner)
		self.assertTrue(
			frappe.db.exists(
				"Therapy Plan", {"source_doc": "Patient Encounter", "order_group": encounter.name}
			)
		)

	def test_status(self):
		plan = create_therapy_plan()
		self.assertEqual(plan.status, "Not Started")

		session = make_therapy_session(plan.patient, "Basic Rehab", "_Test Company", plan.name)
		frappe.get_doc(session).submit()
		self.assertEqual(frappe.db.get_value("Therapy Plan", plan.name, "status"), "In Progress")

		session = make_therapy_session(plan.patient, "Basic Rehab", "_Test Company", plan.name)
		frappe.get_doc(session).submit()
		self.assertEqual(frappe.db.get_value("Therapy Plan", plan.name, "status"), "Completed")

		patient, practitioner = create_healthcare_docs()
		appointment = create_appointment(patient, practitioner, nowdate())

		session = make_therapy_session(
			plan.patient, "Basic Rehab", "_Test Company", plan.name, appointment.name
		)
		session = frappe.get_doc(session)
		session.submit()
		self.assertEqual(
			frappe.db.get_value("Patient Appointment", appointment.name, "status"), "Closed"
		)
		session.cancel()
		self.assertEqual(frappe.db.get_value("Patient Appointment", appointment.name, "status"), "Open")

<<<<<<< HEAD
=======
	def test_practitioner_from_service_request(self):
		patient = "_Test Patient"
		practitioner = "_Test Healthcare Practitioner 2"
		medical_department = "_Test Medical Department"
		encounter = create_encounter_with_therapy(patient, medical_department, practitioner)

		therapy_type = "Basic Rehab"
		service_request = frappe.db.get_value(
			"Service Request", {"template_dn": therapy_type, "order_group": encounter.name}
		)

		# distinct from the Therapy Plan's practitioner, so the assertion can only pass
		# if the session actually resolved it from the Service Request
		sr_practitioner = "_Test Healthcare Practitioner 1"
		frappe.db.set_value("Service Request", service_request, "practitioner", sr_practitioner)

		session = make_therapy_session(
			patient, therapy_type, "_Test Company", service_request=service_request
		)
		self.assertEqual(session["practitioner"], sr_practitioner)

	def test_practitioner_from_therapy_plan(self):
		plan = create_therapy_plan()
		therapy_type = "Basic Rehab"

		# confirm there really is no Service Request to fall back to first, so the
		# assertion below actually exercises the Therapy Plan branch
		self.assertFalse(
			frappe.db.exists(
				"Service Request", {"template_dn": therapy_type, "order_group": plan.order_group}
			)
		)

		session = make_therapy_session(plan.patient, therapy_type, "_Test Company", plan.name)
		self.assertEqual(session["practitioner"], plan.practitioner)

	def test_manual_plan_does_not_link_another_patients_service_request(self):
		plan = create_therapy_plan()
		therapy_type = plan.therapy_plan_details[0].therapy_type
		service_request = frappe.get_doc(
			{
				"doctype": "Service Request",
				"patient": "_Test Patient 1",
				"company": plan.company,
				"practitioner": plan.practitioner,
				"order_date": nowdate(),
				"order_time": nowtime(),
				"template_dt": "Therapy Type",
				"template_dn": therapy_type,
				"quantity": 1,
				"billing_status": "Invoiced",
			}
		).insert()
		service_request.submit()
		self.assertFalse(plan.order_group)
		self.assertFalse(service_request.order_group)
		self.assertNotEqual(service_request.patient, plan.patient)
		self.assertTrue(
			frappe.db.exists(
				"Service Request", {"template_dn": therapy_type, "order_group": plan.order_group}
			)
		)

		session = make_therapy_session(plan.patient, therapy_type, plan.company, plan.name)

		self.assertFalse(session["service_request"])
		self.assertEqual(session["patient"], plan.patient)
		self.assertEqual(session["therapy_plan"], plan.name)

	def test_explicit_practitioner_takes_priority(self):
		patient = "_Test Patient"
		practitioner = "_Test Healthcare Practitioner 2"
		medical_department = "_Test Medical Department"
		encounter = create_encounter_with_therapy(patient, medical_department, practitioner)

		therapy_type = "Basic Rehab"
		service_request = frappe.db.get_value(
			"Service Request", {"template_dn": therapy_type, "order_group": encounter.name}
		)
		explicit_practitioner = "_Test Healthcare Practitioner 1"

		session = make_therapy_session(
			patient,
			therapy_type,
			"_Test Company",
			service_request=service_request,
			practitioner=explicit_practitioner,
		)
		self.assertEqual(session["practitioner"], explicit_practitioner)

>>>>>>> 55bdb19 (fix(therapy-plan): skip service request lookup for therapy plans without order group)
	def test_therapy_plan_from_template(self):
		patient = create_patient()
		template = create_therapy_plan_template()
		# check linked item
		self.assertTrue(frappe.db.exists("Therapy Plan Template", {"linked_item": "Complete Rehab"}))

		plan = create_therapy_plan(template)
		# invoice
		si = make_sales_invoice(plan.name, patient, "_Test Company", template)
		si.save()

		therapy_plan_template_amt = frappe.db.get_value(
			"Therapy Plan Template", template, "total_amount"
		)
		self.assertEqual(si.items[0].amount, therapy_plan_template_amt)


def create_therapy_plan(template=None, patient=None):
	if not patient:
		patient = create_patient()
	therapy_type = create_therapy_type()
	practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
	plan = frappe.new_doc("Therapy Plan")
	plan.patient = patient
	plan.start_date = getdate()
	plan.practitioner = practitioner
	plan.practitioner_name = frappe.db.get_value(
		"Healthcare Practitioner", practitioner, "practitioner_name"
	)

	if template:
		plan.therapy_plan_template = template
		plan = plan.set_therapy_details_from_template()
	else:
		plan.append("therapy_plan_details", {"therapy_type": therapy_type.name, "no_of_sessions": 2})

	plan.save()
	return plan


def create_encounter(patient, medical_department, practitioner):
	encounter = frappe.new_doc("Patient Encounter")
	encounter.patient = patient
	encounter.practitioner = practitioner
	encounter.medical_department = medical_department
	therapy_type = create_therapy_type()
	encounter.append("therapies", {"therapy_type": therapy_type.name, "no_of_sessions": 2})
	encounter.save()
	encounter.submit()
	return encounter


def create_therapy_plan_template():
	template_name = frappe.db.exists("Therapy Plan Template", "Complete Rehab")
	if not template_name:
		therapy_type = create_therapy_type()
		template = frappe.new_doc("Therapy Plan Template")
		template.plan_name = template.item_code = template.item_name = "Complete Rehab"
		template.item_group = "Services"
		rate = frappe.db.get_value("Therapy Type", therapy_type.name, "rate")
		template.append(
			"therapy_types",
			{"therapy_type": therapy_type.name, "no_of_sessions": 2, "rate": rate, "amount": 2 * flt(rate)},
		)
		template.save()
		template_name = template.name

	return template_name
