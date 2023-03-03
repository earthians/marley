# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt


import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import nowdate


class TestTherapySession(FrappeTestCase):
	pass


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
