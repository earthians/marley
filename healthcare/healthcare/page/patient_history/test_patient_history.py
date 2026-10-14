# Copyright (c) 2026, ESS LLP and contributors

from healthcare.healthcare.page.patient_history.patient_history import _clean_text
from healthcare.tests.utils import HealthcareTestSuite


class TestPatientHistoryText(HealthcareTestSuite):
	def test_feed_text_does_not_contain_html_markup_or_entities(self):
		cleaned = _clean_text(
			"<div>Consult&nbsp;<b>review</b><br>follow-up &lt;i&gt;note&lt;/i&gt;</div>"
		)

		self.assertNotIn("<", cleaned)
		self.assertNotIn("&nbsp;", cleaned)
		self.assertNotIn("&lt;", cleaned)
		self.assertEqual(cleaned, "Consult review. follow-up note")
