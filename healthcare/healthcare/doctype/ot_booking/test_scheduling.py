# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, add_to_date, get_datetime, nowdate

from healthcare.healthcare.doctype.ot_booking.board import get_board
from healthcare.healthcare.doctype.ot_booking.priority import priority_named
from healthcare.healthcare.doctype.ot_booking.scheduling import (
	book_request,
	check_drop,
	create_procedures,
	get_open_requests,
	move_booking,
	set_status,
)
from healthcare.healthcare.doctype.ot_booking.test_availability import create_holiday_list
from healthcare.healthcare.doctype.ot_booking.test_ot_booking import (
	HOUR,
	create_ot_template,
	create_service_request,
	create_theatre,
	make_booking,
)
from healthcare.tests.utils import HealthcareTestSuite

DEPARTMENT = "_Test Medical Department"
# named, not taken from the user's default, which other modules' tests may leave set
COMPANY = "_Test Company"


class TestScheduling(HealthcareTestSuite):
	def setUp(self):
		self.patients = frappe.get_all("Patient", pluck="name", limit=2)
		self.practitioners = frappe.get_all("Healthcare Practitioner", pluck="name", limit=2)
		self.theatre = create_theatre("_Test OT 1", "_Test General OT")
		self.other_theatre = create_theatre("_Test OT 2", "_Test General OT")
		self.template = create_ot_template("_Test Procedure - Hernia Repair", duration=HOUR)
		test_names = sorted(name for name in dir(self) if name.startswith("test_"))
		self.day = add_days(nowdate(), 1100 + test_names.index(self._testMethodName))

	def at(self, hour):
		return get_datetime(f"{self.day} {hour:02d}:00:00")

	def open_request_names(self):
		return [request.name for request in get_open_requests(company=COMPANY)]

	def move(self, booking, hour, theatre=None, reason=None):
		return move_booking(booking.name, theatre or self.theatre, str(self.at(hour)), reason)

	def test_an_open_request_carries_its_duration_patient_theatre_type_and_priority(self):
		knee = create_ot_template("_Test Procedure - Knee Replacement", HOUR, "_Test Laminar Flow OT")
		request = create_service_request(self.patients[0], self.practitioners[0], knee.name)
		request.db_set("priority", priority_named("STAT"))

		listed = {row.name: row for row in get_open_requests(company=COMPANY)}[request.name]

		self.assertEqual(listed.duration, HOUR)
		self.assertEqual(listed.sex, frappe.db.get_value("Patient", self.patients[0], "sex"))
		self.assertEqual(listed.theatre_type, "_Test Laminar Flow OT")
		self.assertEqual((listed.priority_label, listed.is_emergency), ("STAT", True))

	def test_a_request_is_in_its_procedures_department(self):
		frappe.db.set_value(
			"Clinical Procedure Template", self.template.name, "medical_department", DEPARTMENT
		)
		request = create_service_request(self.patients[0], self.practitioners[0])
		frappe.db.set_value("Service Request", request.name, "medical_department", None)

		self.assertIn(
			request.name, [row.name for row in get_open_requests(company=COMPANY, department=DEPARTMENT)]
		)
		self.assertNotIn(
			request.name,
			[row.name for row in get_open_requests(company=COMPANY, department="_Test Other Department")],
		)

	def test_the_pane_shows_the_default_company_when_none_is_given(self):
		request = create_service_request(self.patients[0], self.practitioners[0])
		other_company = frappe.db.get_value("Company", {"name": ["!=", "_Test Company"]})
		# a Company default is stored under its scrubbed key
		saved = frappe.defaults.get_user_default("Company")
		self.addCleanup(frappe.defaults.set_user_default, "company", saved)

		frappe.defaults.set_user_default("company", "_Test Company")
		self.assertIn(request.name, [row.name for row in get_open_requests()])
		frappe.defaults.set_user_default("company", other_company)
		self.assertNotIn(request.name, [row.name for row in get_open_requests()])

	def test_the_most_pressing_request_comes_first(self):
		later = create_service_request(self.patients[0], self.practitioners[0])
		sooner = create_service_request(self.patients[1], self.practitioners[0])
		undated = create_service_request(self.patients[0], self.practitioners[0])
		later.db_set("expected_date", add_days(self.day, 5))
		sooner.db_set("expected_date", add_days(self.day, 1))
		undated.db_set("expected_date", None)

		order = [
			name for name in self.open_request_names() if name in (later.name, sooner.name, undated.name)
		]

		self.assertEqual(order, [sooner.name, later.name, undated.name])

	def test_checking_a_drop_keeps_nothing(self):
		request = create_service_request(self.patients[0], self.practitioners[0])
		params = {"service_request": request.name, "theatre": self.theatre, "start": str(self.at(9))}

		self.assertIsNone(check_drop("book_request", params))
		self.assertIn(request.name, self.open_request_names())

	def test_checking_a_drop_says_why_it_would_be_refused(self):
		template = create_ot_template("_Test Procedure - Knee Replacement", HOUR, "_Test Laminar Flow OT")
		request = create_service_request(self.patients[0], self.practitioners[0], template.name)
		params = {"service_request": request.name, "theatre": self.theatre, "start": str(self.at(9))}

		self.assertIn("Laminar Flow OT", check_drop("book_request", params))

	def test_checking_a_drop_on_a_holiday_says_so(self):
		saved = frappe.db.get_single_value("Healthcare Settings", "ot_holiday_list")
		frappe.db.set_single_value("Healthcare Settings", "ot_holiday_list", create_holiday_list(self.day))
		self.addCleanup(frappe.db.set_single_value, "Healthcare Settings", "ot_holiday_list", saved)
		request = create_service_request(self.patients[0], self.practitioners[0])
		params = {"service_request": request.name, "theatre": self.theatre, "start": str(self.at(9))}

		self.assertIn("theatre holiday", check_drop("book_request", params))

	def test_a_booked_request_is_not_listed(self):
		request = create_service_request(self.patients[0], self.practitioners[0])
		book_request(request.name, self.theatre, str(self.at(9)))

		self.assertNotIn(request.name, self.open_request_names())

	def test_a_request_that_needs_no_theatre_is_not_listed(self):
		template = create_ot_template("_Test Procedure - Dressing Change", HOUR, requires_ot=0)
		request = create_service_request(self.patients[0], self.practitioners[0], template.name)

		self.assertNotIn(request.name, self.open_request_names())

	def test_a_dropped_request_is_booked_in_its_theatre_and_time(self):
		request = create_service_request(self.patients[0], self.practitioners[0])

		booking = frappe.get_doc("OT Booking", book_request(request.name, self.theatre, str(self.at(9))))

		self.assertEqual((booking.theatre, get_datetime(booking.scheduled_start)), (self.theatre, self.at(9)))

	def test_a_request_dropped_onto_a_busy_slot_pushes_the_case_there(self):
		there = make_booking(self, self.at(9), patient=1, surgeon=1)
		request = create_service_request(self.patients[0], self.practitioners[0])

		book_request(request.name, self.theatre, str(self.at(9)))

		cleaning = frappe.db.get_single_value("Healthcare Settings", "ot_cleaning_minutes")
		self.assertEqual(
			get_datetime(frappe.db.get_value("OT Booking", there.name, "scheduled_start")),
			add_to_date(self.at(10), minutes=cleaning),
		)

	def test_a_tentative_case_moves_to_another_theatre_and_time(self):
		booking = make_booking(self, self.at(9))

		self.move(booking, 13, theatre=self.other_theatre)

		booking.reload()
		self.assertEqual(
			(booking.theatre, get_datetime(booking.scheduled_start)), (self.other_theatre, self.at(13))
		)

	def test_a_scheduled_case_needs_a_reason_to_move(self):
		booking = make_booking(self, self.at(9))
		booking.db_set("status", "Scheduled", update_modified=False)

		self.assertRaisesRegex(frappe.ValidationError, "Change Reason", self.move, booking, 13)
		self.move(booking, 13, reason="Surgeon delayed")

		self.assertTrue(
			frappe.db.exists(
				"Comment",
				{"reference_name": booking.name, "content": ["like", "%Surgeon delayed%"]},
			)
		)

	def test_a_completed_case_cannot_move(self):
		booking = make_booking(self, self.at(9))
		booking.db_set("status", "Completed", update_modified=False)

		self.assertRaisesRegex(frappe.ValidationError, "cannot be moved", self.move, booking, 13)

	def test_a_tentative_case_is_scheduled(self):
		booking = make_booking(self, self.at(9))

		set_status(booking.name, "Scheduled")

		self.assertEqual(frappe.db.get_value("OT Booking", booking.name, "status"), "Scheduled")

	def test_procedures_are_created_from_the_board(self):
		booking = make_booking(self, self.at(9))

		created = create_procedures(booking.name)

		self.assertEqual(len(created), 1)
		self.assertEqual(create_procedures(booking.name), [])

	def test_the_board_and_moving_need_permission(self):
		booking = make_booking(self, self.at(9))
		frappe.set_user("test_user@marleyhealth.io")  # a login with no clinical role
		self.addCleanup(frappe.set_user, "Administrator")

		self.assertRaises(frappe.PermissionError, get_board, str(self.day), COMPANY)
		self.assertRaises(frappe.PermissionError, self.move, booking, 13)
