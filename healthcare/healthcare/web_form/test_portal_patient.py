# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe

from healthcare.healthcare.web_form.portal_patient import get_portal_patient
from healthcare.tests.utils import HealthcareTestSuite


class TestPortalPatient(HealthcareTestSuite):
	def portal_patient(self):
		return frappe.db.get_value("Patient", {"first_name": "_Test Portal Patient"}, "name")

	def test_portal_patient_is_found_by_user_id(self):
		with self.set_user("portal-patient-user"):
			self.assertEqual(get_portal_patient(), self.portal_patient())

	def test_other_user_has_no_portal_patient(self):
		self.assertIsNone(get_portal_patient("portal-other-user"))

	def test_encounter_is_readable_by_its_patient_only(self):
		self.assert_readable_by_its_patient_only(
			frappe.new_doc("Patient Encounter", patient=self.portal_patient())
		)

	def test_appointment_is_readable_by_its_patient_only(self):
		self.assert_readable_by_its_patient_only(
			frappe.new_doc("Patient Appointment", patient=self.portal_patient())
		)

	def test_patient_is_readable_by_themselves_only(self):
		self.assert_readable_by_its_patient_only(frappe.get_doc("Patient", self.portal_patient()))

	def assert_readable_by_its_patient_only(self, doc):
		self.assertTrue(frappe.has_website_permission(doc, user="portal-patient-user"))
		self.assertFalse(frappe.has_website_permission(doc, user="portal-other-user"))
