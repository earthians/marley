# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, get_datetime, nowdate

from healthcare.healthcare.doctype.ot_booking.same_patient import add_other_cases
from healthcare.healthcare.doctype.ot_booking.test_day_rules import create_user
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

	def test_a_case_the_user_cannot_read_is_not_shown(self):
		shown = make_booking(self, self.at(9))
		elsewhere = make_booking(self, self.at(13), theatre=self.other_theatre, surgeon=1)
		other_company = frappe.get_all("Company", filters={"name": ["!=", "_Test Company"]}, pluck="name")[0]
		elsewhere.db_set("company", other_company)
		self.addCleanup(frappe.set_user, "Administrator")
		frappe.set_user(self.coordinator_of("_Test Company"))
		row = frappe._dict(name=shown.name, patient=shown.patient, scheduled_date=shown.scheduled_date)

		add_other_cases([row])

		self.assertEqual(row.other_cases, [])

	def coordinator_of(self, company):
		user = create_user("_test_ot_coordinator_here@example.com", "OT Coordinator")
		frappe.get_doc(
			{"doctype": "User Permission", "user": user, "allow": "Company", "for_value": company}
		).insert(ignore_permissions=True)
		return user
