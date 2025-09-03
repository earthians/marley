# Copyright (c) 2025, earthians Health Informatics Pvt. Ltd. and Contributors
# See license.txt

from datetime import timedelta

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import nowdate


class IntegrationTestPractitionerAvailability(IntegrationTestCase):
	"""
	Integration tests for Practitioner Availability.
	Use this class for testing interactions between multiple components.
	"""

	def setUp(self):
		frappe.db.sql("DELETE FROM `tabPractitioner Availability`")
		frappe.db.sql("DELETE FROM `tabPatient Appointment`")

		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 0)

	def create_practitioner_availability(
		self,
		start,
		end,
		scope=None,
		scope_type=None,
		date=None,
		type="Available",
	):
		return frappe.get_doc(
			{
				"doctype": "Practitioner Availability",
				"type": type,
				"start_date": date or "2025-01-01",
				"start_time": start,
				"end_date": date or "2025-01-01",
				"end_time": end,
				"scope_type": scope_type or "Healthcare Service Unit",
				"scope": scope or "Service Unit-A",
				"status": "Active",
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
		pa = self.create_practitioner_availability("08:00:00", "08:30:00")
		self.assertEqual(pa.duration, 30)

	def test_simple_overlap(self):
		self.create_practitioner_availability("09:00:00", "10:00:00")
		with self.assertRaises(frappe.ValidationError):
			self.create_practitioner_availability("09:30:00", "10:30:00")

	def test_touching_overlap(self):
		self.create_practitioner_availability("10:00:00", "11:00:00")
		self.create_practitioner_availability("11:00:00", "12:00:00")

	def test_no_overlap(self):
		self.create_practitioner_availability("10:00:00", "11:00:00")
		self.create_practitioner_availability("11:01:00", "12:00:00")

	def test_different_scope_no_overlap(self):
		self.create_practitioner_availability("14:00:00", "15:00:00", scope="Service Unit-A")
		self.create_practitioner_availability("14:00:00", "15:00:00", scope="Service Unit-B")

	def test_different_date_no_overlap(self):
		self.create_practitioner_availability("16:00:00", "17:00:00", date="2025-01-03")
		self.create_practitioner_availability("16:00:00", "17:00:00")

	# def test_unavailable_without_available_block_is_not_allowed(self):
	# 	# Unavailable should not be allowed if no overlap with Available
	# 	with self.assertRaises(frappe.ValidationError):
	# 		self.create_practitioner_availability(
	# 			"10:00:00", "10:30:00", date="2025-01-05", type="Unavailable"
	# 		)

	def test_unavailable_partial_overlap_with_available_allowed(self):
		self.create_practitioner_availability("10:00:00", "11:00:00", date="2025-01-06")
		self.create_practitioner_availability(
			"10:50:00", "11:30:00", date="2025-01-06", type="Unavailable"
		)

	def test_appointment_inside_block_conflicts(self):
		d = nowdate()
		self.create_practitioner_availability("09:00:00", "12:00:00", date=d)
		self.create_appointment(date=d, time="11:30:00", minutes=20)
		with self.assertRaises(frappe.ValidationError):
			self.create_practitioner_availability("11:00:00", "12:00:00", date=d, type="Unavailable")

	def test_block_inside_appointment_conflicts(self):
		d = nowdate()
		self.create_practitioner_availability("09:00:00", "12:00:00", date=d)
		self.create_appointment(date=d, time="10:00:00", minutes=120)
		with self.assertRaises(frappe.ValidationError):
			self.create_practitioner_availability("10:30:00", "11:30:00", date=d, type="Unavailable")

	def test_partial_overlap_appointment_start_conflicts(self):
		d = nowdate()
		self.create_practitioner_availability("09:00:00", "12:00:00", date=d)
		self.create_appointment(date=d, time="09:50:00", minutes=20)
		with self.assertRaises(frappe.ValidationError):
			self.create_practitioner_availability("10:00:00", "10:30:00", date=d, type="Unavailable")

	def test_partial_overlap_appointment_end_conflicts(self):
		d = nowdate()
		self.create_practitioner_availability("09:00:00", "12:00:00", date=d)
		self.create_appointment(date=d, time="10:20:00", minutes=30)
		with self.assertRaises(frappe.ValidationError):
			self.create_practitioner_availability("10:00:00", "10:30:00", date=d, type="Unavailable")

	def test_appointment_back_to_back_is_allowed(self):
		d = nowdate()
		self.create_practitioner_availability("09:00:00", "12:00:00", date=d)
		self.create_appointment(date=d, time="10:00:00", minutes=30)
		self.create_practitioner_availability("10:30:00", "11:00:00", date=d, type="Unavailable")

	def test_appointment_gap_is_allowed(self):
		d = nowdate()
		self.create_practitioner_availability("09:00:00", "12:00:00", date=d)
		self.create_appointment(date=d, time="10:00:00", minutes=30)
		self.create_practitioner_availability("10:31:00", "11:00:00", date=d, type="Unavailable")

	def test_appointment_different_scope_is_allowed(self):
		d = nowdate()
		self.create_practitioner_availability("14:00:00", "15:00:00", date=d, scope="Service Unit-A")
		self.create_practitioner_availability("14:00:00", "15:00:00", date=d, scope="Service Unit-B")
		self.create_appointment(date=d, time="14:00:00", minutes=30, scope="Service Unit-A")
		self.create_practitioner_availability(
			"14:00:00", "14:30:00", date=d, scope="Service Unit-B", type="Unavailable"
		)

	def test_appointment_cancelled_appointments_are_ignored(self):
		d = nowdate()
		self.create_practitioner_availability("09:00:00", "12:00:00", date=d)
		appointment = self.create_appointment(date=d, time="11:30:00", minutes=30)
		frappe.db.set_value("Patient Appointment", appointment.name, "status", "Cancelled")
		self.create_practitioner_availability("11:00:00", "12:00:00", date=d, type="Unavailable")
