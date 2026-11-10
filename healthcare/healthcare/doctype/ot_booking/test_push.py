# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, add_to_date, cint, get_datetime, nowdate

from healthcare.healthcare.doctype.ot_booking.scheduling import book_request, move_booking
from healthcare.healthcare.doctype.ot_booking.test_ot_booking import (
	HOUR,
	create_ot_template,
	create_service_request,
	create_theatre,
	make_booking,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestPush(HealthcareTestSuite):
	def setUp(self):
		self.patients = frappe.get_all("Patient", pluck="name", limit=3)
		self.practitioners = frappe.get_all("Healthcare Practitioner", pluck="name", limit=3)
		self.theatre = create_theatre("_Test OT 1", "_Test General OT")
		self.template = create_ot_template("_Test Procedure - Hernia Repair", duration=HOUR)
		self.cleaning = cint(frappe.db.get_single_value("Healthcare Settings", "ot_cleaning_minutes"))
		test_names = sorted(name for name in dir(self) if name.startswith("test_"))
		self.day = add_days(nowdate(), 1700 + test_names.index(self._testMethodName))

	def at(self, hour, minutes=0):
		return add_to_date(get_datetime(f"{self.day} {hour:02d}:00:00"), minutes=minutes)

	def start_of(self, booking):
		return get_datetime(frappe.db.get_value("OT Booking", booking.name, "scheduled_start"))

	def drop_request(self, hour):
		request = create_service_request(self.patients[0], self.practitioners[0])
		return book_request(request.name, self.theatre, str(self.at(hour)))

	def test_the_cases_after_a_drop_are_pushed_back_in_order(self):
		first = make_booking(self, self.at(9), patient=1, surgeon=1)
		second = make_booking(self, self.at(10, self.cleaning), patient=2, surgeon=2)

		self.drop_request(9)

		self.assertEqual(self.start_of(first), self.at(10, self.cleaning))
		self.assertEqual(self.start_of(second), self.at(11, 2 * self.cleaning))

	def test_a_gap_that_holds_the_case_ends_the_push(self):
		first = make_booking(self, self.at(9), patient=1, surgeon=1)
		far = make_booking(self, self.at(15), patient=2, surgeon=2)

		self.drop_request(9)

		self.assertEqual(self.start_of(first), self.at(10, self.cleaning))
		self.assertEqual(self.start_of(far), self.at(15))

	def test_a_scheduled_case_is_pushed_only_with_a_reason(self):
		scheduled = make_booking(self, self.at(9), patient=1, surgeon=1)
		scheduled.db_set("status", "Scheduled")
		request = create_service_request(self.patients[0], self.practitioners[0])

		self.assertRaisesRegex(
			frappe.ValidationError, "Change Reason", book_request, request.name, self.theatre, str(self.at(9))
		)
		book_request(request.name, self.theatre, str(self.at(9)), "Emergency hernia first")

		self.assertEqual(self.start_of(scheduled), self.at(10, self.cleaning))
		self.assertTrue(
			frappe.db.exists(
				"Comment", {"reference_name": scheduled.name, "content": ["like", "%Emergency hernia%"]}
			)
		)

	def test_a_case_under_way_is_not_pushed(self):
		started = make_booking(self, self.at(9), patient=1, surgeon=1)
		started.db_set("status", "In Progress")

		self.assertRaisesRegex(frappe.ValidationError, "cannot be pushed", self.drop_request, 9)
		self.assertEqual(self.start_of(started), self.at(9))

	def test_a_case_moved_to_the_front_does_not_collide_with_its_old_slot(self):
		long = create_ot_template("_Test Procedure - Long Repair", duration=2 * HOUR)
		first = make_booking(self, self.at(9), templates=[long.name], patient=1, surgeon=1)
		second = make_booking(self, self.at(12), patient=2, surgeon=2)

		move_booking(second.name, self.theatre, str(self.at(9)))

		self.assertEqual(self.start_of(second), self.at(9))
		self.assertEqual(self.start_of(first), self.at(10, self.cleaning))

	def test_moving_a_case_into_a_busy_slot_pushes_the_case_there(self):
		there = make_booking(self, self.at(9), patient=1, surgeon=1)
		moved = make_booking(self, self.at(14), patient=2, surgeon=2)

		move_booking(moved.name, self.theatre, str(self.at(9)))

		self.assertEqual(self.start_of(moved), self.at(9))
		self.assertEqual(self.start_of(there), self.at(10, self.cleaning))
