# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe
from frappe.boot import get_bootinfo

from healthcare.patches.v16_0.land_healthcare_users_on_healthcare import execute
from healthcare.tests.utils import HealthcareTestSuite

PHYSICIAN = "gp@marleyhealth.io"
OTHER_USER = "test_user@marleyhealth.io"


class TestHealthcareLanding(HealthcareTestSuite):
	def test_patch_lands_healthcare_users_on_healthcare(self):
		self.clear_workspaces()
		execute()
		self.assertEqual(frappe.db.get_value("User", PHYSICIAN, "default_workspace"), "Healthcare")

	def test_patch_leaves_other_users_alone(self):
		self.clear_workspaces()
		execute()
		self.assertFalse(frappe.db.get_value("User", OTHER_USER, "default_workspace"))

	def test_patch_keeps_a_users_own_choice(self):
		frappe.db.set_value("User", PHYSICIAN, "default_workspace", "Outpatient")
		execute()
		self.assertEqual(frappe.db.get_value("User", PHYSICIAN, "default_workspace"), "Outpatient")

	def test_healthcare_user_opens_the_healthcare_shell(self):
		self.clear_workspaces()
		execute()
		frappe.clear_cache(user=PHYSICIAN)
		with self.set_user(PHYSICIAN):
			self.assertEqual(get_bootinfo().get("home_shell"), "Healthcare")

	def clear_workspaces(self):
		for user in (PHYSICIAN, OTHER_USER):
			frappe.db.set_value("User", user, "default_workspace", None)
