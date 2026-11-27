# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# See license.txt

import frappe

from healthcare.patches.v16_0.block_area_modules_with_healthcare import AREA_MODULES, execute
from healthcare.tests.utils import HealthcareTestSuite

PROFILE = "_Test Healthcare Blocked"


class TestBlockAreaModules(HealthcareTestSuite):
	def test_blocking_healthcare_blocks_every_area(self):
		execute()
		self.assertEqual(self.blocked(), {"Healthcare", *AREA_MODULES})

	def test_running_twice_adds_no_duplicates(self):
		execute()
		execute()
		self.assertEqual(len(frappe.get_doc("Module Profile", PROFILE).block_modules), len(AREA_MODULES) + 1)

	def blocked(self) -> set[str]:
		return {row.module for row in frappe.get_doc("Module Profile", PROFILE).block_modules}
