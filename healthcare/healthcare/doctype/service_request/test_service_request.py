# -*- coding: utf-8 -*-
# Copyright (c) 2020, earthians and Contributors
# See license.txt
from __future__ import unicode_literals

import frappe
import unittest
from frappe.utils import getdate, nowtime

from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import (
	create_healthcare_docs,
	create_medical_department,
)

from healthcare.healthcare.doctype.lab_test.test_lab_test import (
	create_lab_test_template, create_practitioner, create_lab_test
)

from healthcare.healthcare.doctype.patient_medical_record.test_patient_medical_record import (
	create_lab_test_template as create_blood_test_template,
)

class TestServiceRequest(unittest.TestCase):
	def test_creation_on_encounter_submission(self):
		patient, practitioner = create_healthcare_docs()
		medical_department = create_medical_department()
		insulin_resistance_template = create_lab_test_template()
		encounter = create_encounter(patient, medical_department, practitioner, insulin_resistance_template)
		self.assertTrue(frappe.db.exists("Service Request", {"order_group": encounter.name}))
		service_request = frappe.db.get_value('Service Request', {'order_group':encounter.name}, 'name')
		if service_request:
			service_request_doc = frappe.get_doc('Service Request', service_request)
			service_request_doc.submit()
			lab_test = create_lab_test(insulin_resistance_template)
			lab_test.service_request = service_request
			lab_test.descriptive_test_items[0].result_value = 1
			lab_test.descriptive_test_items[1].result_value = 2
			lab_test.descriptive_test_items[2].result_value = 3
			lab_test.submit()


def create_encounter(patient, medical_department, practitioner, insulin_resistance_template):
	patient_encounter = frappe.new_doc('Patient Encounter')
	patient_encounter.patient = patient
	patient_encounter.practitioner = practitioner
	patient_encounter.encounter_date = getdate()
	patient_encounter.encounter_time = nowtime()

	patient_encounter.append('lab_test_prescription', {
		'lab_test_code': insulin_resistance_template.item,
		'lab_test_name': insulin_resistance_template.lab_test_name
	})

	patient_encounter.submit()
	return patient_encounter
