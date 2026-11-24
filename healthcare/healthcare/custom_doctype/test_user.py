import frappe

from healthcare.tests.utils import HealthcareTestSuite


class TestUser(HealthcareTestSuite):
	def test_login_email_change_updates_the_patient_email(self):
		save_portal_user(email="portal_id_patient_new@marleyhealth.io")
		self.assertEqual(portal_patient_email(), "portal_id_patient_new@marleyhealth.io")

	def test_other_user_changes_leave_the_patient_email(self):
		save_portal_user(last_name="renamed")
		self.assertEqual(portal_patient_email(), "portal_id_patient@marleyhealth.io")


def save_portal_user(**values):
	user = frappe.get_doc("User", "portal-patient-user")
	user.update(values)
	user.flags.skip_email_from_name = True
	user.save(ignore_permissions=True)


def portal_patient_email() -> str | None:
	return frappe.db.get_value("Patient", {"user_id": "portal-patient-user"}, "email")
