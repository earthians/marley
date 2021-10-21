import unittest

import frappe
from frappe import DuplicateEntryError
from frappe.utils import add_months, getdate

from healthcare.healthcare.report.diagnosis_trends.diagnosis_trends import execute

months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


class TestDiagnosisTrends(unittest.TestCase):
	@classmethod
	def setUpClass(self):
		self.create_diagnosis()

	@classmethod
	def create_diagnosis(cls):
		try:
			diagnosis = frappe.get_doc({
				'doctype': 'Diagnosis',
				'diagnosis': 'Fever',
			})
			diagnosis.insert()
		except DuplicateEntryError:
			pass
		encounter = frappe.get_list('Patient Encounter')[0]

		diagnosis = frappe.get_doc({
			'doctype': 'Patient Encounter Diagnosis',
			'diagnosis': 'Fever',
			'parent': encounter,
			'parenttype': 'Patient Encounter',
		})
		try:
			diagnosis.insert()
		except ValueError:
			pass

	def test_diagnosis_analytics(self):
		self.compare_result_for_customer()
		self.compare_result_for_Diagnosis_type()
		self.compare_result_for_Diagnosis_priority()
		self.compare_result_for_assignment()

	def compare_result_for_customer(self):
		filters = {
			'from_date': str(add_months(getdate(), -12)),
			'to_date': str(getdate()),
			'range': 'Monthly',
		}
		report = execute(filters)

		expected_data = [
			{
				'customer': '__Test Customer 2',
				self.last_month: 1.0,
				self.current_month: 0.0,
				'total': 1.0
			},
			{
				'customer': '__Test Customer 1',
				self.last_month: 0.0,
				self.current_month: 1.0,
				'total': 1.0
			},
			{
				'customer': '__Test Customer',
				self.last_month: 1.0,
				self.current_month: 1.0,
				'total': 2.0
			}
		]

		self.assertEqual(expected_data, report[1]) # rows
		self.assertEqual(len(report[0]), 4) # cols

	def compare_result_for_Diagnosis_type(self):
		filters = {
			'company': '_Test Company',
			'based_on': 'Diagnosis Type',
			'from_date': add_months(getdate(), -1),
			'to_date': getdate(),
			'range': 'Monthly'
		}

		report = execute(filters)

		expected_data = [
			{
				'Diagnosis_type': 'Discomfort',
				self.last_month: 1.0,
				self.current_month: 0.0,
				'total': 1.0
			},
			{
				'Diagnosis_type': 'Service Request',
				self.last_month: 0.0,
				self.current_month: 1.0,
				'total': 1.0
			},
			{
				'Diagnosis_type': 'Bug',
				self.last_month: 1.0,
				self.current_month: 1.0,
				'total': 2.0
			}
		]

		self.assertEqual(expected_data, report[1]) # rows
		self.assertEqual(len(report[0]), 4) # cols

	def compare_result_for_Diagnosis_priority(self):
		filters = {
			'company': '_Test Company',
			'based_on': 'Diagnosis Priority',
			'from_date': add_months(getdate(), -1),
			'to_date': getdate(),
			'range': 'Monthly'
		}

		report = execute(filters)

		expected_data = [
			{
				'priority': 'Medium',
				self.last_month: 1.0,
				self.current_month: 1.0,
				'total': 2.0
			},
			{
				'priority': 'Low',
				self.last_month: 1.0,
				self.current_month: 0.0,
				'total': 1.0
			},
			{
				'priority': 'High',
				self.last_month: 0.0,
				self.current_month: 1.0,
				'total': 1.0
			}
		]

		self.assertEqual(expected_data, report[1]) # rows
		self.assertEqual(len(report[0]), 4) # cols

	def compare_result_for_assignment(self):
		filters = {
			'company': '_Test Company',
			'based_on': 'Assigned To',
			'from_date': add_months(getdate(), -1),
			'to_date': getdate(),
			'range': 'Monthly'
		}

		report = execute(filters)

		expected_data = [
			{
				'user': 'test@example.com',
				self.last_month: 1.0,
				self.current_month: 1.0,
				'total': 2.0
			},
			{
				'user': 'test1@example.com',
				self.last_month: 2.0,
				self.current_month: 1.0,
				'total': 3.0
			}
		]

		self.assertEqual(expected_data, report[1]) # rows
		self.assertEqual(len(report[0]), 4) # cols
