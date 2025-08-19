# Copyright (c) 2025, earthians Health Informatics Pvt. Ltd. and Contributors
# See license.txt

from datetime import datetime, timedelta

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import nowdate

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestTimeBlock(IntegrationTestCase):
	"""
	Integration tests for TimeBlock.
	Use this class for testing interactions between multiple components.
	"""

	def setUp(self):
		frappe.db.sql("delete from `tabTime Block`")
		frappe.db.sql("delete from `tabPatient Appointment`")
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 0)

	def create_time_block(self, start, end, scope=None, scope_type=None, date=None):
		return frappe.get_doc(
			{
				"doctype": "Time Block",
				"block_date": date or "2025-01-01",
				"block_start_time": start,
				"block_end_time": end,
				"scope_type": scope_type or "Healthcare Service Unit",
				"scope": scope or "Service Unit-A",
			}
		).insert(ignore_permissions=True, ignore_links=True, ignore_if_duplicate=True)

	def create_appointment(self, date, time, minutes=20, scope=None, status="Scheduled"):
		return frappe.get_doc(
			{
				"doctype": "Patient Appointment",
				"status": status,
				"service_unit": scope or "Service Unit-A",
				"appointment_date": date,
				"appointment_time": time,
				"duration": minutes,
			}
		).insert(
			ignore_permissions=True,
			ignore_links=True,
			ignore_if_duplicate=True,
			ignore_mandatory=True,
		)

	def test_duration(self):
		tb = self.create_time_block("08:00:00", "08:30:00")
		self.assertEqual(tb.block_duration, 30)

	def test_simple_overlap(self):
		self.create_time_block("09:00:00", "10:00:00")
		with self.assertRaises(frappe.ValidationError):
			self.create_time_block("09:30:00", "10:30:00")

	def test_touching_overlap(self):
		self.create_time_block("10:00:00", "11:00:00")
		self.create_time_block("11:00:00", "12:00:00")

	def test_no_overlap(self):
		self.create_time_block("10:00:00", "11:00:00")
		self.create_time_block("11:01:00", "12:00:00")

	def test_different_scope_no_overlap(self):
		self.create_time_block("14:00:00", "15:00:00", scope="Service Unit-A")
		self.create_time_block("14:00:00", "15:00:00", scope="Service Unit-B")

	def test_different_date_no_overlap(self):
		self.create_time_block("16:00:00", "17:00:00", date="2025-01-02")
		self.create_time_block("16:00:00", "17:00:00")

	def test_appointment_inside_block_conflicts(self):
		self.create_appointment(date=nowdate(), time="11:30:00", minutes=20)
		with self.assertRaises(frappe.ValidationError):
			self.create_time_block("11:00:00", "12:00:00", date=nowdate())

	def test_block_inside_appointment_conflicts(self):
		self.create_appointment(date=nowdate(), time="10:00:00", minutes=120)
		with self.assertRaises(frappe.ValidationError):
			self.create_time_block("10:30:00", "11:30:00", date=nowdate())

	def test_partial_overlap_appointment_start_conflicts(self):
		self.create_appointment(date=nowdate(), time="09:50:00", minutes=20)
		with self.assertRaises(frappe.ValidationError):
			self.create_time_block("10:00:00", "10:30:00", date=nowdate())

	def test_partial_overlap_appointment_end_conflicts(self):
		self.create_appointment(date=nowdate(), time="10:20:00", minutes=30)
		with self.assertRaises(frappe.ValidationError):
			self.create_time_block("10:00:00", "10:30:00", date=nowdate())

	def test_appointment_back_to_back_is_allowed(self):
		self.create_appointment(date=nowdate(), time="10:00:00", minutes=30)
		self.create_time_block("10:30:00", "11:00:00", date=nowdate())

	def test_appointment_gap_is_allowed(self):
		self.create_appointment(date=nowdate(), time="10:00:00", minutes=30)
		self.create_time_block("10:31:00", "11:00:00", date=nowdate())

	def test_appointment_different_scope_is_allowed(self):
		self.create_appointment(date=nowdate(), time="14:00:00", minutes=30, scope="Service Unit-A")
		self.create_time_block("14:00:00", "14:30:00", date=nowdate(), scope="Service Unit-B")

	def test_appointment_cancelled_appointments_are_ignored(self):
		appointment = self.create_appointment(date=nowdate(), time="11:30:00", minutes=30)
		frappe.db.set_value("Patient Appointment", appointment.name, "status", "Cancelled")
		self.create_time_block("11:00:00", "12:00:00", date=nowdate())
