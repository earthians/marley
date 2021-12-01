# Copyright (c) 2021, healthcare and contributors
# For license information, please see license.txt
import frappe
from frappe.model.document import Document


class NursingTask(Document):
	@classmethod
	def create_nursing_tasks_from_template(cls, template_name=None, dt=None, dn=None, append=False):
		tasks = frappe.get_list(
			'Nursing Checklist Template Task',
			filters={'parent': template_name},
			fields=['*'],
		)
		if append:
			NursingTask.create_nursing_tasks(dt, dn, tasks)
		else:
			filters = {
				'reference_doctype': dt,
				'reference_name': dn,
			}
			existing_tasks = frappe.get_list('Nursing Task', filters=filters)
			if existing_tasks:
				return
			NursingTask.create_nursing_tasks(dt, dn, tasks)

	@classmethod
	def create_nursing_tasks(cls, dt=None, dn=None, tasks=None):
		for task in tasks:
			options = {
				'doctype': 'Nursing Task',
				'status': 'Requested',
				'reference_doctype': dt,
				'reference_name': dn,
				'activity': task.activity,
				'mandatory': task.mandatory,
				'task_doctype': task.task_doctype,
			}
			options = {key: value for (key, value) in options.items() if value}

			if not frappe.db.exists(options):
				frappe.get_doc(options).insert()
