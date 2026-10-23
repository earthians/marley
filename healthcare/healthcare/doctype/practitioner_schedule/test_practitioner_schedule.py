# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt


import frappe

from healthcare.tests.utils import HealthcareTestSuite


class TestPractitionerSchedule(HealthcareTestSuite):
	def test_blank_maximum_appointments_saves_as_uncapped(self):
		# maximum_appointments is nullable - blank must mean "no cap", not crash.
		schedule = new_schedule_with_slot()
		schedule.insert(ignore_permissions=True)

	def test_maximum_appointments_within_slot_capacity_saves(self):
		schedule = new_schedule_with_slot(maximum_appointments=6)
		schedule.insert(ignore_permissions=True)

	def test_maximum_appointments_above_slot_capacity_raises(self):
		schedule = new_schedule_with_slot(maximum_appointments=99)
		self.assertRaises(frappe.ValidationError, schedule.insert, ignore_permissions=True)


def new_schedule_with_slot(maximum_appointments=None):
	return frappe.get_doc(
		{
			"doctype": "Practitioner Schedule",
			"schedule_name": frappe.generate_hash(length=10),
			"time_slots": [
				{
					"day": "Monday",
					"from_time": "09:00:00",
					"to_time": "12:00:00",
					"duration": 30,
					"maximum_appointments": maximum_appointments,
				}
			],
		}
	)
