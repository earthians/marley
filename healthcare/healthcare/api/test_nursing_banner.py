# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

from healthcare.healthcare.api.nursing import PatientBanner
from healthcare.tests.utils import HealthcareTestSuite


class TestPatientBanner(HealthcareTestSuite):
	def test_allergies_list_recorded_allergies_then_the_medical_history(self):
		allergies = PatientBanner("_Test Allergic Patient").allergies()
		self.assertEqual(allergies, ["_Test Peanut Allergy (Severe)", "Latex"])

	def test_inactive_allergies_are_left_out(self):
		allergies = PatientBanner("_Test Allergic Patient").allergies()
		self.assertNotIn("_Test Analgesic Allergy", allergies)

	def test_a_patient_without_allergies_has_none(self):
		self.assertEqual(PatientBanner("_Test Patient 3").allergies(), [])
