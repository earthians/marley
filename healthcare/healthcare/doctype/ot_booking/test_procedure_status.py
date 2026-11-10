# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, get_datetime, nowdate

from healthcare.healthcare.doctype.ot_booking.board import get_board
from healthcare.healthcare.doctype.ot_booking.test_ot_booking import (
	HOUR,
	create_ot_template,
	create_theatre,
	make_booking,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestProcedureStatus(HealthcareTestSuite):
	def setUp(self):
		self.patients = frappe.get_all("Patient", pluck="name", limit=1)
		self.practitioners = frappe.get_all("Healthcare Practitioner", pluck="name", limit=1)
		self.theatre = create_theatre("_Test OT 1", "_Test General OT")
		self.template = create_ot_template("_Test Procedure - Hernia Repair", duration=HOUR)
		self.second = create_ot_template("_Test Procedure - Mesh Fixation", duration=HOUR // 2)
		test_names = sorted(name for name in dir(self) if name.startswith("test_"))
		self.day = add_days(nowdate(), 1600 + test_names.index(self._testMethodName))

	def booking_with_procedures(self, status="Scheduled"):
		start = get_datetime(f"{self.day} 09:00:00")
		booking = make_booking(self, start, templates=[self.template.name, self.second.name])
		booking.db_set("status", "Scheduled")
		names = booking.create_clinical_procedures()
		booking.db_set("status", status)
		return booking, [submitted(name) for name in names]

	def status(self, booking):
		return frappe.db.get_value("OT Booking", booking.name, "status")

	def test_starting_a_procedure_starts_the_case(self):
		booking, (first, _second) = self.booking_with_procedures()

		first.start_procedure()

		self.assertEqual(self.status(booking), "In Progress")

	def test_the_case_stays_in_progress_until_every_procedure_is_completed(self):
		booking, (first, second) = self.booking_with_procedures()
		first.start_procedure()
		first.complete_procedure()

		self.assertEqual(self.status(booking), "In Progress")

		second.start_procedure()
		second.complete_procedure()

		self.assertEqual(self.status(booking), "Completed")

	def test_a_postponed_case_is_left_alone(self):
		booking, (first, _second) = self.booking_with_procedures(status="Postponed")

		first.start_procedure()

		self.assertEqual(self.status(booking), "Postponed")

	def test_the_case_never_moves_backwards(self):
		booking, (first, _second) = self.booking_with_procedures(status="Completed")

		first.start_procedure()

		self.assertEqual(self.status(booking), "Completed")

	def started_then_cancelled(self):
		booking, procedures = self.booking_with_procedures()
		procedures[0].start_procedure()
		for procedure in procedures:
			procedure.reload()
			procedure.cancel()
		return frappe.get_doc("OT Booking", booking.name)

	def test_a_started_case_whose_procedures_are_cancelled_can_be_cancelled(self):
		booking = self.started_then_cancelled()
		self.assertEqual(booking.status, "In Progress")
		booking.update({"status": "Cancelled", "change_reason": "Patient unfit for surgery"})

		booking.save()

		self.assertEqual(self.status(booking), "Cancelled")

	def test_cancelling_a_started_case_needs_a_reason(self):
		booking = self.started_then_cancelled()
		booking.status = "Cancelled"

		self.assertRaisesRegex(frappe.ValidationError, "Change Reason", booking.save)

	def test_a_started_case_with_a_procedure_under_way_cannot_be_cancelled(self):
		booking, (first, _second) = self.booking_with_procedures()
		first.start_procedure()
		booking.reload()
		booking.update({"status": "Cancelled", "change_reason": "Patient unfit for surgery"})

		self.assertRaisesRegex(frappe.ValidationError, "already submitted", booking.save)

	def test_the_board_offers_cancel_once_the_started_cases_procedures_are_cancelled(self):
		booking, (first, second) = self.booking_with_procedures()
		first.start_procedure()
		self.assertNotIn("Cancelled", self.next_statuses(booking))

		for procedure in (first, second):
			procedure.reload()
			procedure.cancel()

		self.assertIn("Cancelled", self.next_statuses(booking))

	def next_statuses(self, booking):
		bookings = get_board(str(self.day), "_Test Company")["bookings"]
		return next(row.next_statuses for row in bookings if row.name == booking.name)


def submitted(procedure):
	doc = frappe.get_doc("Clinical Procedure", procedure)
	doc.submit()
	return doc
