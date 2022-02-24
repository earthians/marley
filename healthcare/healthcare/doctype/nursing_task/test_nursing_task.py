# Copyright (c) 2021, healthcare and Contributors
# See license.txt

import frappe

from erpnext.tests.utils import ERPNextTestCase
from healthcare.healthcare.doctype.lab_test.test_lab_test import create_lab_test_template, create_lab_test



class TestNursingTask(ERPNextTestCase):
	def setUp(self) -> None:
		nursing_checklist_templates = frappe.get_test_records('Nursing Checklist Template')
		self.nc_template = frappe.get_doc(nursing_checklist_templates[0]).insert(ignore_if_duplicate=True)

		self.lt_template = create_lab_test_template()
		self.lt_template.nursing_checklist_template = self.nc_template.name
		self.lt_template.save()

	def test_creating_nursing_task_from_template(self):
		task_count = frappe.db.count('Nursing Task')

		create_lab_test(self.lt_template)

		self.assertEqual(frappe.db.count('Nursing Task'), task_count + 1)

	def test_lab_test_submission_should_validate_pending_nursing_tasks(self):
		settings = frappe.get_single('Healthcare Settings')
		settings.validate_nursing_checklists = 1
		settings.save()

		lab_test = create_lab_test(self.lt_template)
		lab_test.descriptive_test_items[0].result_value = 12
		lab_test.descriptive_test_items[1].result_value = 1
		lab_test.descriptive_test_items[2].result_value = 2.3
		lab_test.save()

		self.assertRaises(frappe.ValidationError, lab_test.submit)

