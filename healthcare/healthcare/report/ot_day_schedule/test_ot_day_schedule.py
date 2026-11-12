# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, get_datetime, nowdate

from healthcare.healthcare.doctype.ot_booking.test_ot_booking import (
	HOUR,
	create_ot_template,
	create_theatre,
	make_booking,
)
from healthcare.healthcare.report.ot_day_schedule.ot_day_schedule import execute
from healthcare.tests.utils import HealthcareTestSuite

COMPANY = "_Test Company"


class TestOTDaySchedule(HealthcareTestSuite):
	def setUp(self):
		self.patients = frappe.get_all("Patient", pluck="name", limit=3)
		self.practitioners = frappe.get_all("Healthcare Practitioner", pluck="name", limit=3)
		self.theatre = create_theatre("_Test OT 1", "_Test General OT")
		self.other_theatre = create_theatre("_Test OT 2", "_Test General OT")
		self.template = create_ot_template("_Test Procedure - Hernia Repair", duration=HOUR)
		test_names = sorted(name for name in dir(self) if name.startswith("test_"))
		self.day = add_days(nowdate(), 2800 + test_names.index(self._testMethodName))
		self.first = make_booking(self, self.at(9))
		self.second = make_booking(self, self.at(9), theatre=self.other_theatre, patient=1, surgeon=1)

	def at(self, hour):
		return get_datetime(f"{self.day} {hour:02d}:00:00")

	def report(self, **filters):
		return execute(frappe._dict(date=str(self.day), company=COMPANY, **filters))

	def test_the_days_cases_are_listed_by_theatre(self):
		_columns, data = self.report()

		self.assertEqual([row["ot_booking"] for row in data], [self.first.name, self.second.name])
		self.assertEqual(data[0]["time"], "09:00–10:00")

	def test_by_practitioner_each_member_has_their_cases_with_their_role(self):
		columns, data = self.report(group_by="Practitioner", practitioner=self.practitioners[0])

		self.assertIn("role", [column["fieldname"] for column in columns])
		self.assertEqual([(row["ot_booking"], row["role"]) for row in data], [(self.first.name, "Surgeon")])

	def test_the_theatre_and_patient_filters_keep_only_their_cases(self):
		self.assertEqual(
			[r["ot_booking"] for r in self.report(theatre=self.other_theatre)[1]], [self.second.name]
		)
		self.assertEqual(
			[r["ot_booking"] for r in self.report(patient=self.patients[0])[1]], [self.first.name]
		)

	def test_the_report_needs_permission(self):
		frappe.set_user("test_user@marleyhealth.io")
		self.addCleanup(frappe.set_user, "Administrator")

		self.assertRaises(frappe.PermissionError, self.report)
