# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, add_to_date, get_datetime, now_datetime, nowdate

from healthcare.healthcare.doctype.ot_booking.priority import priority_named
from healthcare.healthcare.doctype.ot_booking.test_ot_booking import (
	HOUR,
	create_ot_template,
	create_theatre,
	make_booking,
)
from healthcare.tests.utils import HealthcareTestSuite

FASTING_SETTINGS = ("ot_fasting_activity", "ot_fasting_hours")


class TestFasting(HealthcareTestSuite):
	def setUp(self):
		self.patients = frappe.get_all("Patient", pluck="name", limit=1)
		self.practitioners = frappe.get_all("Healthcare Practitioner", pluck="name", limit=1)
		self.theatre = create_theatre("_Test OT 1", "_Test General OT")
		self.template = create_ot_template("_Test Procedure - Hernia Repair", duration=HOUR)
		frappe.db.set_value(
			"Clinical Procedure Template", self.template.name, {"requires_fasting": 1, "fasting_hours": 0}
		)
		test_names = sorted(name for name in dir(self) if name.startswith("test_"))
		self.day = add_days(nowdate(), 1500 + test_names.index(self._testMethodName))
		self.use_fasting(create_activity("_Test Nil by Mouth"), 6)

	def use_fasting(self, activity, hours):
		saved = {
			field: frappe.db.get_single_value("Healthcare Settings", field) for field in FASTING_SETTINGS
		}
		frappe.db.set_single_value(
			"Healthcare Settings", {"ot_fasting_activity": activity, "ot_fasting_hours": hours}
		)
		self.addCleanup(frappe.db.set_single_value, "Healthcare Settings", saved)

	def at(self, hour):
		return get_datetime(f"{self.day} {hour:02d}:00:00")

	def scheduled(self, hour=9):
		booking = make_booking(self, self.at(hour))
		change_status(booking, "Scheduled")
		booking.reload()
		return booking

	def confirmed(self, booking):
		return frappe.get_doc("OT Booking", booking.name).fasting_confirmed

	def complete_task(self, booking):
		task = frappe.get_doc("Nursing Task", self.tasks(booking)[0].name)
		task.status = "Completed"
		task.save()
		return task

	def tasks(self, booking, status=None):
		filters = {"reference_doctype": "OT Booking", "reference_name": booking.name}
		if status:
			filters["status"] = status
		return frappe.get_all(
			"Nursing Task", filters=filters, fields=["name", "status", "requested_start_time"]
		)

	def test_a_scheduled_case_sends_the_ward_a_fasting_task_before_it(self):
		booking = self.scheduled(hour=9)

		[task] = self.tasks(booking)

		self.assertEqual(task.status, "Requested")
		self.assertEqual(get_datetime(task.requested_start_time), add_to_date(self.at(9), hours=-6))

	def test_a_tentative_case_sends_no_task(self):
		booking = make_booking(self, self.at(9))

		self.assertEqual(self.tasks(booking), [])

	def test_moving_the_case_replaces_its_task(self):
		booking = self.scheduled(hour=9)
		booking.update({"scheduled_start": self.at(13), "change_reason": "Surgeon delayed"})
		booking.save()

		[open_task] = self.tasks(booking, "Requested")

		self.assertEqual(get_datetime(open_task.requested_start_time), add_to_date(self.at(13), hours=-6))
		self.assertEqual(len(self.tasks(booking, "Cancelled")), 1)

	def test_postponing_the_case_cancels_its_task(self):
		booking = self.scheduled()

		change_status(booking, "Postponed", "Patient unwell")

		self.assertEqual([task.status for task in self.tasks(booking)], ["Cancelled"])

	def test_completing_the_task_confirms_fasting(self):
		booking = self.scheduled()

		self.complete_task(booking)

		self.assertTrue(self.confirmed(booking))

	def test_a_procedure_that_needs_no_fasting_sends_no_task(self):
		frappe.db.set_value("Clinical Procedure Template", self.template.name, "requires_fasting", 0)

		booking = self.scheduled()

		self.assertEqual(self.tasks(booking), [])

	def test_the_longest_fasting_of_the_cases_procedures_wins(self):
		frappe.db.set_value("Clinical Procedure Template", self.template.name, "fasting_hours", 8)

		booking = self.scheduled(hour=9)

		[task] = self.tasks(booking)
		self.assertEqual(get_datetime(task.requested_start_time), add_to_date(self.at(9), hours=-8))

	def test_a_longer_fasting_replaces_the_task_and_clears_its_confirmation(self):
		booking = self.scheduled(hour=9)
		self.complete_task(booking)
		frappe.db.set_value("Clinical Procedure Template", self.template.name, "fasting_hours", 8)

		booking.reload()
		booking.save()

		[task] = self.tasks(booking, "Requested")
		self.assertEqual(get_datetime(task.requested_start_time), add_to_date(self.at(9), hours=-8))
		self.assertFalse(self.confirmed(booking))

	def test_a_missed_task_is_cancelled_when_the_case_moves(self):
		booking = self.scheduled(hour=9)
		missed = self.tasks(booking)[0].name
		frappe.db.set_value("Nursing Task", missed, "status", "Missed")
		booking.update({"scheduled_start": self.at(13), "change_reason": "Surgeon delayed"})

		booking.save()

		self.assertEqual(frappe.db.get_value("Nursing Task", missed, "status"), "Cancelled")

	def test_an_out_of_date_task_does_not_confirm_fasting(self):
		booking = self.scheduled(hour=9)
		frappe.db.set_value("Clinical Procedure Template", self.template.name, "fasting_hours", 8)

		self.complete_task(booking)

		self.assertFalse(self.confirmed(booking))

	def test_starting_the_procedure_cancels_the_fasting_task(self):
		booking = self.scheduled(hour=9)
		procedure = frappe.get_doc("Clinical Procedure", booking.create_clinical_procedures()[0])
		procedure.submit()

		procedure.start_procedure()

		self.assertEqual([task.status for task in self.tasks(booking)], ["Cancelled"])

	def test_a_task_made_after_its_fasting_began_still_confirms(self):
		start = add_to_date(now_datetime().replace(second=0, microsecond=0), hours=2)
		booking = make_booking(self, start, priority=priority_named("STAT"))
		change_status(booking, "Scheduled")
		booking.reload()
		task = self.complete_task(booking)
		booking.reload()
		booking.save()

		self.assertTrue(self.confirmed(booking))
		self.assertEqual([row.name for row in self.tasks(booking)], [task.name])

	def test_a_postponed_case_loses_its_task_after_fasting_is_switched_off(self):
		booking = self.scheduled()
		self.use_fasting(None, 6)

		change_status(booking, "Postponed", "Patient unwell")

		self.assertEqual([task.status for task in self.tasks(booking)], ["Cancelled"])

	def test_no_task_without_a_fasting_activity(self):
		self.use_fasting(None, 6)

		booking = self.scheduled()

		self.assertEqual(self.tasks(booking), [])


def create_activity(name):
	if not frappe.db.exists("Healthcare Activity", name):
		frappe.get_doc({"doctype": "Healthcare Activity", "activity": name}).insert()
	return name


def change_status(booking, status, reason=None):
	booking.reload()
	booking.update({"status": status, "change_reason": reason})
	booking.save()
