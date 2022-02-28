import frappe
from frappe.tests.utils import FrappeTestCase
from frappe import DuplicateEntryError
from frappe.utils import add_months, getdate, add_days
from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import create_practitioner

from healthcare.healthcare.report.diagnosis_trends.diagnosis_trends import execute
from healthcare.healthcare.test_utils import create_encounter

months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


class TestDiagnosisTrends(FrappeTestCase):
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
		except DuplicateEntryError:
			pass

		patient = frappe.get_list('Patient')[0]
		practitioner_name = create_practitioner(medical_department=medical_department.name)
		encounter_cardiology = create_encounter(
			patient=patient.name,
			practitioner=practitioner_name,
		)
		encounter = frappe.get_list(
			'Patient Encounter',
		)[0]

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

		encounter = frappe.get_doc('Patient Encounter', encounter['name'])
		encounter.append(
			'diagnosis',
			{
				'diagnosis': 'Fever',
			}
		)
		encounter.save()

		encounter_cardiology.reload()
		encounter_cardiology.append(
			'diagnosis',
			{
				'diagnosis': 'Heart Attack',
			}
		)
		encounter_cardiology.save()

	def test_report_data(self):
		filters = {
			'from_date': str(add_months(getdate(), -12)),
			'to_date': str(add_days(getdate(), 1)),
			'range': 'Monthly',
		}

		report = execute(filters)
		data = [i['diagnosis'] for i in report[1]]
		self.assertIn(self.diagnosis.diagnosis, data)

	def test_report_data_with_filters(self):
		medical_department = frappe.get_doc('Medical Department', 'Cardiology')

		filters = {
			'from_date': str(add_months(getdate(), -12)),
			'to_date': str(add_days(getdate(), 1)),
			'range': 'Monthly',
			'department': medical_department.name,
		}
		report = execute(filters)

		data = [i['diagnosis'] for i in report[1]]

		self.assertIn(self.diagnosis_cardio.diagnosis, data)
