# Copyright (c) 2025, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

from datetime import datetime

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.query_builder import DocType
from frappe.utils import (
	add_to_date,
	date_diff,
	get_datetime,
	get_link_to_form,
	get_time,
	getdate,
	time_diff_in_seconds,
)


class PractitionerAvailability(Document):
	def validate(self):
		self.set_fallbacks()
		self.set_title()
		self.validate_start_and_end()
		self.validate_availability_overlaps()
		self.validate_existing_appointments()

	def set_title(self):
		if not self.title:
			self.title = f"{self.type}-{self.scope}-{self.start_date}-{self.start_time}"

	def set_fallbacks(self):
		if not self.end_date:
			self.end_date = self.start_date

		if not self.duration:
			start = datetime.combine(getdate(self.start_date), get_time(self.start_time))
			end = datetime.combine(getdate(self.end_date), get_time(self.end_time))
			self.duration = int(time_diff_in_seconds(end, start) / 60)

	def validate_start_and_end(self):
		if not self.start_time or not self.end_time:
			frappe.throw(_("Practitioner Availability Start and End times are required."))

		start_dt = datetime.combine(getdate(self.start_date), get_time(self.start_time))
		end_dt = datetime.combine(getdate(self.end_date), get_time(self.end_time))
		if end_dt <= start_dt:
			frappe.throw(_("Practitioner Availability End time must be after Start time."))

		if self.end_time and get_time(self.start_time) > get_time(self.end_time):
			frappe.throw(_("End time must be after start time."))

	def validate_availability_overlaps(self):
		PAV = DocType("Practitioner Availability")
		rows = (
			frappe.qb.from_(PAV)
			.select(PAV.name, PAV.type, PAV.start_date, PAV.end_date, PAV.start_time, PAV.end_time)
			.where(PAV.docstatus != 2)
			.where(PAV.name != (self.name or ""))
			# .where(PAV.scope_type == self.scope_type)
			.where(PAV.scope == self.scope)
		).run(as_dict=True)

		def has_time_overlap(r):
			"""Check if date & time overlap exists with given record"""
			existing_start_date = getdate(r.start_date)
			existing_end_date = getdate(r.end_date)
			existing_start_time = get_time(r.start_time)
			existing_end_time = get_time(r.end_time)

			overlap_start_date = max(getdate(self.start_date), existing_start_date)
			overlap_end_date = min(getdate(self.end_date), existing_end_date)

			if overlap_start_date <= overlap_end_date:
				return get_time(self.start_time) < existing_end_time and existing_start_time < get_time(
					self.end_time
				)
			return False

		if self.type == "Available":
			for r in rows:
				if r.get("type") != "Available":
					continue
				if has_time_overlap(r):
					frappe.throw(
						_(
							f"Overlaps with another Availability: "
							f"{get_link_to_form(self.doctype, r.get('name'))}"
						)
					)
		else:
			if self.scope_type == "Healthcare Practitioner":
				has_overlap_with_available = False
				for r in rows:
					if r.get("type") != "Available":
						continue
					if has_time_overlap(r):
						has_overlap_with_available = True
						break
				if not has_overlap_with_available:
					frappe.throw(
						_(
							"Unavailable block for a practitioner must overlap at least partially with an existing Availability"
						)
					)
			else:
				for r in rows:
					if r.get("type") == "Available":
						continue
					if has_time_overlap(r):
						frappe.throw(
							_(
								f"Overlaps with another Unvailability: "
								f"{get_link_to_form(self.doctype, r.get('name'))}"
							)
						)

	def validate_existing_appointments(self):
		if self.type != "Unavailable":
			return

		if self.scope_type == "Healthcare Practitioner":
			scope_field = "practitioner"
		elif self.scope_type == "Healthcare Service Unit":
			scope_field = "service_unit"
		elif self.scope_type == "Medical Department":
			scope_field = "department"
		else:
			frappe.throw(_(f"Invalid Scope Type: {frappe.bold(self.scope_type)}"))

		PAP = DocType("Patient Appointment")
		scope_col = getattr(PAP, scope_field)
		appointments = (
			frappe.qb.from_(PAP)
			.select(
				PAP.name,
				PAP.status,
				PAP.appointment_date,
				PAP.appointment_time,
				PAP.duration,
				PAP.appointment_datetime,
				PAP.appointment_end_datetime,
				PAP.docstatus,
			)
			.where(scope_col == self.scope)
			.where(PAP.docstatus != 2)
		).run(as_dict=True)

		conflicts = []
		for a in appointments:
			if (a.get("status") or "").lower() == "cancelled":
				continue

			if a.get("appointment_datetime"):
				apt_start = get_datetime(a.get("appointment_datetime"))
			else:
				apt_time = a.get("appointment_time") or "00:00:00"
				apt_start = get_datetime(f"{a.get('appointment_date')} {apt_time}")

			if a.get("appointment_end_datetime"):
				apt_end = get_datetime(a.get("appointment_end_datetime"))
			else:
				apt_end = add_to_date(apt_start, minutes=int(a.get("duration") or 0))

			start_dt = datetime.combine(getdate(self.start_date), get_time(self.start_time))
			end_dt = datetime.combine(getdate(self.end_date), get_time(self.end_time))
			if (apt_start < end_dt) and (start_dt < apt_end):
				conflicts.append(a.get("name"))

		if conflicts:
			conflict_links = ", ".join(get_link_to_form("Patient Appointment", n) for n in conflicts)
			frappe.throw(
				_(
					f"Cannot create Unavailable block: it conflicts with existing Patient Appointment(s): "
					f"{conflict_links}."
				)
			)


def daterange(start_date, end_date):
	start_date = getdate(start_date)
	end_date = getdate(end_date)

	days_count = date_diff(end_date, start_date)

	for i in range(days_count + 1):
		day = getdate(add_to_date(start_date, days=i))
		yield day
