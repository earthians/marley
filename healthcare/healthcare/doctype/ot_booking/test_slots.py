# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, get_datetime, getdate, nowdate

from healthcare.healthcare.doctype.healthcare_practitioner.test_practitioner_leave import (
	create_approved_leave,
	link_new_employee,
	skip_without_hrms,
)
from healthcare.healthcare.doctype.ot_booking.priority import priority_named
from healthcare.healthcare.doctype.ot_booking.slots import candidate, case_to_place, confirmed, find_slots
from healthcare.healthcare.doctype.ot_booking.test_availability import (
	create_holiday_list,
	create_unavailable_block,
)
from healthcare.healthcare.doctype.ot_booking.test_ot_booking import (
	HOUR,
	create_ot_template,
	create_service_request,
	create_theatre,
	make_booking,
)
from healthcare.tests.utils import HealthcareTestSuite

DEPARTMENT = "_Test Medical Department"


class TestSlots(HealthcareTestSuite):
	def setUp(self):
		self.patients = frappe.get_all("Patient", pluck="name", limit=3)
		self.practitioners = frappe.get_all("Healthcare Practitioner", pluck="name", limit=3)
		self.theatre = create_theatre("_Test OT 1", "_Test General OT")
		# only this theatre is in the department the finder is asked about
		self.other_theatre = create_theatre("_Test OT 2", "_Test General OT")
		frappe.db.set_value("Healthcare Service Unit", self.theatre, "medical_department", DEPARTMENT)
		frappe.db.set_value("Healthcare Service Unit", self.other_theatre, "medical_department", None)
		self.template = create_ot_template("_Test Procedure - Hernia Repair", duration=HOUR)
		self.use_settings(ot_cleaning_minutes=30, ot_day_start_time="08:00:00", ot_day_end_time="20:00:00")
		self.use_settings(ot_holiday_list=None)
		self.tomorrow = add_days(getdate(nowdate()), 1)
		self.request = create_service_request(self.patients[0], self.practitioners[0])

	def use_settings(self, **values):
		saved = {field: frappe.db.get_single_value("Healthcare Settings", field) for field in values}
		frappe.db.set_single_value("Healthcare Settings", values)
		self.addCleanup(frappe.db.set_single_value, "Healthcare Settings", saved)

	def at(self, hour, minutes=0, day=None):
		return get_datetime(f"{day or self.tomorrow} {hour:02d}:{minutes:02d}:00")

	def slots(self, **options):
		options = {"department": DEPARTMENT, "company": "_Test Company", **options}
		return find_slots(service_request=self.request.name, **options)

	def first_start(self, **options):
		return get_datetime(self.slots(**options)[0]["start"])

	def busy(self, start, end_hour, theatre=None, patient=1, surgeon=1):
		template = create_ot_template(
			f"_Test Procedure - {end_hour - start.hour}h", duration=(end_hour - start.hour) * HOUR
		)
		return make_booking(
			self, start, theatre=theatre, templates=[template.name], patient=patient, surgeon=surgeon
		)

	def test_the_earliest_free_gap_comes_first(self):
		self.busy(self.at(8), 9)

		self.assertEqual(self.first_start(), self.at(9, 30))

	def test_cleaning_time_is_kept_on_both_sides(self):
		self.busy(self.at(8), 9)
		self.busy(self.at(10, 30), 11, patient=2, surgeon=2)

		self.assertEqual(self.first_start(), self.at(12))

	def test_a_theatre_block_is_skipped(self):
		create_unavailable_block(
			self.theatre, "Healthcare Service Unit", self.tomorrow, "08:00:00", "12:00:00"
		)

		self.assertEqual(self.first_start(), self.at(12))

	def test_a_theatre_of_the_wrong_type_is_not_offered(self):
		knee = create_ot_template("_Test Procedure - Knee Replacement", HOUR, "_Test Laminar Flow OT")
		self.request = create_service_request(self.patients[0], self.practitioners[0], knee.name)

		self.assertEqual(self.slots(), [])

	def test_a_theatre_holiday_is_skipped(self):
		self.use_settings(ot_holiday_list=create_holiday_list(self.tomorrow))

		self.assertEqual(getdate(self.first_start()), add_days(self.tomorrow, 1))

	def test_an_emergency_is_not_offered_a_holiday_either(self):
		self.use_settings(ot_holiday_list=create_holiday_list(self.tomorrow))
		self.request.db_set("priority", priority_named("STAT"))
		create_unavailable_block(self.theatre, "Healthcare Service Unit", nowdate(), "00:00:00", "23:59:00")

		self.assertEqual(getdate(self.first_start()), add_days(self.tomorrow, 1))

	def test_the_surgeon_busy_in_another_theatre_is_skipped(self):
		self.busy(self.at(8), 10, theatre=self.other_theatre, patient=1, surgeon=0)

		self.assertEqual(self.first_start(), self.at(10))

	@skip_without_hrms
	def test_the_surgeons_day_of_leave_is_skipped(self):
		create_approved_leave(link_new_employee(self, self.practitioners[0]), self.tomorrow, self.tomorrow)

		self.assertEqual(getdate(self.first_start()), add_days(self.tomorrow, 1))

	def test_nothing_is_offered_past_the_horizon(self):
		create_unavailable_block(
			self.theatre, "Healthcare Service Unit", self.tomorrow, "08:00:00", "20:00:00"
		)

		self.assertEqual(self.slots(days=1), [])

	def test_slots_after_expected_by_come_last_and_are_marked(self):
		self.request.db_set("expected_date", self.tomorrow)
		create_unavailable_block(
			self.theatre, "Healthcare Service Unit", self.tomorrow, "08:00:00", "20:00:00"
		)

		slot = self.slots()[0]

		self.assertEqual((getdate(slot["start"]), slot["after_expected"]), (add_days(self.tomorrow, 1), True))

	def test_the_patients_other_case_is_skipped(self):
		self.busy(self.at(8), 9, theatre=self.other_theatre, patient=0, surgeon=1)

		self.assertEqual(self.first_start(), self.at(9))

	def test_a_surgeon_already_in_two_theatres_is_waited_for(self):
		frappe.db.set_value("Healthcare Practitioner", self.practitioners[0], "allow_overlapping_theatres", 1)
		self.addCleanup(
			frappe.db.set_value,
			"Healthcare Practitioner",
			self.practitioners[0],
			"allow_overlapping_theatres",
			0,
		)
		third = create_theatre("_Test OT 3", "_Test General OT")
		self.busy(self.at(8), 9, theatre=self.other_theatre, patient=1, surgeon=0)
		self.busy(self.at(8), 9, theatre=third, patient=2, surgeon=0)

		self.assertEqual(self.first_start(), self.at(9))

	def test_a_case_from_the_night_before_is_waited_for(self):
		next_day = add_days(self.tomorrow, 1)
		create_unavailable_block(
			self.theatre, "Healthcare Service Unit", self.tomorrow, "08:00:00", "20:00:00"
		)
		ten_hours = create_ot_template("_Test Procedure - Ten Hours", duration=10 * HOUR)
		make_booking(self, self.at(23), templates=[ten_hours.name], patient=1, surgeon=1)

		self.assertEqual(self.first_start(), self.at(9, 30, day=next_day))

	def test_a_refused_gap_gives_way_to_the_next_in_that_theatre(self):
		# the finder is handed a gap the server refuses (the patient is busy at 08:00)
		self.busy(self.at(8), 9, theatre=self.other_theatre, patient=0, surgeon=1)
		case = case_to_place(self.request.name, None)
		theatre = frappe._dict(name=self.theatre, label="OT 1")
		gaps = [candidate(case, theatre, self.at(8)), candidate(case, theatre, self.at(9, 30))]

		slots = confirmed(case, self.request.name, gaps, limit=5)

		self.assertEqual([found["start"] for found in slots], [self.at(9, 30)])

	def test_the_cleaning_after_the_case_fits_before_closing(self):
		create_unavailable_block(
			self.theatre, "Healthcare Service Unit", self.tomorrow, "08:00:00", "19:00:00"
		)

		self.assertEqual(self.slots(days=1), [])

	def test_one_slot_per_theatre_per_day(self):
		days = [getdate(slot["start"]) for slot in self.slots(limit=3)]

		self.assertEqual(days, [self.tomorrow, add_days(self.tomorrow, 1), add_days(self.tomorrow, 2)])

	def test_finding_slots_leaves_nothing_behind(self):
		before = frappe.db.count("OT Booking")

		self.slots()

		self.assertEqual(frappe.db.count("OT Booking"), before)

	def test_a_postponed_case_is_offered_slots_too(self):
		booking = make_booking(self, self.at(9, day=add_days(self.tomorrow, 3)), patient=2, surgeon=2)
		booking.db_set("status", "Postponed")

		slots = find_slots(booking=booking.name, department=DEPARTMENT, company="_Test Company")

		self.assertEqual(get_datetime(slots[0]["start"]), self.at(8))

	def test_finding_slots_needs_permission(self):
		frappe.set_user("test_user@marleyhealth.io")  # a login with no clinical role
		self.addCleanup(frappe.set_user, "Administrator")

		self.assertRaises(frappe.PermissionError, self.slots)
