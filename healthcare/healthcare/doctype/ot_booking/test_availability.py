# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, add_to_date, cint, get_datetime, nowdate

from healthcare.healthcare.doctype.healthcare_practitioner.test_practitioner_leave import (
	create_approved_leave,
	link_new_employee,
	skip_without_hrms,
)
from healthcare.healthcare.doctype.ot_booking.priority import priority_named
from healthcare.healthcare.doctype.ot_booking.test_ot_booking import (
	HOUR,
	create_ot_template,
	create_theatre,
	make_booking,
)
from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import (
	create_practitioner_availability,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestAvailability(HealthcareTestSuite):
	def setUp(self):
		self.patients = frappe.get_all("Patient", pluck="name", limit=3)
		self.practitioners = frappe.get_all("Healthcare Practitioner", pluck="name", limit=3)
		self.theatre = create_theatre("_Test OT 1", "_Test General OT")
		self.other_theatre = create_theatre("_Test OT 2", "_Test General OT")
		self.third_theatre = create_theatre("_Test OT 3", "_Test General OT")
		self.template = create_ot_template("_Test Procedure - Hernia Repair", duration=HOUR)
		test_names = sorted(name for name in dir(self) if name.startswith("test_"))
		self.day = add_days(nowdate(), 800 + test_names.index(self._testMethodName))

	def at(self, hour):
		return get_datetime(f"{self.day} {hour:02d}:00:00")

	def assert_refused(self, message, start, **fields):
		self.assertRaisesRegex(frappe.ValidationError, message, make_booking, self, start, **fields)

	def allow_overlap(self, practitioner):
		frappe.db.set_value("Healthcare Practitioner", practitioner, "allow_overlapping_theatres", 1)
		self.addCleanup(
			frappe.db.set_value, "Healthcare Practitioner", practitioner, "allow_overlapping_theatres", 0
		)

	def test_theatre_overlap_is_refused(self):
		make_booking(self, self.at(9))

		self.assert_refused("Theatre .* is booked", self.at(9), patient=1, surgeon=1)

	def test_cleaning_time_is_kept_between_cases(self):
		make_booking(self, self.at(9))
		cleaning = cint(frappe.db.get_single_value("Healthcare Settings", "ot_cleaning_minutes"))

		self.assert_refused("minutes of cleaning", self.at(10), patient=1, surgeon=1)
		make_booking(self, add_to_date(self.at(10), minutes=cleaning), patient=1, surgeon=1)

	def test_a_surgeon_cannot_be_in_two_theatres_at_once_and_is_named(self):
		first = make_booking(self, self.at(9))
		surgeon = frappe.db.get_value("Healthcare Practitioner", self.practitioners[0], "practitioner_name")

		with self.assertRaises(frappe.ValidationError) as refused:
			make_booking(self, self.at(9), theatre=self.other_theatre, patient=1)

		self.assertIn(f"{surgeon}</strong> is in theatre", str(refused.exception))
		self.assertIn(f"with {first.patient_name}", str(refused.exception))

	def test_an_earlier_case_keeps_its_own_cleaning_time(self):
		make_booking(self, self.at(9)).db_set("cleaning_minutes", 60)

		self.assert_refused("minutes of cleaning", self.at(10), patient=1, surgeon=1)
		make_booking(self, self.at(11), patient=1, surgeon=1)

	def test_a_surgeon_needs_no_cleaning_gap_between_theatres(self):
		make_booking(self, self.at(9))

		make_booking(self, self.at(10), theatre=self.other_theatre, patient=1)

	def test_a_practitioner_allowed_to_overlap_covers_two_theatres_never_three(self):
		self.allow_overlap(self.practitioners[0])
		make_booking(self, self.at(9))
		make_booking(self, self.at(9), theatre=self.other_theatre, patient=1)

		self.assert_refused("is in theatre", self.at(9), theatre=self.third_theatre, patient=2)

	def test_a_practitioner_allowed_to_overlap_may_span_two_cases_that_follow_each_other(self):
		# 09-10 and 10-11 in two theatres, then 09-11 in a third: never more than two at once
		self.allow_overlap(self.practitioners[0])
		make_booking(self, self.at(9))
		make_booking(self, self.at(10), theatre=self.other_theatre, patient=1)
		two_hours = create_ot_template("_Test Procedure - Two Hours", duration=2 * HOUR)

		make_booking(self, self.at(9), theatre=self.third_theatre, patient=2, templates=[two_hours.name])

	def test_a_patient_cannot_have_two_overlapping_cases(self):
		make_booking(self, self.at(9))

		self.assert_refused("already has a booking", self.at(9), theatre=self.other_theatre, surgeon=1)

	def test_cancelled_and_postponed_cases_take_no_time(self):
		for status in ("Cancelled", "Postponed"):
			make_booking(self, self.at(9)).db_set("status", status)

		booking = make_booking(self, self.at(9))
		booking.anaesthesia_type = "General"
		booking.save()  # and a case saved again does not clash with itself

	def block(self, scope, scope_type, start="09:00:00", end="10:00:00"):
		create_unavailable_block(scope, scope_type, self.day, start, end)

	def test_an_unavailable_surgeon_is_refused(self):
		self.block(self.practitioners[0], "Healthcare Practitioner")

		self.assertRaisesRegex(frappe.ValidationError, "is unavailable", make_booking, self, self.at(9))

	def test_an_unavailable_theatre_is_refused(self):
		self.block(self.theatre, "Healthcare Service Unit")

		self.assertRaisesRegex(frappe.ValidationError, "is unavailable", make_booking, self, self.at(9))

	def test_a_block_outside_the_case_does_not_matter(self):
		self.block(self.practitioners[0], "Healthcare Practitioner", "14:00:00", "15:00:00")

		make_booking(self, self.at(9))

	def test_an_emergency_is_only_warned_about(self):
		self.block(self.practitioners[0], "Healthcare Practitioner")
		booking = make_booking(self, self.at(12))
		booking.scheduled_start = self.at(9)
		booking.priority = priority_named("STAT")

		booking.save()

	def test_an_elective_case_on_a_theatre_holiday_is_refused(self):
		self.use_theatre_holiday_list(create_holiday_list(self.day))

		self.assertRaisesRegex(frappe.ValidationError, "theatre holiday", make_booking, self, self.at(9))

	def test_an_emergency_case_on_a_theatre_holiday_is_allowed(self):
		self.use_theatre_holiday_list(create_holiday_list(self.day))

		make_booking(self, self.at(9), priority=priority_named("STAT"))

	def test_a_half_day_holiday_can_be_booked(self):
		self.use_theatre_holiday_list(create_holiday_list(self.day, is_half_day=1))

		make_booking(self, self.at(9))

	def test_the_company_holiday_list_is_used_when_none_is_set(self):
		self.use_theatre_holiday_list(None)
		company_list = frappe.db.get_value("Company", "_Test Company", "default_holiday_list")
		frappe.db.set_value("Company", "_Test Company", "default_holiday_list", create_holiday_list(self.day))
		self.addCleanup(frappe.db.set_value, "Company", "_Test Company", "default_holiday_list", company_list)

		self.assertRaisesRegex(frappe.ValidationError, "theatre holiday", make_booking, self, self.at(9))

	def use_theatre_holiday_list(self, holiday_list):
		saved = frappe.db.get_single_value("Healthcare Settings", "ot_holiday_list")
		frappe.db.set_single_value("Healthcare Settings", "ot_holiday_list", holiday_list)
		self.addCleanup(frappe.db.set_single_value, "Healthcare Settings", "ot_holiday_list", saved)

	def test_a_block_late_on_the_first_day_of_an_overnight_case_is_refused(self):
		overnight = create_ot_template("_Test Procedure - Two Hours", duration=2 * HOUR)
		create_unavailable_block(self.theatre, "Healthcare Service Unit", self.day, "23:30:00", "23:59:00")

		self.assertRaisesRegex(
			frappe.ValidationError,
			"is unavailable",
			make_booking,
			self,
			self.at(23),
			templates=[overnight.name],
		)

	@skip_without_hrms
	def test_a_surgeon_on_leave_is_refused_by_name(self):
		create_approved_leave(link_new_employee(self, self.practitioners[0]), self.day, self.day)
		name = frappe.db.get_value("Healthcare Practitioner", self.practitioners[0], "practitioner_name")

		self.assertRaisesRegex(
			frappe.ValidationError, f"{name}</strong> is on leave", make_booking, self, self.at(9)
		)

	@skip_without_hrms
	def test_a_surgeon_on_half_day_leave_is_only_warned_about(self):
		employee = link_new_employee(self, self.practitioners[0])
		create_approved_leave(employee, self.day, self.day, half_day_date=self.day)

		make_booking(self, self.at(9))


def create_unavailable_block(scope, scope_type, day, start="09:00:00", end="10:00:00"):
	if scope_type == "Healthcare Practitioner":
		# an Unavailable block for a practitioner must cut into time they are available
		create_practitioner_availability("08:00:00", "18:00:00", scope, scope_type, day)
	return create_practitioner_availability(start, end, scope, scope_type, day, type="Unavailable")


def create_holiday_list(day, is_half_day=0):
	holiday_list = frappe.get_doc(
		{
			"doctype": "Holiday List",
			"holiday_list_name": f"_Test OT Holidays {day} {is_half_day}",
			"from_date": day,
			"to_date": day,
			"holidays": [{"holiday_date": day, "description": "_Test Holiday", "is_half_day": is_half_day}],
		}
	)
	return holiday_list.insert(ignore_if_duplicate=True).name
