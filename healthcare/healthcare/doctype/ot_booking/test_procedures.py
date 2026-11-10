# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, add_to_date, get_datetime, nowdate

from healthcare.healthcare.doctype.ot_booking.ot_booking import make_ot_booking
from healthcare.healthcare.doctype.ot_booking.priority import priority_named
from healthcare.healthcare.doctype.ot_booking.test_day_rules import create_user
from healthcare.healthcare.doctype.ot_booking.test_ot_booking import (
	HOUR,
	create_ot_template,
	create_service_request,
	create_theatre,
	make_booking,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestProcedures(HealthcareTestSuite):
	def setUp(self):
		self.patients = frappe.get_all("Patient", pluck="name", limit=2)
		self.practitioners = frappe.get_all("Healthcare Practitioner", pluck="name", limit=2)
		self.theatre = create_theatre("_Test OT 1", "_Test General OT")
		self.other_theatre = create_theatre("_Test OT 2", "_Test General OT")
		self.template = create_ot_template("_Test Procedure - Hernia Repair", duration=HOUR)
		test_names = sorted(name for name in dir(self) if name.startswith("test_"))
		self.day = add_days(nowdate(), 400 + test_names.index(self._testMethodName))

	def at(self, hour):
		return get_datetime(f"{self.day} {hour:02d}:00:00")

	def from_request(self, priority=None):
		request = create_service_request(self.patients[0], self.practitioners[0])
		if priority:
			request.db_set("priority", priority_named(priority))
		booking = make_ot_booking(request.name)
		booking.update({"theatre": self.theatre, "scheduled_start": self.at(9)})
		return booking.insert()

	def first_procedure(self, booking):
		return frappe.get_doc("Clinical Procedure", booking.create_clinical_procedures()[0])

	def submitted(self, booking):
		procedure = self.first_procedure(booking)
		procedure.submit()
		booking.reload()
		return procedure

	def test_procedures_follow_each_other_in_the_booked_theatre(self):
		second = create_ot_template("_Test Procedure - Mesh Fixation", duration=HOUR // 2)
		booking = make_booking(self, self.at(9), templates=[self.template.name, second.name])

		first, following = (
			frappe.get_doc("Clinical Procedure", n) for n in booking.create_clinical_procedures()
		)

		self.assertEqual((first.service_unit, first.ot_booking), (self.theatre, booking.name))
		self.assertEqual((start_of(first), start_of(following)), (self.at(9), self.at(10)))
		self.assertEqual(get_datetime(following.planned_end_datetime), add_to_date(self.at(10), minutes=30))
		self.assertEqual(following.practitioner, self.practitioners[0])

	def test_a_procedure_from_a_request_carries_the_request_and_its_priority(self):
		booking = self.from_request("STAT")

		procedure = self.first_procedure(booking)

		self.assertEqual(procedure.service_request, booking.procedures[0].service_request)
		self.assertEqual(procedure.priority, priority_named("STAT"))

	def test_procedures_are_made_once_and_from_the_saved_booking(self):
		booking = make_booking(self, self.at(9))
		booking.scheduled_start = self.at(13)  # an edit the form has not saved

		self.assertEqual(str(self.first_procedure(booking).start_time), "9:00:00")
		self.assertEqual(booking.create_clinical_procedures(), [])

	def test_a_procedure_keeps_its_booked_duration_when_submitted(self):
		booking = make_booking(self, self.at(9))
		booking.procedures[0].duration = 2 * HOUR
		booking.save()

		self.assertEqual(get_datetime(self.submitted(booking).planned_end_datetime), self.at(11))

	def test_a_draft_procedure_follows_the_case_its_theatre_store_and_surgeon(self):
		store = self.theatre_store()
		booking = make_booking(self, self.at(9))
		procedure = self.first_procedure(booking).name
		self.assertEqual(frappe.db.get_value("Clinical Procedure", procedure, "warehouse"), store)
		booking.reload()

		booking.update({"theatre": self.other_theatre, "scheduled_start": self.at(13)})
		booking.team[0].practitioner = self.practitioners[1]
		booking.save()

		moved = frappe.get_doc("Clinical Procedure", procedure)
		self.assertEqual((moved.service_unit, start_of(moved)), (self.other_theatre, self.at(13)))
		surgeon_name = frappe.db.get_value(
			"Healthcare Practitioner", self.practitioners[1], "practitioner_name"
		)
		self.assertEqual((moved.practitioner, moved.practitioner_name), (self.practitioners[1], surgeon_name))
		company_store = frappe.db.get_value("Company", booking.company, "default_warehouse")
		self.assertEqual(moved.warehouse, company_store)  # the new theatre has no store of its own

	def test_a_submitted_procedure_keeps_its_theatre_times_and_surgeon(self):
		booking = make_booking(self, self.at(9))
		self.submitted(booking)
		changes = [
			{"scheduled_start": self.at(13), "change_reason": "Surgeon delayed"},
			{"theatre": self.other_theatre},
		]
		for change in changes:
			booking.reload()
			booking.update(change)
			self.assertRaisesRegex(frappe.ValidationError, "cannot change", booking.save)
		booking.reload()
		booking.team[0].practitioner = self.practitioners[1]
		self.assertRaisesRegex(frappe.ValidationError, "cannot change", booking.save)
		booking.reload()
		booking.procedures[0].duration = 2 * HOUR
		self.assertRaisesRegex(frappe.ValidationError, "cannot change", booking.save)

	def test_a_case_with_a_submitted_procedure_cannot_stop(self):
		booking = make_booking(self, self.at(9))
		self.submitted(booking)
		booking.status = "Cancelled"

		self.assertRaisesRegex(frappe.ValidationError, "already submitted", booking.save)

	def test_a_row_with_a_procedure_keeps_it_and_stays(self):
		booking = make_booking(self, self.at(9))
		booking.create_clinical_procedures()
		booking.procedures[0].procedure_template = create_ot_template("_Test Procedure - Other", HOUR).name
		self.assertRaisesRegex(frappe.ValidationError, "procedure cannot change", booking.save)

		booking.reload()
		booking.procedures = []
		booking.append("procedures", {"procedure_template": self.template.name})
		self.assertRaisesRegex(frappe.ValidationError, "cannot be removed", booking.save)

	def test_a_cancelled_procedure_is_kept_and_frees_its_case(self):
		booking = self.from_request()
		cancelled = self.submitted(booking)
		cancelled.cancel()
		booking.reload()

		booking.update({"scheduled_start": self.at(13), "change_reason": "Patient unwell"})
		booking.save()  # it can move
		made = booking.create_clinical_procedures()  # and its row gets a new procedure

		self.assertEqual(len(made), 1)
		self.assertEqual(frappe.db.get_value("Clinical Procedure", cancelled.name, "docstatus"), 2)

	def test_an_amended_procedure_takes_its_rows_place(self):
		booking = make_booking(self, self.at(9))
		cancelled = self.submitted(booking)
		cancelled.cancel()

		amended = frappe.copy_doc(cancelled)  # as Amend copies it, no-copy fields included
		amended.update({"amended_from": cancelled.name, "docstatus": 0})
		amended.insert()

		self.assertEqual(amended.ot_booking_row, booking.procedures[0].name)
		self.assertEqual(booking.create_clinical_procedures(), [])

	def test_a_duplicated_procedure_is_not_the_cases(self):
		booking = make_booking(self, self.at(9))
		duplicate = frappe.copy_doc(self.first_procedure(booking), ignore_no_copy=False)

		duplicate.insert()

		self.assertEqual((duplicate.ot_booking, duplicate.ot_booking_row), (None, None))

	def test_a_stopped_case_gives_up_its_drafts_and_keeps_its_request(self):
		booking = self.from_request()
		procedure = self.first_procedure(booking).name
		booking.reload()

		booking.status = "Postponed"
		booking.save()

		self.assertFalse(frappe.db.exists("Clinical Procedure", procedure))
		self.assertRaisesRegex(
			frappe.ValidationError, "already booked", make_ot_booking, booking.procedures[0].service_request
		)

	def test_a_withdrawn_request_makes_no_procedure(self):
		booking = self.from_request()
		frappe.db.set_value(
			"Service Request", booking.procedures[0].service_request, "status", "revoked-Request Status"
		)

		self.assertRaisesRegex(frappe.ValidationError, "no longer active", booking.create_clinical_procedures)

	def test_no_procedures_for_a_cancelled_case(self):
		booking = make_booking(self, self.at(9))
		booking.db_set("status", "Cancelled")

		self.assertRaises(frappe.ValidationError, booking.create_clinical_procedures)

	def test_an_ot_coordinator_can_make_procedures_and_no_one_else(self):
		booking = make_booking(self, self.at(9))
		self.addCleanup(frappe.set_user, "Administrator")
		frappe.set_user(create_user("_test_ot_coordinator@example.com", "OT Coordinator"))
		self.assertTrue(booking.create_clinical_procedures())

		frappe.set_user("test_user@marleyhealth.io")  # a login with no clinical role
		self.assertRaises(frappe.PermissionError, booking.create_clinical_procedures)

	def theatre_store(self):
		"""A store of the company other than its default, given to the first theatre"""
		default = frappe.db.get_value("Company", "_Test Company", "default_warehouse")
		store = frappe.get_all(
			"Warehouse",
			filters={"company": "_Test Company", "is_group": 0, "name": ["!=", default]},
			pluck="name",
			limit=1,
		)[0]
		frappe.db.set_value("Healthcare Service Unit", self.theatre, "warehouse", store)
		frappe.db.set_value("Healthcare Service Unit", self.other_theatre, "warehouse", None)
		return store


def start_of(procedure):
	return get_datetime(f"{procedure.start_date} {procedure.start_time}")
