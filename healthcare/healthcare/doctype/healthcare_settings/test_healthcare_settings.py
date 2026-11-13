# Copyright (c) 2017, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.utils import get_time

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import ot_setting
from healthcare.tests.utils import HealthcareTestSuite

OT_FIELDS = ("ot_cleaning_minutes", "ot_day_start_time", "ot_day_end_time")


class TestHealthcareSettings(HealthcareTestSuite):
	def setUp(self):
		self.saved = {field: frappe.db.get_single_value("Healthcare Settings", field) for field in OT_FIELDS}

	def tearDown(self):
		for field, value in self.saved.items():
			frappe.db.set_single_value("Healthcare Settings", field, value)

	def test_an_ot_setting_never_saved_or_cleared_reads_its_default(self):
		frappe.db.delete("Singles", {"doctype": "Healthcare Settings", "field": ["in", OT_FIELDS]})
		frappe.db.set_single_value("Healthcare Settings", "ot_day_end_time", "18:00:00")
		frappe.db.set_single_value("Healthcare Settings", "ot_day_start_time", None)  # cleared

		self.assertEqual(int(ot_setting("ot_cleaning_minutes")), 30)
		self.assertEqual(get_time(ot_setting("ot_day_start_time")), get_time("08:00:00"))
		self.assertEqual(get_time(ot_setting("ot_day_end_time")), get_time("18:00:00"))

	def test_the_ot_day_ends_after_it_starts(self):
		settings = frappe.get_single("Healthcare Settings")
		for end in ("06:00:00", "05:00:00"):
			settings.update({"ot_day_start_time": "06:00:00", "ot_day_end_time": end})
			self.assertRaisesRegex(frappe.ValidationError, "must be after", settings.validate_ot_day)

		settings.ot_day_end_time = "20:00:00"
		settings.validate_ot_day()

	def test_zero_cleaning_minutes_is_kept(self):
		frappe.db.set_single_value("Healthcare Settings", "ot_cleaning_minutes", 0)

		self.assertEqual(ot_setting("ot_cleaning_minutes"), 0)
