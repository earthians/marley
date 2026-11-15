# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, add_months, get_datetime, getdate, nowdate

from healthcare.healthcare.doctype.ot_booking.auto_schedule import book_day, plan_day
from healthcare.healthcare.doctype.ot_booking.priority import priority_named
from healthcare.healthcare.doctype.ot_booking.scheduling import book_request
from healthcare.healthcare.doctype.ot_booking.test_ot_booking import (
	HOUR,
	create_ot_template,
	create_service_request,
	create_theatre,
	make_booking,
)
from healthcare.tests.utils import HealthcareTestSuite

DEPARTMENT = "_Test Medical Department"


class TestAutoSchedule(HealthcareTestSuite):
	def setUp(self):
		self.patients = frappe.get_all("Patient", pluck="name", limit=3)
		self.practitioners = frappe.get_all("Healthcare Practitioner", pluck="name", limit=3)
		self.theatre = create_theatre("_Test OT 1", "_Test General OT")
		self.other_theatre = create_theatre("_Test OT 2", "_Test General OT")
		frappe.db.set_value("Healthcare Service Unit", self.theatre, "medical_department", DEPARTMENT)
		frappe.db.set_value("Healthcare Service Unit", self.other_theatre, "medical_department", None)
		self.template = create_ot_template("_Test Procedure - Hernia Repair", duration=HOUR)
		self.template.db_set({"medical_department": DEPARTMENT, "requires_fasting": 0})
		self.use_settings(ot_cleaning_minutes=30, ot_day_start_time="08:00:00", ot_day_end_time="20:00:00")
		self.use_settings(ot_holiday_list=None)
		self.tomorrow = add_days(getdate(nowdate()), 1)
		for patient in self.patients:
			frappe.db.set_value("Patient", patient, "dob", "1990-01-01")
		self.request = self.due_request(patient=0)

	def use_settings(self, **values):
		saved = {field: frappe.db.get_single_value("Healthcare Settings", field) for field in values}
		frappe.db.set_single_value("Healthcare Settings", values)
		self.addCleanup(frappe.db.set_single_value, "Healthcare Settings", saved)

	def due_request(self, patient, expected=None, priority=None, template=None):
		request = create_service_request(
			self.patients[patient], self.practitioners[patient], template or self.template.name
		)
		request.db_set({"expected_date": expected or self.tomorrow, "medical_department": DEPARTMENT})
		if priority:
			request.db_set("priority", priority_named(priority))
		return request

	def at(self, hour, minutes=0):
		return get_datetime(f"{self.tomorrow} {hour:02d}:{minutes:02d}:00")

	def plan(self, department=DEPARTMENT, **board_filters):
		return plan_day(str(self.tomorrow), "_Test Company", department, board_filters)

	def planned_start(self, plan, name):
		row = next((row for row in plan["placed"] if row["name"] == name), None)
		self.assertIsNotNone(row, f"{name} was not placed: {plan}")
		return get_datetime(row["scheduled_start"])

	def planned_names(self, plan):
		return {row["name"] for row in plan["placed"] + plan["not_placed"]}

	def booking_of(self, request):
		parent = frappe.db.get_value("OT Booking Procedure", {"service_request": request.name}, "parent")
		return parent and frappe.get_doc("OT Booking", parent)

	def test_a_due_request_is_planned_at_the_earliest_free_time(self):
		self.assertEqual(self.planned_start(self.plan(), self.request.name), self.at(8))

	def test_planning_keeps_nothing(self):
		self.plan()

		self.assertIsNone(self.booking_of(self.request))

	def test_a_request_due_later_or_undated_waits(self):
		later = self.due_request(patient=1, expected=add_days(self.tomorrow, 1))
		undated = self.due_request(patient=2)
		undated.db_set("expected_date", None)

		planned = self.planned_names(self.plan())

		self.assertNotIn(later.name, planned)
		self.assertNotIn(undated.name, planned)

	def test_priority_comes_before_age_and_fasting(self):
		frappe.db.set_value("Patient", self.patients[1], "dob", add_months(self.tomorrow, -6))
		infant = self.due_request(patient=1)
		urgent = self.due_request(patient=2, priority="Urgent")

		plan = self.plan()

		self.assertEqual(self.planned_start(plan, urgent.name), self.at(8))
		self.assertEqual(self.planned_start(plan, infant.name), self.at(9, 30))
		self.assertEqual(self.planned_start(plan, self.request.name), self.at(11))

	def test_a_tentative_case_on_the_day_is_planned_again(self):
		tentative = make_booking(self, self.at(14), patient=1, surgeon=1)

		plan = self.plan()

		self.assertIn(tentative.name, plan["lifted"])
		self.assertIn(tentative.name, self.planned_names(plan))

	def test_a_scheduled_case_stays_and_is_planned_around(self):
		make_booking(self, self.at(8), patient=1, surgeon=1).db_set("status", "Scheduled")

		plan = self.plan()

		self.assertEqual(plan["lifted"], [])
		self.assertEqual(self.planned_start(plan, self.request.name), self.at(9, 30))

	def test_a_patients_second_case_goes_right_after_the_first(self):
		first = make_booking(self, self.at(10), patient=0, surgeon=0, cleaning_minutes=0)
		first.db_set("status", "Scheduled")

		self.assertEqual(self.planned_start(self.plan(), self.request.name), self.at(11))

	def test_booking_books_what_the_plan_showed(self):
		plan = self.plan()

		book_day(str(self.tomorrow), "_Test Company", DEPARTMENT, plan["placed"], plan["lifted"])

		booking = self.booking_of(self.request)
		self.assertEqual(get_datetime(booking.scheduled_start), self.at(8))
		self.assertEqual(booking.status, "Tentative")

	def test_a_request_booked_meanwhile_is_reported(self):
		plan = self.plan()
		book_request(self.request.name, self.theatre, str(self.at(12)))

		result = book_day(str(self.tomorrow), "_Test Company", DEPARTMENT, plan["placed"], plan["lifted"])

		refused = next(row for row in result["not_placed"] if row["name"] == self.request.name)
		self.assertIn("no longer waiting", refused["reason"])

	def test_the_board_filters_choose_the_cases_and_the_theatre(self):
		other = self.due_request(patient=1)
		tentative = make_booking(self, self.at(14), patient=2, surgeon=2)
		frappe.db.set_value("Healthcare Service Unit", self.other_theatre, "medical_department", DEPARTMENT)

		by_patient = self.plan(patient=self.patients[1])
		self.assertEqual(self.planned_names(by_patient), {other.name})
		self.assertNotIn(tentative.name, by_patient["lifted"])
		self.assertEqual(
			self.planned_names(self.plan(practitioner=self.practitioners[0])), {self.request.name}
		)
		by_theatre = self.plan(theatre=self.other_theatre)
		self.assertEqual({row["theatre"] for row in by_theatre["placed"]}, {self.other_theatre})

	def test_within_a_priority_infants_then_fasting_cases_go_first(self):
		fasting = create_ot_template("_Test Procedure - Fasting Repair", duration=HOUR)
		fasting.db_set({"requires_fasting": 1, "medical_department": DEPARTMENT})
		hungry = self.due_request(patient=1, template=fasting.name)
		frappe.db.set_value("Patient", self.patients[2], "dob", add_months(self.tomorrow, -6))
		infant = self.due_request(patient=2)

		plan = self.plan()

		self.assertEqual(self.planned_start(plan, infant.name), self.at(8))
		self.assertEqual(self.planned_start(plan, hungry.name), self.at(9, 30))
		self.assertEqual(self.planned_start(plan, self.request.name), self.at(11))

	def test_today_cannot_be_auto_scheduled(self):
		self.assertRaises(frappe.ValidationError, plan_day, nowdate(), "_Test Company", DEPARTMENT)
