# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe
from frappe.boot import get_module_sidebars
from frappe.desk.doctype.sidebar.sidebar import sidebar_for_module

from healthcare.tests.utils import HealthcareTestSuite

AREA_WORKSPACES = {
	"Outpatient": "Outpatient",
	"Diagnostics": "Diagnostics",
	"Emergency": "Emergency",
	"Inpatient": "Inpatient",
	"Rehabilitation": "Rehabilitation",
	"Insurance": "Insurance",
	"Healthcare Setup": "Setup",
}


class TestNavigationModules(HealthcareTestSuite):
	def test_each_area_is_a_healthcare_module(self):
		for module in AREA_WORKSPACES:
			self.assertEqual(frappe.db.get_value("Module Def", module, "app_name"), "healthcare", module)

	def test_each_area_owns_its_sidebar_and_workspace(self):
		for module, workspace in AREA_WORKSPACES.items():
			self.assertEqual(frappe.db.get_value("Sidebar", module, "module"), module)
			self.assertEqual(frappe.db.get_value("Workspace", workspace, "module"), module)

	def test_each_area_opens_its_own_shell(self):
		with self.set_user("Administrator"):
			shells = get_module_sidebars()
		for module in [*AREA_WORKSPACES, "Healthcare"]:
			self.assertEqual(shells[module]["module"], module)

	def test_doctypes_stay_in_the_healthcare_module(self):
		self.assertEqual(frappe.db.get_value("DocType", "Lab Test", "module"), "Healthcare")

	def test_setup_icon_opens_the_healthcare_setup_shell(self):
		module = frappe.db.get_value("Workspace", "Setup", "module")
		with self.set_user("Administrator"):
			shell = sidebar_for_module(get_module_sidebars(), module)
		self.assertEqual(shell["name"], "Healthcare Setup")
