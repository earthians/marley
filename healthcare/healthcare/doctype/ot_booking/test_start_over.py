# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, get_datetime, nowdate

from healthcare.healthcare.doctype.ot_booking.publishing import start_over_day
from healthcare.healthcare.doctype.ot_booking.test_ot_booking import (
	HOUR,
	create_ot_template,
	create_theatre,
	make_booking,
)
from healthcare.tests.utils import HealthcareTestSuite

COMPANY = "_Test Company"


class TestStartOver(HealthcareTestSuite):
	def setUp(self):
		self.patients = frappe.get_all("Patient", pluck="name", limit=3)
		self.practitioners = frappe.get_all("Healthcare Practitioner", pluck="name", limit=3)
		self.theatre = create_theatre("_Test OT 1", "_Test General OT")
		self.template = create_ot_template("_Test Procedure - Hernia Repair", duration=HOUR)
		test_names = sorted(name for name in dir(self) if name.startswith("test_"))
		self.day = add_days(nowdate(), 2700 + test_names.index(self._testMethodName))

	def at(self, hour):
		return get_datetime(f"{self.day} {hour:02d}:00:00")

	def status(self, booking):
		return frappe.db.get_value("OT Booking", booking.name, "status")

	def test_tentative_cases_go_back_to_the_pane_and_published_ones_stay(self):
		tentative = make_booking(self, self.at(9))
		scheduled = make_booking(self, self.at(13), patient=1, surgeon=1)
		scheduled.db_set("status", "Scheduled")

		result = start_over_day(str(self.day), COMPANY)

		self.assertEqual((self.status(tentative), self.status(scheduled)), ("Postponed", "Scheduled"))
		self.assertEqual(result["moved"], [tentative.name])

	def test_cases_under_way_stay(self):
		started = make_booking(self, self.at(9))
		started.db_set("status", "In Progress")

		start_over_day(str(self.day), COMPANY)

		self.assertEqual(self.status(started), "In Progress")

	def test_a_case_that_cannot_move_stays_and_is_reported(self):
		booking = make_booking(self, self.at(9))
		frappe.get_doc("Clinical Procedure", booking.create_clinical_procedures()[0]).submit()

		result = start_over_day(str(self.day), COMPANY)

		self.assertEqual(
			([row["name"] for row in result["failed"]], self.status(booking)), ([booking.name], "Tentative")
		)

	def test_a_day_gone_by_is_not_started_over(self):
		self.assertRaisesRegex(
			frappe.ValidationError,
			"today or a day to come",
			start_over_day,
			str(add_days(nowdate(), -1)),
			COMPANY,
		)

	def test_starting_over_needs_permission(self):
		frappe.set_user("test_user@marleyhealth.io")  # a login with no clinical role
		self.addCleanup(frappe.set_user, "Administrator")

		self.assertRaises(frappe.PermissionError, start_over_day, str(self.day), COMPANY)
