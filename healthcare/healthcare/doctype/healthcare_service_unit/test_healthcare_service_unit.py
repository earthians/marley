# -*- coding: utf-8 -*-
# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
import frappe
from frappe.tests.utils import FrappeTestCase


class TestHealthcareServiceUnit(FrappeTestCase):
	def test_create_company_should_create_root_service_unit(self):
		company = frappe.get_doc({
			'doctype': 'Company',
			'company_name': 'Test Hospital',
			'country': 'India',
			'default_currency': 'INR'
		})
		try:
			company = company.insert()
		except frappe.exceptions.DuplicateEntryError:
			pass
		filters = {
			'company': company.name,
			'parent_healthcare_service_unit': None
		}
		root_service_unit = frappe.db.exists('Healthcare Service Unit', filters)
		self.assertTrue(root_service_unit)
