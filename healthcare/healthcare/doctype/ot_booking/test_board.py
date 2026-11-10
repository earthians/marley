# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, get_datetime, getdate, nowdate

from healthcare.healthcare.doctype.healthcare_practitioner.test_practitioner_leave import (
	create_approved_leave,
	link_new_employee,
	skip_without_hrms,
)
from healthcare.healthcare.doctype.ot_booking.board import (
	add_patient_details,
	age_text,
	get_away,
	get_board,
)
from healthcare.healthcare.doctype.ot_booking.test_availability import (
	create_holiday_list,
	create_unavailable_block,
)
from healthcare.healthcare.doctype.ot_booking.test_day_rules import create_user
from healthcare.healthcare.doctype.ot_booking.test_ot_booking import (
	HOUR,
	create_ot_template,
	create_theatre,
	make_booking,
)
from healthcare.healthcare.doctype.ot_booking.theatres import day_window
from healthcare.tests.utils import HealthcareTestSuite

DEPARTMENT = "_Test Medical Department"


class TestBoard(HealthcareTestSuite):
	def setUp(self):
		self.patients = frappe.get_all("Patient", pluck="name", limit=2)
		self.practitioners = frappe.get_all("Healthcare Practitioner", pluck="name", limit=2)
		self.theatre = create_theatre("_Test OT 1", "_Test General OT")
		self.template = create_ot_template("_Test Procedure - Hernia Repair", duration=HOUR)
		test_names = sorted(name for name in dir(self) if name.startswith("test_"))
		self.day = add_days(nowdate(), 1000 + test_names.index(self._testMethodName))

	def at(self, hour):
		return get_datetime(f"{self.day} {hour:02d}:00:00")

	def board(self):
		return get_board(self.day, "_Test Company")

	def test_theatres_are_grouped_by_their_complex(self):
		complex_name = frappe.db.get_value(
			"Healthcare Service Unit", self.theatre, "parent_healthcare_service_unit"
		)

		complexes = {group["name"]: group["theatres"] for group in self.board()["complexes"]}

		self.assertIn(self.theatre, [theatre.name for theatre in complexes[complex_name]])

	def test_a_department_shows_only_its_own_theatres(self):
		other = create_theatre("_Test OT 2", "_Test General OT")
		frappe.db.set_value("Healthcare Service Unit", self.theatre, "medical_department", DEPARTMENT)
		frappe.db.set_value("Healthcare Service Unit", other, "medical_department", None)

		board = get_board(self.day, "_Test Company", DEPARTMENT)

		shown = [theatre.name for group in board["complexes"] for theatre in group["theatres"]]
		self.assertEqual(shown, [self.theatre])
		self.assertIn(DEPARTMENT, board["departments"])
		self.assertIn("_Test Company", board["companies"])

	def test_the_days_bookings_carry_their_surgeon_and_procedures(self):
		booking = make_booking(self, self.at(9))

		shown = self.board()["bookings"]

		self.assertEqual([row.name for row in shown], [booking.name])
		self.assertEqual(shown[0].surgeon, booking.team[0].practitioner_name)
		self.assertEqual(shown[0].procedures, [self.template.name])
		self.assertEqual(shown[0].next_statuses, ("Scheduled", "Postponed", "Cancelled"))
		self.assertTrue(shown[0].procedures_pending)

	def test_a_case_with_its_procedures_created_has_none_pending(self):
		booking = make_booking(self, self.at(9))
		booking.create_clinical_procedures()

		self.assertFalse(self.board()["bookings"][0].procedures_pending)

	def test_a_case_carries_its_patients_age_and_sex_and_fasting(self):
		booking = make_booking(self, self.at(9))
		sex, dob = frappe.db.get_value("Patient", booking.patient, ["sex", "dob"])

		shown = self.board()["bookings"][0]

		self.assertEqual(
			(shown.sex, shown.age, shown.fasting_confirmed), (sex, age_text(dob, self.day), False)
		)

	def test_age_is_in_years_or_in_months_under_a_year(self):
		self.assertEqual(age_text("1980-05-20", "2026-05-19"), "45y")
		self.assertEqual(age_text("2026-01-10", "2026-09-15"), "8m")
		self.assertIsNone(age_text(None, "2026-09-15"))

	def test_cancelled_bookings_and_other_days_are_left_out(self):
		make_booking(self, self.at(9)).db_set("status", "Cancelled")
		self.day = add_days(self.day, 1)
		make_booking(self, self.at(9))
		self.day = add_days(self.day, -1)

		self.assertEqual(self.board()["bookings"], [])

	def night_before(self, hour):
		return get_datetime(f"{add_days(self.day, -1)} {hour:02d}:00:00")

	def test_a_case_from_the_night_before_is_shown(self):
		overnight = create_ot_template("_Test Procedure - Two Hours", duration=2 * HOUR)
		booking = make_booking(self, self.night_before(23), templates=[overnight.name])

		self.assertIn(booking.name, [row.name for row in self.board()["bookings"]])

	def test_a_case_ending_at_midnight_stays_on_its_own_day(self):
		overnight = create_ot_template("_Test Procedure - Two Hours", duration=2 * HOUR)
		booking = make_booking(self, self.night_before(22), templates=[overnight.name])

		self.assertNotIn(booking.name, [row.name for row in self.board()["bookings"]])

	def test_a_block_says_why(self):
		block = create_unavailable_block(self.theatre, "Healthcare Service Unit", self.day)
		block.db_set({"reason": "Training", "note": "Laminar flow service"})

		[shown] = self.board()["blocks"]

		self.assertEqual((shown.reason, shown.note), ("Training", "Laminar flow service"))

	def test_a_blocked_practitioner_is_away(self):
		create_unavailable_block(self.practitioners[0], "Healthcare Practitioner", self.day)

		away = [(row["practitioner"], row["reason"]) for row in self.board()["away"]]

		self.assertIn((self.practitioners[0], "Unavailable"), away)

	@skip_without_hrms
	def test_a_practitioner_on_leave_is_away(self):
		employee = link_new_employee(self, self.practitioners[1])
		create_approved_leave(employee, self.day, self.day, half_day_date=self.day)

		away = [(row["practitioner"], row["reason"]) for row in self.board()["away"]]

		self.assertIn((self.practitioners[1], "Half-day Leave"), away)

	def test_away_rows_name_no_records(self):
		create_unavailable_block(self.practitioners[0], "Healthcare Practitioner", self.day)

		rows = self.board()["away"]

		self.assertTrue(rows)
		self.assertEqual(
			set(rows[0]), {"practitioner", "practitioner_name", "reason", "from_time", "to_time"}
		)

	def test_no_one_is_away_for_a_caller_who_cannot_read_practitioners(self):
		create_unavailable_block(self.practitioners[0], "Healthcare Practitioner", self.day)
		start, end = day_window(getdate(self.day))
		frappe.set_user("test_user@marleyhealth.io")  # a login with no clinical role
		self.addCleanup(frappe.set_user, "Administrator")

		self.assertEqual(get_away(getdate(self.day), start, end, "_Test Company"), [])

	def test_the_theatre_holiday_is_shown(self):
		saved = frappe.db.get_single_value("Healthcare Settings", "ot_holiday_list")
		frappe.db.set_single_value("Healthcare Settings", "ot_holiday_list", create_holiday_list(self.day))
		self.addCleanup(frappe.db.set_single_value, "Healthcare Settings", "ot_holiday_list", saved)

		self.assertEqual(self.board()["holiday"].description, "_Test Holiday")

	def test_the_board_is_read_only_for_a_physician(self):
		self.assertTrue(self.board()["can_edit"])
		frappe.set_user(create_user("_test_ot_physician@example.com", "Physician"))
		self.addCleanup(frappe.set_user, "Administrator")

		self.assertFalse(self.board()["can_edit"])

	def test_an_ot_coordinator_sees_age_and_sex(self):
		make_booking(self, self.at(9))
		frappe.set_user(create_user("_test_ot_coordinator@example.com", "OT Coordinator"))
		self.addCleanup(frappe.set_user, "Administrator")

		shown = self.board()["bookings"][0]

		self.assertTrue(shown.sex)

	def test_another_companys_board_is_refused(self):
		create_unavailable_block(self.theatre, "Healthcare Service Unit", self.day)
		user = create_user("_test_ot_coordinator_elsewhere@example.com", "OT Coordinator")
		other_company = frappe.get_all("Company", filters={"name": ["!=", "_Test Company"]}, pluck="name")[0]
		frappe.get_doc(
			{"doctype": "User Permission", "user": user, "allow": "Company", "for_value": other_company}
		).insert(ignore_permissions=True)
		frappe.set_user(user)
		self.addCleanup(frappe.set_user, "Administrator")

		self.assertRaises(frappe.PermissionError, self.board)

	def test_a_caller_who_cannot_read_patients_gets_no_age_or_sex(self):
		row = frappe._dict(patient=self.patients[0])
		frappe.set_user("test_user@marleyhealth.io")  # a login with no clinical role
		self.addCleanup(frappe.set_user, "Administrator")

		add_patient_details([row], self.day)

		self.assertEqual((row.sex, row.age), (None, None))

	def test_the_board_needs_permission(self):
		frappe.set_user("test_user@marleyhealth.io")  # a login with no clinical role
		self.addCleanup(frappe.set_user, "Administrator")

		self.assertRaises(frappe.PermissionError, self.board)
