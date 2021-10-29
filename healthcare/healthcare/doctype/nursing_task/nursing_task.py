# Copyright (c) 2021, healthcare and contributors
# For license information, please see license.txt
import frappe
from frappe.model.document import Document


class NursingTask(Document):
	@classmethod
	def create_nursing_tasks_from_template(cls, template, dt=None, dn=None):
		tasks = frappe.get_list(
			'Nursing Checklist Template Task',
			filters={'parent': template},
			fields=['*'],
		)

		for task in tasks:
			print(task.activity)
			doc = frappe.get_doc({
				'doctype': 'Nursing Task',
				'activity': task.activity,
				'status': 'Requested',
				'reference_doctype': dt,
				'reference_name': dn,
			})
			doc.insert()
