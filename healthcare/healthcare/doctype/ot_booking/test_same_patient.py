# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, get_datetime, nowdate

from healthcare.healthcare.doctype.ot_booking.test_ot_booking import (
	HOUR,
	create_ot_template,
	create_theatre,
	make_booking,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestSamePatient(HealthcareTestSuite):
	def setUp(self):
		self.patients = frappe.get_all("Patient", pluck="name", limit=3)
		self.practitioners = frappe.get_all("Healthcare Practitioner", pluck="name", limit=3)
		self.theatre = create_theatre("_Test OT 1", "_Test General OT")
		self.other_theatre = create_theatre("_Test OT 2", "_Test General OT")
		self.template = create_ot_template("_Test Procedure - Hernia Repair", duration=HOUR)
		test_names = sorted(name for name in dir(self) if name.startswith("test_"))
		self.day = add_days(nowdate(), 2900 + test_names.index(self._testMethodName))
		frappe.local.message_log = []

	def at(self, hour):
		return get_datetime(f"{self.day} {hour:02d}:00:00")

	def warnings(self):
		return [str(entry) for entry in frappe.local.message_log if "already has a case" in str(entry)]

	def test_a_second_case_for_the_patient_warns(self):
		make_booking(self, self.at(9))
		frappe.local.message_log = []

		make_booking(self, self.at(13), theatre=self.other_theatre, surgeon=1)

		self.assertEqual(len(self.warnings()), 1)

	def test_another_patients_case_does_not_warn(self):
		make_booking(self, self.at(9))

		make_booking(self, self.at(13), theatre=self.other_theatre, patient=1, surgeon=1)

		self.assertFalse(self.warnings())

	def test_saving_without_a_move_does_not_warn_again(self):
		make_booking(self, self.at(9))
		second = make_booking(self, self.at(13), theatre=self.other_theatre, surgeon=1)
		frappe.local.message_log = []

		second.save()

		self.assertFalse(self.warnings())
