# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt


import frappe
from frappe.utils import flt, getdate, nowdate

from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import (
	create_appointment,
)
from healthcare.healthcare.doctype.therapy_plan.therapy_plan import (
	make_sales_invoice,
	make_therapy_session,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestTherapyPlan(HealthcareTestSuite):
	def test_creation_on_encounter_submission(self):
		patient = frappe.get_list("Patient", pluck="name")[0]
		practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
		medical_department = "_Test Medical Department"
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

		patient = frappe.get_list("Patient", pluck="name")[0]
		practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
		appointment = create_appointment(patient, practitioner, nowdate())

		session = make_therapy_session(
			plan.patient, "Basic Rehab", "_Test Company", plan.name, appointment.name
		)
		session = frappe.get_doc(session)
		session.submit()
		self.assertEqual(frappe.db.get_value("Patient Appointment", appointment.name, "status"), "Closed")
		session.cancel()
		self.assertEqual(frappe.db.get_value("Patient Appointment", appointment.name, "status"), "Open")

	def test_practitioner_from_service_request(self):
		patient = frappe.get_list("Patient", pluck="name")[0]
		practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
		medical_department = "_Test Medical Department"
		encounter = create_encounter(patient, medical_department, practitioner)

		therapy_type = frappe.get_list("Therapy Type", pluck="name")[0]
		service_request = frappe.db.get_value(
			"Service Request", {"template_dn": therapy_type, "order_group": encounter.name}
		)

		# distinct from the Therapy Plan's practitioner, so the assertion can only pass
		# if the session actually resolved it from the Service Request
		sr_practitioner = frappe.get_list(
			"Healthcare Practitioner", filters={"name": ["!=", practitioner]}, pluck="name"
		)[0]
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

	def test_explicit_practitioner_takes_priority(self):
		patient = frappe.get_list("Patient", pluck="name")[0]
		practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
		medical_department = "_Test Medical Department"
		encounter = create_encounter(patient, medical_department, practitioner)

		therapy_type = frappe.get_list("Therapy Type", pluck="name")[0]
		service_request = frappe.db.get_value(
			"Service Request", {"template_dn": therapy_type, "order_group": encounter.name}
		)
		explicit_practitioner = frappe.get_list(
			"Healthcare Practitioner", filters={"name": ["!=", practitioner]}, pluck="name"
		)[0]

		session = make_therapy_session(
			patient,
			therapy_type,
			"_Test Company",
			service_request=service_request,
			practitioner=explicit_practitioner,
		)
		self.assertEqual(session["practitioner"], explicit_practitioner)

	def test_therapy_plan_from_template(self):
		patient = frappe.get_list("Patient", pluck="name")[0]
		template = create_therapy_plan_template()
		# check linked item
		self.assertTrue(frappe.db.exists("Therapy Plan Template", {"linked_item": "Complete Rehab"}))

		plan = create_therapy_plan(template)
		# invoice
		si = make_sales_invoice(plan.name, patient, "_Test Company", template)
		si.save()

		therapy_plan_template_amt = frappe.db.get_value("Therapy Plan Template", template, "total_amount")
		self.assertEqual(si.items[0].amount, therapy_plan_template_amt)


def create_therapy_plan(template=None, patient=None):
	if not patient:
		patient = frappe.get_list("Patient", pluck="name")[0]

	therapy_type = frappe.get_list("Therapy Type", pluck="name")[0]
	practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
	plan = frappe.new_doc("Therapy Plan")
	plan.patient = patient
	plan.start_date = getdate()
	plan.company = "_Test Company"
	plan.practitioner = practitioner
	plan.practitioner_name = frappe.db.get_value("Healthcare Practitioner", practitioner, "practitioner_name")

	if template:
		plan.therapy_plan_template = template
		plan = plan.set_therapy_details_from_template()
	else:
		plan.append("therapy_plan_details", {"therapy_type": therapy_type, "no_of_sessions": 2})

	plan.save()
	return plan


def create_encounter(patient, medical_department, practitioner, submit=True):
	encounter = frappe.new_doc("Patient Encounter")
	encounter.patient = patient
	encounter.practitioner = practitioner
	encounter.medical_department = medical_department
	encounter.appointment_type = frappe.get_list("Appointment Type", pluck="name")[0]
	encounter.source = "Direct"
	therapy_type = frappe.get_list("Therapy Type", pluck="name")[0]
	encounter.append("therapies", {"therapy_type": therapy_type, "no_of_sessions": 2})
	encounter.company = "_Test Company"
	encounter.save()
	if submit:
		encounter.submit()
	return encounter


def create_therapy_plan_template():
	template_name = frappe.db.exists("Therapy Plan Template", "Complete Rehab")
	if not template_name:
		therapy_type = frappe.get_list("Therapy Type", pluck="name")[0]
		template = frappe.new_doc("Therapy Plan Template")
		template.plan_name = template.item_code = template.item_name = "Complete Rehab"
		template.item_group = "Services"
		rate = frappe.db.get_value("Therapy Type", therapy_type, "rate")
		template.append(
			"therapy_types",
			{"therapy_type": therapy_type, "no_of_sessions": 2, "rate": rate, "amount": 2 * flt(rate)},
		)
		template.save()
		template_name = template.name

	return template_name
