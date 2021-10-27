import unittest
from pprint import pprint

import frappe
from erpnext.tests.utils import ERPNextTestCase
from frappe import DuplicateEntryError
from frappe.utils import add_months, getdate

from healthcare.healthcare.report.diagnosis_trends.diagnosis_trends import execute
from healthcare.healthcare.test_utils import create_encounter

months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


class TestDiagnosisTrends(ERPNextTestCase):
	@classmethod
	def setUpClass(cls):
		cls.create_diagnosis()

	@classmethod
	def create_diagnosis(cls):
		medical_department = frappe.get_doc({
			'doctype': 'Medical Department',
			'department': 'Cardiology'
		})
		try:
			medical_department.insert()
		except:
			pass

		patient = frappe.get_list('Patient')[0]
		practitioner = frappe.get_list('Healthcare Practitioner')[0]

		encounter_cardiology = create_encounter(
			patient=patient.name,
			medical_department=medical_department,
			practitioner=practitioner.name,
		)
		d = encounter = frappe.get_list('Patient Encounter'
										# filters={'medical_department': medical_department}
										)
		print(d)
		
		print(encounter_cardiology.encounter_date)
		print(encounter_cardiology.name)

		try:
			cls.diagnosis = frappe.get_doc({
				'doctype': 'Diagnosis',
				'diagnosis': 'Fever',
			})
			cls.diagnosis.insert()
		except DuplicateEntryError:
			pass

		try:
			cls.diagnosis_cardio = frappe.get_doc({
				'doctype': 'Diagnosis',
				'diagnosis': 'Heart Attack',
			})
			cls.diagnosis_cardio.insert()
		except DuplicateEntryError:
			pass

		try:
			diagnosis = frappe.get_doc({
				'doctype': 'Patient Encounter Diagnosis',
				'diagnosis': 'Fever',
				'parent': encounter,
				'parenttype': 'Patient Encounter',
			})
			diagnosis.insert()
		except ValueError:
			pass

		try:
			diagnosis = frappe.get_doc({
				'doctype': 'Patient Encounter Diagnosis',
				'diagnosis': 'Heart Attack',
				'parent': encounter_cardiology.name,
				'parenttype': 'Patient Encounter',
			})
			diagnosis.insert()
		except ValueError:
			pass

		data = frappe.get_list('Patient Encounter Diagnosis', fields=['name', 'parent'])
		# print(data)

	def test_report_data(self):
		filters = {
			'from_date': str(add_months(getdate(), -12)),
			'to_date': str(getdate()),
			'range': 'Monthly',
		}
		report = execute(filters)
		data = [i['diagnosis'] for i in report[1]]
		self.assertIn(self.diagnosis.diagnosis, data)

	def test_report_data_with_filters(self):
		medical_department = frappe.get_doc('Medical Department', 'Cardiology')

		filters = {
			'from_date': str(add_months(getdate(), -12)),
			'to_date': str(getdate()),
			'range': 'Monthly',
			'department': medical_department.name,
		}
		report = execute(filters)
		# pprint(report)

		data = [i['diagnosis'] for i in report[1]]
		print(data)

		self.assertIn(self.diagnosis_cardio.diagnosis, data)
