# Copyright (c) 2021, healthcare and contributors
# For license information, please see license.txt
import frappe
from frappe.model.document import Document
from frappe import _
from frappe.utils import now_datetime, add_to_date, getdate

class NursingTask(Document):
	def validate(self):
		""" set title, set requested start / end time, set date """

		if not self.title:
			self.title = f'{self.patient} - {self.activity}'

		if not self.requested_start_time:
			self.requested_start_time = now_datetime()

		if not self.requested_end_time:
			duration = frappe.db.get_value('Healthcare Activity', self.activity, 'duration')
			self.requested_end_time = add_to_date(self.requested_start_time, seconds=duration)

		# set date based on requested start time
		self.date = getdate(self.requested_start_time)

	def on_submit(self):
		""" allow submit only if task doc is set and in a valid status """

		if self.status != 'Cancelled' and self.task_doctype and not self.task_document_name:
			frappe.throw(_('Not Allowed to submit without linking Task Document Name'))

		allowed = ['Completed', 'Cancelled', 'Failed']
		if not self.status in allowed:
			frappe.throw(_(f"You are only allowed to submit Nursing Tasks with status {', '.join(allowed)}"))

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
