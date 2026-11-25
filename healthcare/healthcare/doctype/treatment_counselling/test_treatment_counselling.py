# Copyright (c) 2023, healthcare and Contributors
# See license.txt

import frappe
from frappe.utils.data import getdate, nowtime

from healthcare.healthcare.doctype.inpatient_record.inpatient_record import schedule_inpatient
from healthcare.tests.utils import HealthcareTestSuite


class TestTreatmentCounselling(HealthcareTestSuite):
	def test_insert_treatment_counselling(self):
		frappe.db.sql("""delete from `tabTreatment Counselling`""")

		treatment_plan_template = frappe.get_doc("Treatment Plan Template", "COVID19")
		patient = "_Test Patient"
		encounter = create_patient_encounter(patient)
		admission_order = {
			"patient": patient,
			"admission_encounter": encounter.get("name"),
			"referring_practitioner": encounter.practitioner,
			"company": encounter.company,
			"medical_department": encounter.medical_department,
			"primary_practitioner": encounter.practitioner,
			"admission_ordered_for": getdate(),
			"treatment_plan_template": treatment_plan_template.get("name"),
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


def create_patient_encounter(patient):
	patient_encounter = frappe.new_doc("Patient Encounter")
	patient_encounter.appointment_type = "_Test Appointment Type"
	patient_encounter.patient = patient
	patient_encounter.practitioner = "_Test Healthcare Practitioner 2"
	patient_encounter.encounter_date = getdate()
	patient_encounter.encounter_time = nowtime()
	patient_encounter.submit()

	return patient_encounter
