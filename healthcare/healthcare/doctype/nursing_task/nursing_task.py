# Copyright (c) 2021, healthcare and contributors
# For license information, please see license.txt
import frappe
from frappe.model.document import Document
from frappe import _
from frappe.utils import now_datetime, add_to_date, getdate, time_diff_in_seconds
from erpnext import get_default_company
class NursingTask(Document):
	def before_insert(self):
		# set requested start / end
		self.set_task_schedule()
		self.title = _(f'{self.patient} - {self.activity}')

	def validate(self):
		if self.status == 'Requested':
			# auto submit if status is Requested
			self.docstatus = 1

	def on_submit(self):
		self.status = 'Requested'

	def on_cancel(self):
		if self.status == 'Completed':
			frappe.throw(_("Not Allowed to cancel Nursing Task with status 'Completed'"))

		self.status = 'Cancelled'

	def on_update_after_submit(self):
		if self.status == 'Completed' and self.task_doctype and not self.task_document_name:
			frappe.throw(_("Not Allowed to 'Complete' Nursing Task without linking Task Document"))

		if self.status == 'Draft':
			frappe.throw(_("Nursing Task cannot be 'Draft' after submission"))

		if self.status == 'In Progress':
			if not self.task_start_time:
				self.db_set('task_start_time', now_datetime())

		elif self.status == 'Completed':
			self.db_set({
				'task_end_time': now_datetime(),
				'task_duration': time_diff_in_seconds(self.task_end_time, self.task_start_time)
			})

		self.notify_update()

	def set_task_schedule(self):
		if not self.requested_start_time or self.requested_start_time < now_datetime():
			self.requested_start_time = now_datetime()

		if not self.requested_end_time:
			if not self.duration:
				self.duration = frappe.db.get_value('Healthcare Activity', self.activity, 'duration')
			self.requested_end_time = add_to_date(self.requested_start_time, seconds=self.duration)

		# set date based on requested_start_time
		self.date = getdate(self.requested_start_time)

	@classmethod
	def create_nursing_tasks_from_template(cls, template_name, patient, args, post_event=False):

		tasks = frappe.get_all(
			'Nursing Checklist Template Task',
			filters={'parent': template_name},
			fields=['*'],
		)

		NursingTask.create_nursing_tasks(patient, tasks, args, post_event)

	@classmethod
	def create_nursing_tasks(cls, patient, tasks, args, post_event=False):

		for task in tasks:
			options = {
				'doctype': 'Nursing Task',
				'status': 'Requested',
				'company': args.get('company', get_default_company()),
				'service_unit': args.get('service_unit'),
				'medical_department': args.get('medical_department'),
				'reference_doctype': args.get('reference_doctype'),
				'reference_name': args.get('reference_name'),
				'patient': patient,
				'activity': task.activity,
				'mandatory': task.mandatory,
				'duration': task.task_duration,
				'task_doctype': task.task_doctype,
			}

			if task.time_offset:
				time_offset = task.time_offset if post_event else 0 - task.time_offset
				requested_start_time = add_to_date(args.get('start_time', now_datetime()), seconds=time_offset)

			else:
				requested_start_time = args.get('start_time', now_datetime())

			options.update({
				'requested_start_time': requested_start_time
			})

			options = {key: value for (key, value) in options.items() if value}

			if not frappe.db.exists(options):
				frappe.get_doc(options).insert()
