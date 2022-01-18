# Copyright (c) 2021, healthcare and Contributors
# See license.txt

import frappe

from erpnext.tests.utils import ERPNextTestCase
from healthcare.healthcare.doctype.lab_test.test_lab_test import create_lab_test_template, create_lab_test


class TestNursingTask(ERPNextTestCase):
	def test_creating_nursing_task_from_template(self):
		task_count = frappe.db.count('Nursing Task')

		if not frappe.db.exists('Healthcare Activity', 'BP check'):
			activity = frappe.get_doc({
				'doctype': 'Healthcare Activity',
				'activity': 'BP check',
			})
			activity.insert()

		template_name = 'Lab Checklist Template'
		if not frappe.db.exists('Healthcare Activity', template_name):
			template = frappe.get_doc({
				'doctype': 'Nursing Checklist Template',
				'title': template_name,
			})
			task = frappe._dict({
				'doctype': 'Nursing Checklist Template Task',
				'activity': activity.name,
				'activity_duration': 900
			})
			template.append('tasks', task)
			template.insert()

		self.lab_template = create_lab_test_template()
		self.lab_template.nursing_checklist_template = template_name
		self.lab_template.save()
		create_lab_test(self.lab_template)

		self.assertEqual(frappe.db.count('Nursing Task'), task_count + 1)
