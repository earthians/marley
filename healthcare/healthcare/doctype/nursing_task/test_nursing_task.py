# Copyright (c) 2021, healthcare and Contributors
# See license.txt

import frappe
import unittest

from erpnext.tests.utils import ERPNextTestCase
from healthcare.healthcare.doctype.lab_test.test_lab_test import create_lab_test_template, create_lab_test
from healthcare.healthcare.doctype.nursing_task.nursing_task import NursingTask


class TestNursingTask(ERPNextTestCase):
	def test_create_nursing_task(self):

		template = frappe.get_doc({
			'doctype': 'Nursing Checklist Template',
			'title': 'Lab Checklist Template',
		})
		template.insert()

		activity = frappe.get_doc({
			'doctype': 'Healthcare Activity',
			'activity': 'BP check',
		})
		activity.insert()

		task = frappe.get_doc({
			'doctype': 'Nursing Checklist Template Task',
			'activity': activity.name,
			'parent': template,
			'parenttype': 'Nursing Checklist Template',
		})
		task.insert()

		template.append('tasks', task)
		template.save()

		tasks = frappe.get_list('Nursing Checklist Template Task', filters={'parent': template})

		lab_template = create_lab_test_template()
		lab_test = create_lab_test(lab_template)

		NursingTask.create_nursing_tasks_from_template(template, 'Lab Test', lab_test.name)

