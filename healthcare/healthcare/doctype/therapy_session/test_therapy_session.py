# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt


import frappe

from healthcare.healthcare.doctype.therapy_session.therapy_session import invoice_therapy_session
from healthcare.tests.factories.encounters import create_therapy_plan, create_therapy_session
from healthcare.tests.utils import HealthcareTestSuite


class TestTherapySession(HealthcareTestSuite):
	def test_invoice_preserves_default_naming_series(self):
		default_series = frappe.new_doc("Sales Invoice").naming_series
		self.assertTrue(default_series)

		plan = create_therapy_plan()
		session = create_therapy_session(plan.patient, "Basic Rehab", plan.name)
		self.assertNotEqual(session.naming_series, default_series)
		session.submit()

		invoice = invoice_therapy_session(session.name)

		self.assertEqual(invoice.naming_series, default_series)

	def test_invoice_copies_practitioner(self):
		plan = create_therapy_plan()
		session = create_therapy_session(plan.patient, "Basic Rehab", plan.name)
		session.practitioner = plan.practitioner
		session.save()
		session.submit()

		invoice = invoice_therapy_session(session.name)

		self.assertTrue(session.practitioner)
		self.assertEqual(invoice.ref_practitioner, session.practitioner)
		self.assertEqual(invoice.docstatus, 0)
		self.assertTrue(invoice.is_new())

	def test_exercise_set_from_therapy_type(self):
		plan = create_therapy_plan()
		session = create_therapy_session(plan.patient, "Basic Rehab", plan.name)
		if plan.therapy_plan_details:
			therapy_type = frappe.get_doc("Therapy Type", plan.therapy_plan_details[0].therapy_type)
			self.assertEqual(
				session.exercises[0].exercise_type,
				therapy_type.exercises[0].exercise_type,
			)
