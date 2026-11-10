# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, add_to_date, get_datetime, nowdate, nowtime

from healthcare.healthcare.doctype.healthcare_service_unit_type.test_healthcare_service_unit_type import (
	create_theatre_type,
)
from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import create_inpatient
from healthcare.healthcare.doctype.ot_booking.ot_booking import make_ot_booking
from healthcare.healthcare.doctype.ot_booking.priority import priority_named
from healthcare.tests.utils import HealthcareTestSuite

HOUR = 3600


class TestOTBooking(HealthcareTestSuite):
	def setUp(self):
		self.patients = frappe.get_all("Patient", pluck="name", limit=3)
		self.practitioners = frappe.get_all("Healthcare Practitioner", pluck="name", limit=3)
		self.theatre = create_theatre("_Test OT 1", "_Test General OT")
		self.other_theatre = create_theatre("_Test OT 2", "_Test General OT")
		self.template = create_ot_template("_Test Procedure - Hernia Repair", duration=HOUR)
		# every test books its own day, so the tests never meet each other's cases
		test_names = sorted(name for name in dir(self) if name.startswith("test_"))
		self.day = add_days(nowdate(), 30 + test_names.index(self._testMethodName))

	def at(self, hour):
		return get_datetime(f"{self.day} {hour:02d}:00:00")

	def assert_refused(self, message, **fields):
		self.assertRaisesRegex(frappe.ValidationError, message, make_booking, self, self.at(9), **fields)

	def booking_from_request(self, request):
		booking = make_ot_booking(request.name)
		booking.update({"theatre": self.theatre, "scheduled_start": self.at(9)})
		return booking

	def test_the_end_comes_from_the_procedure_durations(self):
		second = create_ot_template("_Test Procedure - Mesh Fixation", duration=HOUR // 2)

		booking = make_booking(self, self.at(9), templates=[self.template.name, second.name])

		self.assertEqual(str(booking.scheduled_date), self.day)
		self.assertEqual(get_datetime(booking.scheduled_end), add_to_date(self.at(9), seconds=HOUR * 1.5))

	def test_a_case_keeps_the_cleaning_time_it_was_booked_with(self):
		setting = frappe.db.get_single_value("Healthcare Settings", "ot_cleaning_minutes")
		booking = make_booking(self, self.at(9))
		frappe.db.set_single_value("Healthcare Settings", "ot_cleaning_minutes", setting + 15)
		self.addCleanup(frappe.db.set_single_value, "Healthcare Settings", "ot_cleaning_minutes", setting)

		booking.reload()
		booking.save()

		self.assertEqual(booking.cleaning_minutes, setting)

	def test_a_new_booking_is_routine(self):
		self.assertEqual(make_booking(self, self.at(9)).priority, priority_named("Routine"))

	def test_a_procedure_must_take_some_time(self):
		booking = make_booking(self, self.at(9))
		booking.procedures[0].duration = -HOUR

		self.assertRaisesRegex(frappe.ValidationError, "greater than zero", booking.save)

	def test_a_case_of_a_day_or_more_is_refused(self):
		day_long = create_ot_template("_Test Procedure - Day Long", duration=24 * HOUR)

		self.assert_refused("less than 24 hours", templates=[day_long.name])

	def test_a_save_follows_the_status_rules(self):
		booking = make_booking(self, self.at(9))
		booking.status = "Completed"
		self.assertRaisesRegex(frappe.ValidationError, "cannot become", booking.save)

		booking.reload()
		booking.db_set("status", "Cancelled")
		booking.reload()
		booking.status = "Scheduled"
		self.assertRaisesRegex(frappe.ValidationError, "cannot become", booking.save)

	def test_a_new_case_cannot_start_completed(self):
		booking = frappe.copy_doc(make_booking(self, self.at(9)))
		booking.update({"status": "Completed", "scheduled_start": self.at(13)})

		self.assertRaisesRegex(frappe.ValidationError, "A new case cannot be", booking.insert)

	def test_the_theatre_must_be_an_ot_of_the_bookings_company(self):
		ward = create_theatre("_Test Not An OT", "_Test General Ward", is_ot=0)
		self.assert_refused("is not an operation theatre", theatre=ward)

		other_company = frappe.db.get_value("Company", {"name": ["!=", "_Test Company"]})
		frappe.db.set_value("Healthcare Service Unit", self.other_theatre, "company", other_company)
		self.assert_refused("belongs to", theatre=self.other_theatre)

	def test_a_procedure_must_need_an_ot_of_the_theatres_type(self):
		dressing = create_ot_template("_Test Procedure - Dressing Change", HOUR, requires_ot=0)
		self.assert_refused("does not require an operation theatre", templates=[dressing.name])

		knee = create_ot_template("_Test Procedure - Knee Replacement", HOUR, "_Test Laminar Flow OT")
		self.assert_refused("needs a .*_Test Laminar Flow OT.* theatre", templates=[knee.name])

	def test_exactly_one_primary_surgeon(self):
		self.assert_refused("exactly one", primaries=0)
		self.assert_refused("exactly one", primaries=2)

	def test_another_patients_admission_is_refused(self):
		admission = create_inpatient(self.patients[1])
		admission.flags.ignore_validate = True
		admission.insert(ignore_permissions=True)
		booking = make_booking(self, self.at(9))
		booking.inpatient_record = admission.name

		self.assertRaisesRegex(frappe.ValidationError, "not this patient's admission", booking.save)

	def test_booking_from_a_request_carries_its_patient_procedure_surgeon_and_priority(self):
		request = create_service_request(self.patients[0], self.practitioners[0])
		request.db_set("priority", priority_named("STAT"))

		booking = make_ot_booking(request.name)

		self.assertEqual((booking.patient, booking.priority), (self.patients[0], priority_named("STAT")))
		row, surgeon = booking.procedures[0], booking.team[0]
		self.assertEqual((row.service_request, row.procedure_template), (request.name, self.template.name))
		self.assertEqual(row.duration, HOUR)
		self.assertEqual((surgeon.practitioner, surgeon.is_primary), (self.practitioners[0], 1))

	def test_a_request_that_needs_no_theatre_cannot_be_booked(self):
		dressing = create_ot_template("_Test Procedure - Dressing Change", HOUR, requires_ot=0)
		request = create_service_request(self.patients[0], self.practitioners[0], dressing.name)

		self.assertRaisesRegex(frappe.ValidationError, "not for a procedure", make_ot_booking, request.name)

	def test_a_request_is_booked_only_once(self):
		twice = self.booking_from_request(create_service_request(self.patients[1], self.practitioners[1]))
		twice.append("procedures", {"service_request": twice.procedures[0].service_request})
		self.assertRaisesRegex(frappe.ValidationError, "already in this booking", twice.insert)

		request = create_service_request(self.patients[0], self.practitioners[0])
		self.booking_from_request(request).insert()
		self.assertRaisesRegex(frappe.ValidationError, "already booked", make_ot_booking, request.name)

		other = make_booking(self, self.at(13))
		other.append("procedures", {"service_request": request.name})
		self.assertRaisesRegex(frappe.ValidationError, "already booked", other.save)

	def test_a_row_takes_its_procedure_and_duration_from_its_request(self):
		request = create_service_request(self.patients[0], self.practitioners[0])
		booking = make_booking(self, self.at(9))
		booking.procedures[0].update({"procedure_template": None, "duration": None})
		booking.procedures[0].service_request = request.name

		booking.save()

		self.assertEqual(booking.procedures[0].procedure_template, self.template.name)
		self.assertEqual(booking.procedures[0].duration, HOUR)

	def test_a_request_for_another_patient_is_refused(self):
		booking = self.booking_from_request(create_service_request(self.patients[1], self.practitioners[0]))
		booking.patient = self.patients[0]

		self.assertRaisesRegex(frappe.ValidationError, "another patient", booking.insert)

	def test_a_request_withdrawn_before_the_booking_is_saved_is_refused(self):
		request = create_service_request(self.patients[0], self.practitioners[0])
		booking = self.booking_from_request(request)
		request.db_set("status", "revoked-Request Status")

		self.assertRaisesRegex(frappe.ValidationError, "is not active", booking.insert)

	def test_a_request_added_to_a_saved_booking_must_be_active(self):
		booking = make_booking(self, self.at(9))
		request = create_service_request(self.patients[0], self.practitioners[0])
		request.db_set("status", "on-hold-Request Status")
		booking.procedures[0].service_request = request.name

		self.assertRaisesRegex(frappe.ValidationError, "is not active", booking.save)

	def test_booking_a_request_needs_permission(self):
		request = create_service_request(self.patients[0], self.practitioners[0])
		frappe.set_user("test_user@marleyhealth.io")  # a login with no clinical role
		self.addCleanup(frappe.set_user, "Administrator")

		self.assertRaises(frappe.PermissionError, make_ot_booking, request.name)


def make_booking(test, start, theatre=None, templates=None, patient=0, surgeon=0, primaries=1, **fields):
	team = [{"practitioner": test.practitioners[surgeon], "role": "Surgeon", "is_primary": primaries >= 1}]
	if primaries >= 2:
		team.append({"practitioner": test.practitioners[2], "role": "Surgeon", "is_primary": 1})
	booking = frappe.get_doc(
		{
			"doctype": "OT Booking",
			"patient": test.patients[patient],
			"company": "_Test Company",
			"theatre": theatre or test.theatre,
			"scheduled_start": start,
			"procedures": [{"procedure_template": name} for name in templates or [test.template.name]],
			"team": team,
			**fields,
		}
	)
	return booking.insert()


def create_theatre(name, unit_type, is_ot=1):
	unit_name = f"{name} - _TC"
	if frappe.db.exists("Healthcare Service Unit", unit_name):
		return unit_name
	parent = frappe.db.get_value("Healthcare Service Unit", {"company": "_Test Company", "is_group": 1})
	unit = frappe.get_doc(
		{
			"doctype": "Healthcare Service Unit",
			"healthcare_service_unit_name": name,
			"company": "_Test Company",
			"parent_healthcare_service_unit": parent,
			"service_unit_type": create_theatre_type(unit_type, is_ot=is_ot).name,
		}
	)
	return unit.insert().name


def create_ot_template(name, duration, theatre_type=None, requires_ot=1):
	fields = {
		"requires_ot": requires_ot,
		"default_duration": duration,
		"required_theatre_type": theatre_type and create_theatre_type(theatre_type).name,
	}
	if frappe.db.exists("Clinical Procedure Template", name):
		return frappe.get_doc("Clinical Procedure Template", name).update(fields).save()
	return frappe.get_doc(
		{
			"doctype": "Clinical Procedure Template",
			"template": name,
			"item_code": name,
			"item_group": "Services",
			"description": name,
			**fields,
		}
	).insert()


def create_service_request(patient, practitioner, template="_Test Procedure - Hernia Repair"):
	request = frappe.get_doc(
		{
			"doctype": "Service Request",
			"order_date": nowdate(),
			"order_time": nowtime(),
			"company": "_Test Company",
			"patient": patient,
			"practitioner": practitioner,
			"status": "draft-Request Status",
			"quantity": 1,
			"template_dt": "Clinical Procedure Template",
			"template_dn": template,
		}
	)
	request.insert(ignore_permissions=True)
	request.submit()
	return request
