# Copyright (c) 2021, healthcare and contributors
# For license information, please see license.txt
import frappe
from frappe.model.document import Document


class NursingTask(Document):
	@classmethod
	def create_nursing_tasks_from_template(cls, template_name, dt=None, dn=None):
		tasks = frappe.get_list(
			'Nursing Checklist Template Task',
			filters={'parent': template_name},
			fields=['*'],
		)

		for task in tasks:
			doc = frappe.get_doc({
				'doctype': 'Nursing Task',
				'status': 'Requested',
				'reference_doctype': dt,
				'reference_name': dn,
				'activity': task.activity,
				'mandatory': task.mandatory,
				'task_doctype': task.task_doctype,
			})
			doc.insert()
