# Copyright (c) 2020, earthians and Contributors
# See license.txt

import frappe
from frappe.utils import getdate, nowdate, nowtime

from healthcare.healthcare.doctype.patient_encounter.patient_encounter import (
	create_patient_referral,
)
from healthcare.healthcare.doctype.service_request.service_request import (
	make_appointment,
	make_clinical_procedure,
	make_observation,
)
from healthcare.tests.factories.billing import invoice_service_request
from healthcare.tests.factories.encounters import (
	create_encounter_with_order,
	create_lab_test,
	create_therapy_plan,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestServiceRequest(HealthcareTestSuite):
	def test_service_request_creation_on_encounter_submission(self):
		patient = "_Test Patient"
		practitioner = "_Test Healthcare Practitioner 2"
		lab_test_template = frappe.get_doc("Lab Test Template", "_Test Lab Test - Sensitivity")
		cpt = "_Test Procedure - Wound Inspection and Cleaning"
		procedure_template = frappe.get_doc("Clinical Procedure Template", cpt)
		procedure_template.allow_stock_consumption = 1
		therapy_type = frappe.get_doc("Therapy Type", "Basic Rehab")
		encounter = create_encounter_with_order(
			patient,
			practitioner,
			"lab_test_prescription",
			lab_test_template,
			procedure_template=procedure_template,
			therapy_type=therapy_type,
			submit=True,
		)
		self.assertTrue(frappe.db.exists("Service Request", {"order_group": encounter.name}))
		service_request = frappe.db.get_all(
			"Service Request", {"order_group": encounter.name}, ["name", "template_dt"]
		)
		if service_request:
			for sr in service_request:
				service_request_doc = frappe.get_doc("Service Request", sr.get("name"))
				service_request_doc.submit()
				if sr.get("name"):
					if sr.get("template_dt") == "Lab Test Template":
						template = lab_test_template
						type = "lab_test_prescription"
						doc = "Lab Test"
						test = create_lab_test(template)
						test.service_request = sr.get("name")
						test.descriptive_test_items[0].result_value = 1
						test.descriptive_test_items[1].result_value = 2
						test.descriptive_test_items[2].result_value = 3
						test.submit()
					elif sr.get("template_dt") == "Clinical Procedure Template":
						test = make_clinical_procedure(service_request_doc.name)
						test.submit()
						doc = "Clinical Procedure"
						template = procedure_template
						type = "procedure_prescription"
					elif sr.get("template_dt") == "Therapy Type":
						test = make_therapy_session(service_request_doc.name)
						test.submit()
						doc = "Therapy Session"
						template = therapy_type
						type = "therapies"

					# create sales invoice with service request and check service request and lab test is marked as invoiced
					invoice_service_request(patient, service_request_doc, template, type)
					self.assertEqual(
						frappe.db.get_value("Service Request", sr.get("name"), "billing_status"), "Invoiced"
					)
					self.assertEqual(
						frappe.db.get_value("Service Request", sr.get("name"), "status"),
						"completed-Request Status",
					)
					self.assertTrue(frappe.db.get_value(doc, test.name, "invoiced"))

	def test_creation_on_encounter_with_create_order_on_save_checked(self):
		patient = "_Test Patient"
		practitioner = "_Test Healthcare Practitioner 2"
		lab_test_template = frappe.get_doc("Lab Test Template", "_Test Lab Test - with Sample")
		encounter = create_encounter_with_order(
			patient, practitioner, "lab_test_prescription", lab_test_template
		)
		encounter.submit_orders_on_save = True
		encounter.save()
		self.assertTrue(frappe.db.exists("Service Request", {"order_group": encounter.name}))
		encounter.submit()

		# to check if submit creates order
		self.assertEqual(
			frappe.db.count(
				"Service Request",
				filters={"order_group": encounter.name},
			),
			1,
		)

	def test_mark_observation_as_invoiced(self):
		obs_template = frappe.get_doc("Observation Template", "_Test Observation without Sample")
		patient = "_Test Patient"
		practitioner = "_Test Healthcare Practitioner 2"
		encounter = create_encounter_with_order(
			patient, practitioner, "lab_test_prescription", obs_template, submit=True, obs=True
		)
		service_request = frappe.db.get_value("Service Request", {"order_group": encounter.name}, "name")
		if service_request:
			service_request_doc = frappe.get_doc("Service Request", service_request)
			observation = create_observation(patient, service_request, obs_template.name)
			invoice_service_request(patient, service_request_doc, obs_template, "observation")
			self.assertEqual(frappe.db.get_value("Observation", observation.name, "invoiced"), 1)

	def test_make_observation_maps_practitioner(self):
		obs_template = frappe.get_doc("Observation Template", "_Test Observation without Sample")
		patient = "_Test Patient"
		practitioner = "_Test Healthcare Practitioner 2"
		encounter = create_encounter_with_order(
			patient, practitioner, "lab_test_prescription", obs_template, submit=True, obs=True
		)
		service_request = frappe.db.get_value("Service Request", {"order_group": encounter.name}, "name")

		observation, _doctype = make_observation(service_request)

		self.assertEqual(
			frappe.db.get_value("Observation", observation, "healthcare_practitioner"), practitioner
		)

	def test_patient_referral(self):
		patient = "_Test Patient"
		practitioner_1 = "_Test Healthcare Practitioner 2"
		practitioner_2 = "_Test Healthcare Practitioner 1"
		obs_template = frappe.get_doc("Observation Template", "_Test Observation without Sample")
		encounter = create_encounter_with_order(
			patient, practitioner_1, "lab_test_prescription", obs_template, submit=True, obs=True
		)
		appointment_type = frappe.get_doc("Appointment Type", "_Test Appointment Type with Items")
		refer_to_practitioner(encounter, practitioner_2, appointment_type.name)

		self.assertTrue(
			frappe.db.exists(
				"Service Request",
				{
					"order_group": encounter.name,
					"template_dt": "Appointment Type",
					"template_dn": appointment_type.name,
				},
			)
		)

		self.assertEqual(
			frappe.db.get_value(
				"Service Request",
				{
					"order_group": encounter.name,
					"template_dt": "Appointment Type",
					"template_dn": appointment_type.name,
				},
				"referred_to_practitioner",
			),
			practitioner_2,
		)

	def test_make_appointment_from_service_request_does_not_copy_order_source(self):
		patient = "_Test IPD Patient"
		referring_practitioner = "_Test Healthcare Practitioner 0"
		referred_practitioner = "_Test Healthcare Practitioner 1"
		appointment_type = frappe.get_doc("Appointment Type", "_Test Appointment Type with Items")
		referred_practitioner_name = frappe.db.get_value(
			"Healthcare Practitioner", referred_practitioner, "practitioner_name"
		)
		service_request = frappe.get_doc(
			{
				"doctype": "Service Request",
				"order_date": getdate(),
				"order_time": nowtime(),
				"company": "_Test Company",
				"patient": patient,
				"practitioner": referring_practitioner,
				"source": "Direct",
				"template_dt": "Appointment Type",
				"template_dn": appointment_type.name,
				"referred_to_practitioner": referred_practitioner,
				"quantity": 1,
			}
		).insert(ignore_permissions=True)

		appointment = make_appointment(service_request.name)

		self.assertEqual(appointment.service_request, service_request.name)
		self.assertEqual(appointment.practitioner, referred_practitioner)
		self.assertEqual(appointment.practitioner_name, referred_practitioner_name)
		self.assertFalse(appointment.source)

	def test_make_appointment_without_referred_practitioner_returns_draft(self):
		patient = "_Test IPD Patient"
		practitioner = "_Test Healthcare Practitioner 0"
		appointment_type = frappe.get_doc("Appointment Type", "_Test Appointment Type with Items")
		service_request = frappe.get_doc(
			{
				"doctype": "Service Request",
				"order_date": getdate(),
				"order_time": nowtime(),
				"company": "_Test Company",
				"patient": patient,
				"practitioner": practitioner,
				"source": "Direct",
				"template_dt": "Appointment Type",
				"template_dn": appointment_type.name,
				"quantity": 1,
			}
		).insert(ignore_permissions=True)

		appointment = make_appointment(service_request.name)

		self.assertEqual(appointment.service_request, service_request.name)
		self.assertFalse(appointment.source)


def create_observation(patient, service_request, obs_template):
	observation = frappe.new_doc("Observation")
	observation.patient = patient
	observation.service_request = service_request
	observation.observation_template = obs_template
	observation.company = "_Test Company"
	observation.insert()
	return observation


def make_therapy_session(service_request):
	plan = create_therapy_plan()

	start_date = nowdate()
	therapy_session = frappe.new_doc("Therapy Session")
	therapy_session.patient = plan.patient
	therapy_session.therapy_type = "Basic Rehab"
	therapy_session.therapy_plan = plan.name
	therapy_session.duration = 1
	therapy_session.start_date = start_date
	therapy_session.service_request = service_request
	therapy_session.company = "_Test Company"
	therapy_session.save()

	return therapy_session


def refer_to_practitioner(encounter, practitioner=None, appointment_type=None):
	if not practitioner:
		return

	if not appointment_type:
		return

	references = [
		{
			"refer_to": practitioner,
			"appointment_type": appointment_type,
			"referral_note": f"Patient {encounter.patient} referred to practitioner {practitioner}",
		}
	]

	create_patient_referral(encounter.name, references)
