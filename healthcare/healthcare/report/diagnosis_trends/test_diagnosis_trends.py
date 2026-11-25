import frappe
from frappe.utils import add_days, add_months, getdate

from healthcare.healthcare.report.diagnosis_trends.diagnosis_trends import execute
from healthcare.tests.factories.encounters import create_encounter_with_therapy
from healthcare.tests.utils import HealthcareTestSuite


class TestDiagnosisTrends(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		self.create_test_transactions()

	def create_test_transactions(self):
		patient_name = "_Test Patient"
		cardiology_practitioner = "_Test Healthcare Practitioner 2"
		general_practitioner = "_Test Healthcare Practitioner 0"

		self.heart_attack_encounter = self.create_encounter_with_diagnosis(
			patient=patient_name,
			practitioner=cardiology_practitioner,
			medical_department="Cardiology",
			diagnosis="Heart Attack",
		)

		self.fever_encounter = self.create_encounter_with_diagnosis(
			patient=patient_name,
			practitioner=general_practitioner,
			medical_department="_Test Medical Department",
			diagnosis="Fever",
		)

	def create_encounter_with_diagnosis(self, patient, practitioner, medical_department, diagnosis):
		encounter = create_encounter_with_therapy(
			patient=patient,
			medical_department=medical_department,
			practitioner=practitioner,
			submit=False,
		)

		encounter.reload()
		encounter.source = "Direct"
		encounter.medical_department = medical_department
		encounter.append(
			"diagnosis",
			{
				"diagnosis": diagnosis,
			},
		)
		encounter.save()
		encounter.reload()

		self.assertEqual(encounter.medical_department, medical_department)
		self.assertTrue(
			frappe.db.exists(
				"Patient Encounter Diagnosis",
				{
					"parent": encounter.name,
					"diagnosis": diagnosis,
				},
			)
		)

		return encounter

	def test_report_data(self):
		filters = {
			"from_date": str(add_months(getdate(), -12)),
			"to_date": str(add_days(getdate(), 1)),
			"range": "Monthly",
		}
		report = execute(filters)
		data = [row["diagnosis"] for row in report[1]]

		self.assertIn("Fever", data)
		self.assertIn("Heart Attack", data)

	def test_report_data_with_filters(self):
		filters = {
			"from_date": str(add_months(getdate(), -12)),
			"to_date": str(add_days(getdate(), 1)),
			"range": "Monthly",
			"department": "Cardiology",
		}
		report = execute(filters)
		data = [row["diagnosis"] for row in report[1]]

		self.assertIn("Heart Attack", data)
