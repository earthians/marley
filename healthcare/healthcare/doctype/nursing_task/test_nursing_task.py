# Copyright (c) 2021, healthcare and Contributors
# See license.txt

import frappe

from frappe.tests.utils import FrappeTestCase
from frappe.utils import now_datetime
from healthcare.healthcare.doctype.clinical_procedure.test_clinical_procedure import create_procedure
from healthcare.healthcare.doctype.inpatient_record.inpatient_record import admit_patient, discharge_patient
from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import create_inpatient, \
	get_healthcare_service_unit
from healthcare.healthcare.doctype.lab_test.test_lab_test import create_lab_test_template, create_lab_test
from healthcare.healthcare.doctype.nursing_task.nursing_task import NursingTask
from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import \
	create_clinical_procedure_template, create_healthcare_docs
from healthcare.healthcare.doctype.therapy_plan.test_therapy_plan import create_therapy_plan
from healthcare.healthcare.doctype.therapy_session.test_therapy_session import create_therapy_session
from healthcare.healthcare.doctype.therapy_type.test_therapy_type import create_therapy_type


class TestNursingTask(FrappeTestCase):
	def setUp(self) -> None:
		nursing_checklist_templates = frappe.get_test_records('Nursing Checklist Template')
		self.nc_template = frappe.get_doc(nursing_checklist_templates[0]).insert(ignore_if_duplicate=True)

		self.settings = frappe.get_single('Healthcare Settings')
		self.settings.validate_nursing_checklists = 1
		self.settings.save()

		self.patient, self.practitioner = create_healthcare_docs()

	def test_lab_test_submission_should_validate_pending_nursing_tasks(self):
		self.lt_template = create_lab_test_template()
		self.lt_template.nursing_checklist_template = self.nc_template.name
		self.lt_template.save()

		lab_test = create_lab_test(self.lt_template)
		lab_test.descriptive_test_items[0].result_value = 12
		lab_test.descriptive_test_items[1].result_value = 1
		lab_test.descriptive_test_items[2].result_value = 2.3
		lab_test.save()

		self.assertRaises(frappe.ValidationError, lab_test.submit)

		complete_nusing_tasks(lab_test)
		lab_test.submit()

	def test_start_clinical_procedure_should_validate_pending_nursing_tasks(self):
		procedure_template = create_clinical_procedure_template()
		procedure_template.allow_stock_consumption = 1
		procedure_template.pre_op_nursing_checklist_template = self.nc_template.name
		procedure_template.save()

		procedure = create_procedure(procedure_template, self.patient, self.practitioner)
		self.assertRaises(frappe.ValidationError, procedure.start_procedure)

		complete_nusing_tasks(procedure)
		procedure.start_procedure()

	def test_admit_inpatient_should_validate_pending_nursing_tasks(self):
		self.settings.allow_discharge_despite_unbilled_services = 1
		self.settings.save()

		ip_record = create_inpatient(self.patient)
		ip_record.admission_nursing_checklist_template = self.nc_template.name
		ip_record.expected_length_of_stay = 0
		ip_record.save(ignore_permissions=True)
		NursingTask.create_nursing_tasks_from_template(
			ip_record.admission_nursing_checklist_template,
			ip_record,
			start_time=now_datetime()
		)

		service_unit = get_healthcare_service_unit()
		kwargs = {
			'inpatient_record': ip_record,
			'service_unit': service_unit,
			'check_in': now_datetime(),
		}
		self.assertRaises(frappe.ValidationError, admit_patient, **kwargs)

		complete_nusing_tasks(ip_record)
		admit_patient(**kwargs)

		ip_record.discharge_nursing_checklist_template = self.nc_template.name
		ip_record.save()
		NursingTask.create_nursing_tasks_from_template(
			ip_record.admission_nursing_checklist_template,
			ip_record,
			start_time=now_datetime()
		)

		self.assertRaises(frappe.ValidationError, discharge_patient, inpatient_record=ip_record)

		complete_nusing_tasks(ip_record)
		discharge_patient(ip_record)

	def test_submit_therapy_session_should_validate_pending_nursing_tasks(self):
		therapy_type = create_therapy_type()
		therapy_type.nursing_checklist_template = self.nc_template.name
		therapy_type.save()

		therapy_plan = create_therapy_plan()
		therapy_session = create_therapy_session(self.patient, therapy_type.name, therapy_plan.name)

		self.assertRaises(frappe.ValidationError, therapy_session.submit)

		complete_nusing_tasks(therapy_session)
		therapy_session.submit()


def complete_nusing_tasks(document):
	filters = {
		'reference_name': document.name,
		'mandatory': 1,
		'status': ['not in', ['Completed', 'Cancelled']],
	}
	tasks = frappe.get_all('Nursing Task', filters=filters)
	for task_name in tasks:
		task = frappe.get_doc('Nursing Task', task_name)
		task.status = 'Completed'
		task.save()
