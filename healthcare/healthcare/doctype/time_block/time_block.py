# Copyright (c) 2025, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.query_builder import DocType
from frappe.utils import time_diff_in_seconds


class TimeBlock(Document):
	def before_save(self):
		if not self.block_duration:
			self.block_duration = int(time_diff_in_seconds(self.block_end_time, self.block_start_time) / 60)

	def validate(self):
		self.validate_start_and_end()
		self.validate_overlapping_blocks()

	def validate_start_and_end(self):
		if not self.block_start_time or not self.block_end_time:
			frappe.throw("Time Block Start and End times are required.")

		if self.block_end_time <= self.block_start_time:
			frappe.throw("Time Block End time must be after Start time.")

	def validate_overlapping_blocks(self):
		TB = DocType("Time Block")

		overlaps = (
			frappe.qb.from_(TB)
			.select(TB.name)
			.where(TB.name != self.name)
			.where(TB.docstatus == 1)
			.where(TB.status == "Active")
			.where(TB.scope_type == self.scope_type)
			.where(TB.scope == self.scope)
			.where(TB.block_date == self.block_date)
			.where(TB.block_start_time < self.block_end_time)
			.where(TB.block_end_time > self.block_start_time)
			.limit(1)
			.run(as_dict=True)
		)

		if overlaps and overlaps[0]:
			frappe.throw(
				_(f"Overlaps with an existing Time Block in the same scope ({overlaps[0].get('name')}).")
			)
