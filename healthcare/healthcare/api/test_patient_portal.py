# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

from healthcare.healthcare.api.patient_portal import get_payer_email
from healthcare.tests.utils import HealthcareTestSuite


class TestPatientPortal(HealthcareTestSuite):
	def test_payer_email_is_the_users_email_not_their_id(self):
		with self.set_user("portal-patient-user"):
			self.assertEqual(get_payer_email(), "portal_id_patient@marleyhealth.io")
