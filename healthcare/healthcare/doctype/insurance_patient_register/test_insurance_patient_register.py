# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and Contributors
# See license.txt

# import frappe
from frappe.tests import IntegrationTestCase


# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]



class IntegrationTestInsurancePatientRegister(IntegrationTestCase):
	"""Role matrix behind Valid From / Valid To / Approval Validity (Days).

	The portal mirrors this rule in ``frontend/src/config/permissions.ts`` ->
	``canSetInsuranceRegisterValidity()``. When the two drift apart the portal
	renders editable inputs that the server then rejects with PermissionError
	("Only users with access to the Insurance page can change ..."), so both
	sides are pinned here.
	"""

	def test_website_manager_cannot_set_validity_window(self):
		# Website Manager may open every portal page (frontend ADMIN_ROLES) but is
		# not an insurance administrator: using isAdmin() in the portal made the
		# validity fields editable for these users while this guard rejected the save.
		self.assertFalse(self._can_set_validity("Website Manager"))

	def test_reception_cannot_set_validity_window(self):
		self.assertFalse(self._can_set_validity("Reception"))

	def test_insurance_role_can_set_validity_window(self):
		self.assertTrue(self._can_set_validity("Insurance"))

	def test_insurance_admin_roles_can_set_validity_window(self):
		for role in sorted(INSURANCE_VALIDITY_ADMIN_ROLES):
			with self.subTest(role=role):
				self.assertTrue(self._can_set_validity(role))

	def test_register_with_validity_window_cannot_be_inserted_by_website_manager(self):
		"""The controller guard also covers inserts, not just updates."""
		user = self._make_user("Website Manager")
		provider = frappe.db.get_value("Health Insurance", {}, "name")
		if not provider:
			self.skipTest("No Health Insurance record available")

		previous_user = frappe.session.user
		frappe.set_user(user)
		try:
			register = frappe.get_doc(
				{
					"doctype": "Insurance Patient Register",
					"full_name": "Validity Guard Test",
					"insurance_provider": provider,
					"valid_from": "2026-01-01",
					"valid_to": "2026-01-31",
				}
			)
			self.assertRaises(frappe.PermissionError, register.insert, ignore_permissions=True)
		finally:
			frappe.set_user(previous_user)

	# helpers -------------------------------------------------------------

	def _can_set_validity(self, role):
		return user_can_set_insurance_register_validity(user=self._make_user(role))

	def _make_user(self, role):
		"""Create (once per test class rollback) an enabled user holding `role`."""
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(
				ignore_permissions=True
			)

		email = f"{frappe.scrub(role)}@validity-guard.test"
		if not frappe.db.exists("User", email):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": email,
					"first_name": role,
					"send_welcome_email": 0,
					"roles": [{"doctype": "Has Role", "role": role}],
				}
			).insert(ignore_permissions=True)
		return email
