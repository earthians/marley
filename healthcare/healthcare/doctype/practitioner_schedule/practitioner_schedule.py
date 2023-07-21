# -*- coding: utf-8 -*-
# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import time_diff


class PractitionerSchedule(Document):
	def autoname(self):
		self.name = self.schedule_name

	def validate(self):
		if self.time_slots:
			for slots in self.time_slots:
				if slots.get("from_time") and slots.get("to_time") and slots.get("duration"):
					time_diff_in_mins = (
						time_diff(slots.get("from_time"), slots.get("to_time")).total_seconds() / 60
					)
					maximum_apps = abs(time_diff_in_mins) / slots.get("duration")
					if slots.get("maximum_appointments") > maximum_apps:
						frappe.throw(
							_(f"""Maximum appointments cannot be more than {maximum_apps} in row {slots.get("idx")}.""")
						)
