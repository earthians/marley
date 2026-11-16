# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, get_datetime, nowdate

from healthcare.healthcare.doctype.ot_booking.ot_booking import make_ot_booking
from healthcare.healthcare.doctype.ot_booking.priority import priority_named
from healthcare.healthcare.doctype.ot_booking.scheduling import (
	book_request,
	get_open_requests,
	get_unscheduled,
	move_booking,
	set_status,
)
from healthcare.healthcare.doctype.ot_booking.test_day_rules import create_user, later_today
from healthcare.healthcare.doctype.ot_booking.test_ot_booking import (
	HOUR,
	create_ot_template,
	create_service_request,
	create_theatre,
	make_booking,
)
from healthcare.tests.utils import HealthcareTestSuite

DEPARTMENT = "_Test Medical Department"
COMPANY = "_Test Company"


class TestCancelAndUnschedule(HealthcareTestSuite):
	def setUp(self):
		self.patients = frappe.get_all("Patient", pluck="name", limit=2)
		self.practitioners = frappe.get_all("Healthcare Practitioner", pluck="name", limit=2)
		self.theatre = create_theatre("_Test OT 1", "_Test General OT")
		self.template = create_ot_template("_Test Procedure - Hernia Repair", duration=HOUR)
		test_names = sorted(name for name in dir(self) if name.startswith("test_"))
		self.day = add_days(nowdate(), 1300 + test_names.index(self._testMethodName))

	def at(self, hour, day=None):
		return get_datetime(f"{day or self.day} {hour:02d}:00:00")

	def booked_request(self):
		request = create_service_request(self.patients[0], self.practitioners[0])
		booking = frappe.get_doc("OT Booking", book_request(request.name, self.theatre, str(self.at(9))))
		booking.create_clinical_procedures()
		booking.reload()
		return request.name, booking

	def stop(self, booking, status, reason="_Test reason"):
		return set_status(booking.name, status, reason)

	def test_an_unscheduled_case_keeps_its_request_and_loses_its_draft_procedures(self):
		request, booking = self.booked_request()
		procedure = frappe.db.get_value("Clinical Procedure", {"ot_booking": booking.name})

		self.stop(booking, "Unscheduled")

		self.assertFalse(frappe.db.exists("Clinical Procedure", procedure))
		self.assertNotIn(request, [row.name for row in get_open_requests(company=COMPANY)])
		self.assertIn(booking.name, [row.name for row in get_unscheduled(company=COMPANY)])

	def test_an_unscheduled_case_carries_the_theatre_type_it_needs_and_its_priority(self):
		knee = create_ot_template("_Test Procedure - Knee Replacement", HOUR, "_Test Laminar Flow OT")
		booking = make_booking(
			self,
			self.at(9),
			templates=[knee.name],
			theatre=create_theatre("_Test Laminar OT 1", "_Test Laminar Flow OT"),
		)
		booking.db_set("status", "Unscheduled")

		listed = {row.name: row for row in get_unscheduled(company=COMPANY)}[booking.name]

		self.assertEqual(listed.theatre_type, "_Test Laminar Flow OT")
		self.assertEqual((listed.priority_label, listed.is_emergency), ("Routine", False))

	def test_an_unscheduled_case_is_in_its_procedures_department(self):
		frappe.db.set_value(
			"Clinical Procedure Template", self.template.name, "medical_department", DEPARTMENT
		)
		_request, booking = self.booked_request()
		self.stop(booking, "Unscheduled")

		self.assertIn(
			booking.name, [row.name for row in get_unscheduled(company=COMPANY, department=DEPARTMENT)]
		)
		self.assertNotIn(
			booking.name,
			[row.name for row in get_unscheduled(company=COMPANY, department="_Test Other Department")],
		)

	def test_a_cancelled_case_frees_its_request(self):
		request, booking = self.booked_request()

		self.stop(booking, "Cancelled")

		self.assertIn(request, [row.name for row in get_open_requests(company=COMPANY)])
		self.assertFalse(frappe.db.exists("Clinical Procedure", {"ot_booking": booking.name}))

	def test_an_unscheduled_case_dropped_on_another_day_is_tentative_there(self):
		_request, booking = self.booked_request()
		self.stop(booking, "Unscheduled")
		booking.reload()
		next_day = add_days(self.day, 1)

		move_booking(booking.name, self.theatre, str(self.at(11, next_day)))

		booking.reload()
		self.assertEqual(
			(booking.status, get_datetime(booking.scheduled_start)), ("Tentative", self.at(11, next_day))
		)

	def test_an_unscheduled_case_from_today_is_rescheduled_without_a_reason(self):
		booking = make_booking(self, later_today(self, 2), priority=priority_named("STAT"))
		self.stop(booking, "Unscheduled", "Theatre flooded")
		booking.reload()

		move_booking(booking.name, self.theatre, str(self.at(11)))

		self.assertEqual(frappe.db.get_value("OT Booking", booking.name, "status"), "Tentative")

	def test_a_tentative_case_is_rescheduled_without_a_reason(self):
		booking = make_booking(self, self.at(9))

		set_status(booking.name, "Unscheduled")

		self.assertIn(booking.name, [row.name for row in get_unscheduled(company=COMPANY)])

	def test_a_scheduled_case_needs_a_reason_to_be_rescheduled(self):
		booking = make_booking(self, self.at(9))
		booking.db_set("status", "Scheduled")
		booking.reload()

		self.assertRaisesRegex(
			frappe.ValidationError,
			"Change Reason",
			set_status,
			booking.name,
			"Unscheduled",
		)

	def test_an_elective_case_cannot_be_moved_onto_the_day_of_surgery(self):
		booking = make_booking(self, self.at(9))
		frappe.set_user(create_user("_test_ot_coordinator@example.com", "OT Coordinator"))
		self.addCleanup(frappe.set_user, "Administrator")

		self.assertRaisesRegex(
			frappe.ValidationError,
			"Only an emergency",
			move_booking,
			booking.name,
			self.theatre,
			str(later_today(self, 2)),
		)

	def test_a_new_case_without_a_time_is_unscheduled_and_waits_in_the_pane(self):
		booking = make_booking(self, None)

		self.assertEqual(
			(booking.status, booking.theatre, booking.scheduled_end), ("Unscheduled", None, None)
		)
		listed = {row.name: row for row in get_unscheduled(company=COMPANY)}[booking.name]
		self.assertEqual(listed.duration, HOUR)

	def test_a_request_booked_without_a_time_waits_as_an_unscheduled_case(self):
		request = create_service_request(self.patients[0], self.practitioners[0])

		booking = make_ot_booking(request.name).insert()

		self.assertEqual(booking.status, "Unscheduled")
		self.assertNotIn(request.name, [row.name for row in get_open_requests(company=COMPANY)])

	def test_a_case_sent_back_loses_its_theatre_and_time(self):
		booking = make_booking(self, self.at(9))

		set_status(booking.name, "Unscheduled")

		booking.reload()
		self.assertEqual(
			(booking.theatre, booking.scheduled_start, booking.scheduled_date), (None, None, None)
		)

	def test_an_unscheduled_case_given_a_theatre_and_time_becomes_tentative(self):
		booking = make_booking(self, None)
		booking.update({"theatre": self.theatre, "scheduled_start": self.at(9)})

		booking.save()

		self.assertEqual(booking.status, "Tentative")
		self.assertEqual(get_datetime(booking.scheduled_end), self.at(10))

	def test_other_statuses_need_a_theatre_and_time(self):
		self.assertRaisesRegex(
			frappe.ValidationError, "needs a Theatre", make_booking, self, None, status="Scheduled"
		)
		booking = make_booking(self, self.at(9))
		booking.scheduled_start = None
		self.assertRaisesRegex(frappe.ValidationError, "needs a Theatre", booking.save)

	def test_a_case_without_a_time_takes_no_time_from_others(self):
		make_booking(self, None)

		make_booking(self, self.at(9))
