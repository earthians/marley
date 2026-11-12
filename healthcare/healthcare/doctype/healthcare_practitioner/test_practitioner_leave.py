# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import unittest

import frappe
from frappe.utils import add_days, nowdate

from healthcare.healthcare.doctype.healthcare_practitioner.practitioner_leave import find_leaves
from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import create_appointment
from healthcare.tests.utils import HealthcareTestSuite

HRMS_INSTALLED = "hrms" in frappe.get_installed_apps()
skip_without_hrms = unittest.skipUnless(HRMS_INSTALLED, "HRMS is not installed")


@skip_without_hrms
class TestPractitionerLeave(HealthcareTestSuite):
	def setUp(self):
		self.practitioner = frappe.get_all("Healthcare Practitioner", pluck="name", limit=1)[0]
		self.employee = link_new_employee(self, self.practitioner)
		self.day = add_days(nowdate(), 900)

	def test_full_leave_is_found(self):
		create_approved_leave(self.employee, self.day, add_days(self.day, 2))

		leaves = find_leaves([self.practitioner], add_days(self.day, 1), add_days(self.day, 1))

		self.assertEqual(
			[(leave.practitioner, leave.is_half_day) for leave in leaves], [(self.practitioner, False)]
		)

	def test_a_half_day_is_marked_only_on_its_own_date(self):
		create_approved_leave(self.employee, self.day, add_days(self.day, 1), half_day_date=self.day)

		self.assertTrue(find_leaves([self.practitioner], self.day, self.day)[0].is_half_day)
		next_day = add_days(self.day, 1)
		self.assertFalse(find_leaves([self.practitioner], next_day, next_day)[0].is_half_day)

	def test_leave_that_is_not_approved_is_ignored(self):
		create_approved_leave(self.employee, self.day, self.day, status="Rejected")

		self.assertEqual(find_leaves([self.practitioner], self.day, self.day), [])

	def test_a_practitioner_without_an_employee_has_no_leave(self):
		frappe.db.set_value("Healthcare Practitioner", self.practitioner, "employee", None)

		self.assertEqual(find_leaves([self.practitioner], self.day, self.day), [])

	def test_leave_in_another_company_is_left_out(self):
		create_approved_leave(self.employee, self.day, self.day, company="_Test Company 1")

		self.assertEqual(find_leaves([self.practitioner], self.day, self.day, "_Test Company"), [])
		self.assertEqual(len(find_leaves([self.practitioner], self.day, self.day)), 1)

	def test_an_appointment_on_a_leave_day_is_refused(self):
		create_approved_leave(self.employee, self.day, self.day)

		self.assertRaisesRegex(frappe.ValidationError, "is on leave", self.make_appointment)

	def test_an_appointment_on_a_half_day_leave_is_allowed(self):
		create_approved_leave(self.employee, self.day, self.day, half_day_date=self.day)

		self.make_appointment()

	def make_appointment(self):
		patient = frappe.get_all("Patient", pluck="name", limit=1)[0]
		return create_appointment(patient, self.practitioner, self.day, appointment_time="10:00:00")


def link_new_employee(test, practitioner):
	saved = frappe.db.get_value("Healthcare Practitioner", practitioner, "employee")
	employee = frappe.get_doc(
		{
			"doctype": "Employee",
			"first_name": "_Test Practitioner Employee",
			"company": "_Test Company",
			"gender": "Female",
			"date_of_birth": "1980-01-01",
			"date_of_joining": "2010-01-01",
		}
	).insert(ignore_permissions=True)
	frappe.db.set_value("Healthcare Practitioner", practitioner, "employee", employee.name)
	test.addCleanup(frappe.db.set_value, "Healthcare Practitioner", practitioner, "employee", saved)
	return employee.name


def create_approved_leave(
	employee, from_date, to_date, half_day_date=None, status="Approved", company="_Test Company"
):
	leave = frappe.get_doc(
		{
			"doctype": "Leave Application",
			"employee": employee,
			"company": company,
			"leave_type": frappe.db.get_value("Leave Type", {}),
			"from_date": from_date,
			"to_date": to_date,
			"half_day": 1 if half_day_date else 0,
			"half_day_date": half_day_date,
			"status": status,
			"docstatus": 1,
		}
	)
	leave.set_new_name()
	leave.db_insert()
	return leave.name
