# Copyright (c) 2026, ESS LLP and contributors

import frappe

from healthcare.healthcare.page.patient_history import patient_history
from healthcare.healthcare.page.patient_history.patient_history import _clean_text
from healthcare.tests.utils import HealthcareTestSuite


class TestPatientHistoryText(HealthcareTestSuite):
	def test_feed_text_does_not_contain_html_markup_or_entities(self):
		cleaned = _clean_text("<div>Consult&nbsp;<b>review</b><br>follow-up &lt;i&gt;note&lt;/i&gt;</div>")

		self.assertNotIn("<", cleaned)
		self.assertNotIn("&nbsp;", cleaned)
		self.assertNotIn("&lt;", cleaned)
		self.assertEqual(cleaned, "Consult review. follow-up note")


class TestPatientHistoryPermissions(HealthcareTestSuite):
	def test_activity_endpoints_require_patient_read(self):
		user = "patient-history-no-access@example.com"
		if not frappe.db.exists("User", user):
			frappe.get_doc(
				{"doctype": "User", "email": user, "first_name": "No Access", "send_welcome_email": 0}
			).insert(ignore_permissions=True)

		calls = (
			lambda: patient_history.get_feed("_Test Patient"),
			lambda: patient_history.get_feed_count("_Test Patient"),
			lambda: patient_history.get_patient_encounter_markers("_Test Patient"),
			lambda: patient_history.get_activity_years("_Test Patient"),
			lambda: patient_history.get_activity_summary("_Test Patient", "2026-01-01", "2026-12-31"),
		)
		frappe.set_user(user)
		try:
			for call in calls:
				with self.assertRaises(frappe.PermissionError):
					call()
		finally:
			frappe.set_user("Administrator")
