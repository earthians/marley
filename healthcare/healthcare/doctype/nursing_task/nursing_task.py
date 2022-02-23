# Copyright (c) 2021, healthcare and contributors
# For license information, please see license.txt
import json
from six import string_types

import frappe
from frappe.model.document import Document
from frappe import _
from frappe.utils import now_datetime, add_to_date, getdate, time_diff_in_seconds, get_datetime
from erpnext import get_default_company


class NursingTask(Document):
	def before_insert(self):
		# set requested start / end
		self.set_task_schedule()

		self.title = _(f'{self.patient} - {self.activity}')

		self.age = frappe.get_doc('Patient', self.patient).get_age()

	def validate(self):
		if self.status == 'Requested':
			# auto submit if status is Requested
			self.docstatus = 1

	def on_submit(self):
		self.db_set('status', 'Requested')

	def on_cancel(self):
		if self.status == 'Completed':
			frappe.throw(_("Not Allowed to cancel Nursing Task with status 'Completed'"))

		self.db_set('status', 'Cancelled')

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
		if not self.requested_start_time or (get_datetime(self.requested_start_time) < now_datetime()):
			self.requested_start_time = now_datetime()

		if not self.requested_end_time:
			if not self.duration:
				self.duration = frappe.db.get_value('Healthcare Activity', self.activity, 'duration')
			self.requested_end_time = add_to_date(self.requested_start_time, seconds=self.duration)

		# set date based on requested_start_time
		self.date = getdate(self.requested_start_time)

	@classmethod
	def create_nursing_tasks_from_template(cls, template, doc, start_time=now_datetime(), post_event=True):

		tasks = frappe.get_all(
			'Nursing Checklist Template Task',
			filters={'parent': template},
			fields=['*'],
		)

		NursingTask.create_nursing_tasks(tasks, doc, start_time, post_event)


	@classmethod
	def create_nursing_tasks(cls, tasks, doc, start_time, post_event=True):

		for task in tasks:

			medical_department = doc.get('department') if doc.get('department') else doc.get('medical_department')
			if doc.get('doctype') == 'Inpatient Record':
				service_unit = frappe.db.get_value('Inpatient Occupancy', {'parent': doc.name, 'left': 0}, 'service_unit'),
			else:
				service_unit = doc.get('service_unit') if doc.get('service_unit') else doc.get('healthcare_service_unit')

			options = {
				'doctype': 'Nursing Task',
				'status': 'Requested',
				'company': doc.get('company', get_default_company()),
				'service_unit': service_unit,
				'medical_department': medical_department,
				'reference_doctype': doc.get('doctype'),
				'reference_name': doc.get('name'),
				'patient': doc.get('patient'),
				'activity': task.activity,
				'mandatory': task.mandatory,
				'duration': task.task_duration,
				'task_doctype': task.task_doctype,
			}

			if task.time_offset:
				time_offset = task.time_offset if not post_event else 0 - task.time_offset
				requested_start_time = add_to_date(start_time, seconds=time_offset)
			else:
				requested_start_time = start_time

			options.update({
				'requested_start_time': requested_start_time
			})

			options = {key: value for (key, value) in options.items() if value}
			frappe.get_doc(options).insert()

	@classmethod
	def cancel_nursing_tasks(cls, dt, dn):
		tasks = frappe.db.get_all('Nursing Task', filters={
			'reference_doctype': dt,
			'reference_document': dn,
			'status': ['!=', 'Completed', 'Cancelled']
		})

		for task in tasks:
			frappe.get_doc('Nursing Task', task).cancel()

@frappe.whitelist()
def create_nursing_tasks_from_template(template, doc, start_time=now_datetime(), post_event=True):

	if isinstance(doc, string_types):
		doc = json.loads(doc)

	NursingTask.create_nursing_tasks_from_template(template, doc, start_time, post_event)
