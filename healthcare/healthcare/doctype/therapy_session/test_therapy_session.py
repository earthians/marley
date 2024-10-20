# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt


import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import nowdate

from healthcare.healthcare.doctype.therapy_plan.test_therapy_plan import create_therapy_plan


class TestTherapySession(FrappeTestCase):
	def test_exercise_set_from_therapy_type(self):
		plan = create_therapy_plan()
		session = create_therapy_session(plan.patient, "Basic Rehab", plan.name)
		if plan.therapy_plan_details:
			therapy_type = frappe.get_doc("Therapy Type", plan.therapy_plan_details[0].therapy_type)
			self.assertEqual(
				session.exercises[0].exercise_type,
				therapy_type.exercises[0].exercise_type,
			)


def create_therapy_session(patient, therapy_type, therapy_plan, duration=0, start_date=None):
	if not start_date:
		start_date = nowdate()
	therapy_session = frappe.new_doc("Therapy Session")
	therapy_session.patient = patient
	therapy_session.therapy_type = therapy_type
	therapy_session.therapy_plan = therapy_plan
	therapy_session.duration = duration
	therapy_session.start_date = start_date
	therapy_session.save()

	return therapy_session
