# Copyright (c) 2025, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

from datetime import datetime

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.query_builder import DocType
from frappe.utils import format_datetime, get_link_to_form, get_time, getdate, time_diff_in_seconds


class TimeBlock(Document):
	def before_save(self):
		if not self.block_duration:
			self.block_duration = int(time_diff_in_seconds(self.block_end_time, self.block_start_time) / 60)

	def validate(self):
		self.validate_start_and_end()
		self.validate_overlapping_blocks()
		self.validate_existing_appointments()

	def validate_start_and_end(self):
		if not self.block_start_time or not self.block_end_time:
			frappe.throw("Time Block Start and End times are required.")

		if self.block_end_time <= self.block_start_time:
			frappe.throw("Time Block End time must be after Start time.")

	def validate_overlapping_blocks(self):
		TB = DocType("Time Block")

		same_timespan = (TB.block_start_time == self.block_start_time) & (
			TB.block_end_time == self.block_end_time
		)
		overlap = (
			(TB.block_start_time < self.block_end_time) & (TB.block_end_time > self.block_start_time)
		) | same_timespan

		overlaps = (
			frappe.qb.from_(TB)
			.select(TB.name)
			.where(TB.name != self.name)
			.where(TB.docstatus != 2)
			.where(TB.status == "Active")
			.where(TB.scope_type == self.scope_type)
			.where(TB.scope == self.scope)
			.where(TB.block_date == self.block_date)
			.where(overlap)
			.limit(1)
			.run(as_dict=True)
		)

		if overlaps and overlaps[0]:
			frappe.throw(
				_(f"Overlaps with an existing Time Block in the same scope ({overlaps[0].get('name')}).")
			)

	def validate_existing_appointments(self):
		scope_map = {
			"Healthcare Service Unit": "service_unit",
			"Healthcare Practitioner": "practitioner",
			"Medical Department": "department",
		}
		scope_field = scope_map.get(self.scope_type)

		block_start_dt = datetime.combine(getdate(self.block_date), get_time(self.block_start_time))
		block_end_dt = datetime.combine(getdate(self.block_date), get_time(self.block_end_time))

		PA = DocType("Patient Appointment")

		appointments = (
			frappe.qb.from_(PA)
			.select(
				PA.name,
				PA.appointment_datetime,
				PA.appointment_end_datetime,
			)
			.where(getattr(PA, scope_field) == self.scope)
			.where(PA.status.isin(("Open", "Scheduled", "Confirmed", "In Progress")))
			.where(PA.appointment_datetime < block_end_dt)
			.where(PA.appointment_end_datetime > block_start_dt)
			.orderby(PA.appointment_datetime)
			.run(as_dict=True)
		)

		if appointments:
			links = [
				f"{get_link_to_form('Patient Appointment', a['name'])} "
				f"({format_datetime(a['appointment_datetime'])} to {format_datetime(a['appointment_end_datetime'])})"
				for a in appointments
			]
			html = "<br>".join(links)
			frappe.throw(
				_("Cannot block time, booked appointments in this scope and window:<br>{0}").format(html)
			)
