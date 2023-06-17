# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import date_diff, getdate, today


class Observation(Document):
	def validate(self):
		dob  = frappe.db.get_value("Patient", self.patient, "dob")
		if dob:
			self.age = calculate_age(dob)

def calculate_age(dob):
	age = date_diff(today(), getdate(dob))

	# Check if the birthday has already occurred this year
	if getdate(today()).month < getdate(dob).month or (
		getdate(today()).month == getdate(dob).month
		and getdate(today()).day < getdate(dob).day
	):
		age -= 1
	if age:
		return age / 365.25
