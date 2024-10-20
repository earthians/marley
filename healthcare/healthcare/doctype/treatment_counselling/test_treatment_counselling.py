# Copyright (c) 2023, healthcare and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils.data import getdate, nowtime

from healthcare.healthcare.doctype.inpatient_record.inpatient_record import schedule_inpatient
from healthcare.healthcare.doctype.lab_test.test_lab_test import create_practitioner
from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import (
	create_patient,
)


class TestTreatmentCounselling(FrappeTestCase):
	def test_insert_treatement_counselling(self):
		frappe.db.sql("""delete from `tabTreatment Counselling`""")
		frappe.db.sql(
			"""delete from `tabObservation Template` where `tabObservation Template`.name='Covid RT PCR'"""
		)
		frappe.db.sql("""delete from `tabItem` where `tabItem`.name='Covid RT PCR'""")
		frappe.db.sql("""delete from `tabItem Price` where `tabItem Price`.item_code='Covid RT PCR'""")

		obs_name = "Covid RT PCR"
		obs_template = create_observation_template(obs_name)
		treatment_plan_template = create_treatement_plan_template("Covid-19", obs_template.name)
		patient = create_patient()
		encounter = create_patient_encounter(patient)
		admission_order = {
			"patient": patient,
			"admission_encounter": encounter.get("name"),
			"referring_practitioner": encounter.practitioner,
			"company": encounter.company,
			"medical_department": encounter.medical_department,
			"primary_practitioner": encounter.practitioner,
			"admission_ordered_for": getdate(),
			"treatment_plan_template": treatment_plan_template,
		}
		schedule_inpatient(admission_order)

		self.assertEqual(
			"Active",
			frappe.db.get_value(
				"Treatment Counselling",
				{
					"patient": patient,
					"treatment_plan_template": treatment_plan_template.name,
					"admission_encounter": encounter.get("name"),
				},
				"status",
			),
		)
		self.assertEqual(
			300,
			frappe.db.get_value(
				"Treatment Counselling",
				{
					"patient": patient,
					"treatment_plan_template": treatment_plan_template.name,
					"admission_encounter": encounter.get("name"),
				},
				"amount",
			),
		)


def create_treatement_plan_template(plan_name, obs_template):
	if frappe.db.exists("Treatment Plan Template", plan_name):
		return frappe.get_doc("Treatment Plan Template", plan_name)

	template = frappe.new_doc("Treatment Plan Template")
	template.template_name = plan_name
	template.medical_department = ""
	template.disabled = 0
	template.is_inpatient = 1
	template.treatment_counselling_required_for_ip = 1
	template.append("items", {"type": "Observation Template", "template": obs_template, "qty": 1})
	template.save()

	return template


def create_observation_template(obs_name):
	if frappe.db.exists("Observation Template", obs_name):
		return frappe.get_doc("Observation Template", obs_name)

	template = frappe.new_doc("Observation Template")
	template.observation = obs_name
	template.item_code = obs_name
	template.observation_category = "Laboratory"
	template.permitted_data_type = "Quantity"
	template.permitted_unit = "mg / dl"
	template.item_group = "Services"
	template.sample_collection_required = 0
	template.rate = 300
	template.abbr = "C"
	template.is_billable = 1
	template.save()
	return template


def create_patient_encounter(patient):
	patient_encounter = frappe.new_doc("Patient Encounter")
	patient_encounter.patient = patient
	patient_encounter.practitioner = create_practitioner()
	patient_encounter.encounter_date = getdate()
	patient_encounter.encounter_time = nowtime()
	patient_encounter.submit()

	return patient_encounter
