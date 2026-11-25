# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt


import frappe
from frappe.utils import flt, nowdate, nowtime

from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import (
	create_appointment,
)
from healthcare.healthcare.doctype.therapy_plan.therapy_plan import (
	make_sales_invoice,
	make_therapy_session,
)
from healthcare.tests.factories.encounters import create_encounter_with_therapy, create_therapy_plan
from healthcare.tests.utils import HealthcareTestSuite


class TestTherapyPlan(HealthcareTestSuite):
	def test_creation_on_encounter_submission(self):
		patient = "_Test Patient"
		practitioner = "_Test Healthcare Practitioner 2"
		medical_department = "_Test Medical Department"
		encounter = create_encounter_with_therapy(patient, medical_department, practitioner)
		self.assertTrue(
			frappe.db.exists(
				"Therapy Plan", {"source_doc": "Patient Encounter", "order_group": encounter.name}
			)
		)

	def test_creation_on_encounter_order_save(self):
		patient = "_Test Patient"
		practitioner = "_Test Healthcare Practitioner 2"
		encounter = create_encounter_with_therapy(
			patient, "_Test Medical Department", practitioner, submit=False
		)
		filters = {"source_doc": encounter.doctype, "order_group": encounter.name}
		self.assertFalse(frappe.db.exists("Therapy Plan", filters))

		encounter.submit_orders_on_save = 1
		encounter.save()
		self.assertEqual(encounter.docstatus, 0)
		plan = frappe.get_doc("Therapy Plan", filters)
		service_request = encounter.therapies[0].service_request
		self.assertTrue(service_request)
		session = make_therapy_session(
			patient, encounter.therapies[0].therapy_type, encounter.company, service_request=service_request
		)
		self.assertEqual(session["therapy_plan"], plan.name)

		# Adding another therapy must retain the original row and session progress.
		original_row = plan.therapy_plan_details[0]
		original_row.sessions_completed = 1
		plan.save()
		therapy_name = "_Test Later Therapy"
		later_therapy = frappe.get_doc(
			{
				"doctype": "Therapy Type",
				"therapy_type": therapy_name,
				"item_code": therapy_name,
				"item_name": therapy_name,
				"item_group": "Services",
				"rate": 0,
			}
		).insert()
		encounter.append("therapies", {"therapy_type": later_therapy.name, "no_of_sessions": 3})

		for submit in (False, True):
			if submit:
				encounter.submit()
			else:
				encounter.save()
			self.assertEqual(frappe.db.count("Therapy Plan", filters), 1)
			self.assertEqual(encounter.therapies[0].service_request, service_request)
			self.assertTrue(encounter.therapies[1].service_request)
			plan.reload()
			rows = {row.therapy_type: row for row in plan.therapy_plan_details}
			self.assertEqual(len(plan.therapy_plan_details), 2)
			self.assertEqual(set(rows), {original_row.therapy_type, later_therapy.name})
			self.assertEqual(rows[original_row.therapy_type].name, original_row.name)
			self.assertEqual(rows[original_row.therapy_type].no_of_sessions, 2)
			self.assertEqual(rows[original_row.therapy_type].sessions_completed, 1)
			self.assertEqual(rows[later_therapy.name].no_of_sessions, 3)
			self.assertEqual(rows[later_therapy.name].sessions_completed, 0)
			self.assertEqual(plan.total_sessions, 5)
			self.assertEqual(plan.total_sessions_completed, 1)
			self.assertEqual(plan.status, "In Progress")

	def test_additional_order_for_same_therapy_counts_sessions(self):
		patient = "_Test Patient"
		practitioner = "_Test Healthcare Practitioner 2"
		encounter = create_encounter_with_therapy(
			patient, "_Test Medical Department", practitioner, submit=False
		)
		encounter.submit_orders_on_save = 1
		encounter.save()
		filters = {"source_doc": encounter.doctype, "order_group": encounter.name}
		plan = frappe.get_doc("Therapy Plan", filters)
		plan.therapy_plan_details[0].sessions_completed = 2
		plan.save()
		self.assertEqual(plan.status, "Completed")

		encounter.append(
			"therapies", {"therapy_type": encounter.therapies[0].therapy_type, "no_of_sessions": 3}
		)
		encounter.save()
		self.assertNotEqual(encounter.therapies[0].service_request, encounter.therapies[1].service_request)
		for submit in (False, True):
			if submit:
				encounter.submit()
			else:
				encounter.save()
			plan.reload()
			self.assertEqual(frappe.db.count("Therapy Plan", filters), 1)
			self.assertEqual(len(plan.therapy_plan_details), 1)
			self.assertEqual(plan.total_sessions, 5)
			self.assertEqual(plan.total_sessions_completed, 2)
			self.assertEqual(plan.status, "In Progress")

	def test_status(self):
		plan = create_therapy_plan()
		self.assertEqual(plan.status, "Not Started")

		session = make_therapy_session(plan.patient, "Basic Rehab", "_Test Company", plan.name)
		frappe.get_doc(session).submit()
		self.assertEqual(frappe.db.get_value("Therapy Plan", plan.name, "status"), "In Progress")

		session = make_therapy_session(plan.patient, "Basic Rehab", "_Test Company", plan.name)
		frappe.get_doc(session).submit()
		self.assertEqual(frappe.db.get_value("Therapy Plan", plan.name, "status"), "Completed")

		patient = "_Test Patient"
		practitioner = "_Test Healthcare Practitioner 2"
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
		other_patient = frappe.get_list(
			"Patient", filters={"name": ["!=", plan.patient]}, pluck="name"
		)[0]
		service_request = frappe.get_doc(
			{
				"doctype": "Service Request",
				"patient": other_patient,
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

	def test_therapy_plan_from_template(self):
		patient = "_Test Patient"
		template = create_therapy_plan_template()
		# check linked item
		self.assertTrue(frappe.db.exists("Therapy Plan Template", {"linked_item": "Complete Rehab"}))

		plan = create_therapy_plan(template)
		# invoice
		si = make_sales_invoice(plan.name, patient, "_Test Company", template)
		si.save()

		therapy_plan_template_amt = frappe.db.get_value("Therapy Plan Template", template, "total_amount")
		self.assertEqual(si.items[0].amount, therapy_plan_template_amt)


def create_therapy_plan_template():
	template_name = frappe.db.exists("Therapy Plan Template", "Complete Rehab")
	if not template_name:
		therapy_type = "Basic Rehab"
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
