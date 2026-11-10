# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, get_datetime, nowdate

from healthcare.healthcare.doctype.ot_booking.publishing import publish_day
from healthcare.healthcare.doctype.ot_booking.test_availability import create_unavailable_block
from healthcare.healthcare.doctype.ot_booking.test_ot_booking import (
	HOUR,
	create_ot_template,
	create_theatre,
	make_booking,
)
from healthcare.tests.utils import HealthcareTestSuite

DEPARTMENT = "_Test Medical Department"


class TestPublishing(HealthcareTestSuite):
	def setUp(self):
		self.patients = frappe.get_all("Patient", pluck="name", limit=2)
		self.practitioners = frappe.get_all("Healthcare Practitioner", pluck="name", limit=2)
		self.theatre = create_theatre("_Test OT 1", "_Test General OT")
		self.template = create_ot_template("_Test Procedure - Hernia Repair", duration=HOUR)
		test_names = sorted(name for name in dir(self) if name.startswith("test_"))
		self.day = add_days(nowdate(), 1400 + test_names.index(self._testMethodName))

	def at(self, hour, day=None):
		return get_datetime(f"{day or self.day} {hour:02d}:00:00")

	def status(self, booking):
		return frappe.db.get_value("OT Booking", booking.name, "status")

	def test_the_days_tentative_cases_are_scheduled_with_their_procedures(self):
		booking = make_booking(self, self.at(9))

		result = publish_day(self.day)

		self.assertEqual(result, {"published": [booking.name], "failed": []})
		self.assertEqual(self.status(booking), "Scheduled")
		self.assertTrue(frappe.db.exists("Clinical Procedure", {"ot_booking": booking.name}))

	def test_a_case_that_fails_its_checks_stays_tentative_and_is_reported(self):
		ready = make_booking(self, self.at(9))
		blocked = make_booking(self, self.at(13), patient=1, surgeon=1)
		create_unavailable_block(
			self.practitioners[1], "Healthcare Practitioner", self.day, "13:00:00", "14:00:00"
		)

		result = publish_day(self.day)

		self.assertEqual(result["published"], [ready.name])
		self.assertEqual([row["name"] for row in result["failed"]], [blocked.name])
		self.assertIn("is unavailable", result["failed"][0]["message"])
		self.assertEqual(self.status(blocked), "Tentative")
		self.assertFalse(frappe.db.exists("Clinical Procedure", {"ot_booking": blocked.name}))

	def test_other_days_are_left_alone(self):
		other_day = add_days(self.day, 1)
		booking = make_booking(self, self.at(9, other_day))

		publish_day(self.day)

		self.assertEqual(self.status(booking), "Tentative")

	def test_only_the_departments_theatres_are_published(self):
		other = create_theatre("_Test OT 2", "_Test General OT")
		frappe.db.set_value("Healthcare Service Unit", self.theatre, "medical_department", DEPARTMENT)
		frappe.db.set_value("Healthcare Service Unit", other, "medical_department", None)
		shown = make_booking(self, self.at(9))
		hidden = make_booking(self, self.at(9), theatre=other, patient=1, surgeon=1)

		result = publish_day(self.day, "_Test Company", DEPARTMENT)

		self.assertEqual(result["published"], [shown.name])
		self.assertEqual(self.status(hidden), "Tentative")

	def test_publishing_needs_permission(self):
		frappe.set_user("test_user@marleyhealth.io")  # a login with no clinical role
		self.addCleanup(frappe.set_user, "Administrator")

		self.assertRaises(frappe.PermissionError, publish_day, self.day)
