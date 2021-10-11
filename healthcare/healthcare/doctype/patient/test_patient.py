# -*- coding: utf-8 -*-
# Copyright (c) 2015, ESS LLP and Contributors
# See license.txt
from __future__ import unicode_literals

import unittest

import frappe

from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import create_patient


class TestPatient(unittest.TestCase):
	def test_customer_created(self):
		frappe.db.sql("""delete from `tabPatient`""")
		frappe.db.set_value('Healthcare Settings', None, 'link_customer_to_patient', 1)
		patient = create_patient()
		self.assertTrue(frappe.db.get_value('Patient', patient, 'customer'))

	def test_patient_registration(self):
		frappe.db.sql("""delete from `tabPatient`""")
		settings = frappe.get_single('Healthcare Settings')
		settings.collect_registration_fee = 1
		settings.registration_fee = 500
		settings.save()

		patient = create_patient()
		patient = frappe.get_doc('Patient', patient)
		self.assertEqual(patient.status, 'Disabled')

		# check sales invoice and patient status
		result = patient.invoice_patient_registration()
		self.assertTrue(frappe.db.exists('Sales Invoice', result.get('invoice')))
		self.assertTrue(patient.status, 'Active')

		settings.collect_registration_fee = 0
		settings.save()

	def test_patient_image_update_should_update_customer_image(self):
		settings = frappe.get_single('Healthcare Settings')
		settings.link_customer_to_patient = 1
		settings.save()

		patient_name = create_patient()
		patient = frappe.get_doc('Patient', patient_name)
		patient.image = '/files/bar.png'
		patient.save()

		customer = frappe.get_doc('Customer', patient.customer)
		assert customer.image == patient.image
