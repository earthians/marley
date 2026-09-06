# Copyright (c) 2015, ESS LLP and Contributors
# See license.txt


import frappe
from frappe.utils import add_days, date_diff, getdate, nowdate

from erpnext.accounts.doctype.pos_profile.test_pos_profile import make_pos_profile

from healthcare.healthcare.doctype.fee_validity.fee_validity import (
	check_fee_validity,
	create_fee_validity,
	get_fee_validity,
	manage_fee_validity,
	update_validity_status,
)
from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import create_inpatient
from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import (
	create_appointment,
	update_status,
)
from healthcare.healthcare.utils import get_encounters_to_invoice
from healthcare.tests.test_utils import create_encounter
from healthcare.tests.utils import HealthcareTestSuite


class TestFeeValidity(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		frappe.db.sql("""delete from `tabPatient Appointment`""")
		frappe.db.sql("""delete from `tabPatient Encounter`""")
		frappe.db.sql("""delete from `tabFee Validity`""")
		make_pos_profile()

	def test_fee_validity(self):
		patient = frappe.get_list("Patient", pluck="name")[0]
		practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
		item = "HLC-SI-001"

		healthcare_settings = frappe.get_single("Healthcare Settings")
		healthcare_settings.enable_free_follow_ups = 1
		healthcare_settings.max_visits = 1
		healthcare_settings.valid_days = 7
		healthcare_settings.show_payment_popup = 1
		healthcare_settings.op_consulting_charge_item = item
		healthcare_settings.save(ignore_permissions=True)

		# For first appointment, invoice is generated. First appointment not considered in fee validity
		appointment = create_appointment(patient, practitioner, nowdate())
		fee_validity = frappe.db.exists(
			"Fee Validity",
			{
				"patient": patient,
				"practitioner": practitioner,
				"reference_dt": "Patient Appointment",
				"reference_dn": appointment.name,
			},
		)
		invoiced = frappe.db.get_value("Patient Appointment", appointment.name, "invoiced")
		self.assertEqual(invoiced, 1)
		self.assertTrue(fee_validity)
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "status"), "Active")

		# appointment should not be invoiced as it is within fee validity
		appointment = create_appointment(patient, practitioner, add_days(nowdate(), 4))
		invoiced = frappe.db.get_value("Patient Appointment", appointment.name, "invoiced")
		self.assertEqual(invoiced, 0)

		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 1)
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "status"), "Completed")

		# appointment should be invoiced as it is within fee validity but the max_visits are exceeded, should insert new fee validity
		appointment = create_appointment(patient, practitioner, add_days(nowdate(), 5), invoice=1)
		invoiced = frappe.db.get_value("Patient Appointment", appointment.name, "invoiced")
		self.assertEqual(invoiced, 1)

		fee_validity = frappe.db.exists(
			"Fee Validity",
			{
				"patient": patient,
				"practitioner": practitioner,
				"reference_dt": "Patient Appointment",
				"reference_dn": appointment.name,
			},
		)
		self.assertTrue(fee_validity)
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "status"), "Active")

		# appointment should be invoiced as it is not within fee validity and insert new fee validity
		appointment = create_appointment(patient, practitioner, add_days(nowdate(), 13), invoice=1)
		invoiced = frappe.db.get_value("Patient Appointment", appointment.name, "invoiced")
		self.assertEqual(invoiced, 1)

		fee_validity = frappe.db.exists(
			"Fee Validity",
			{
				"patient": patient,
				"practitioner": practitioner,
				"reference_dt": "Patient Appointment",
				"reference_dn": appointment.name,
			},
		)
		self.assertTrue(fee_validity)
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "status"), "Active")

		# For first appointment cancel should cancel fee validity
		update_status(appointment.name, "Cancelled")
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "status"), "Cancelled")

	def test_practitioner_fee_validity(self):
		patient = frappe.get_list("Patient", pluck="name")[0]
		practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
		item = "HLC-SI-001"

		healthcare_settings = frappe.get_single("Healthcare Settings")
		healthcare_settings.enable_free_follow_ups = 1
		healthcare_settings.max_visits = 1
		healthcare_settings.valid_days = 7
		healthcare_settings.show_payment_popup = 1
		healthcare_settings.op_consulting_charge_item = item
		healthcare_settings.save(ignore_permissions=True)

		frappe.db.set_value(
			"Healthcare Practitioner",
			practitioner,
			{"enable_free_follow_ups": 1, "max_visits": 2, "valid_days": 5},
		)

		# For first appointment, invoice is generated. First appointment not considered in fee validity
		appointment = create_appointment(patient, practitioner, nowdate())
		fee_validity = frappe.db.exists(
			"Fee Validity",
			{
				"patient": patient,
				"practitioner": practitioner,
				"reference_dt": "Patient Appointment",
				"reference_dn": appointment.name,
			},
		)
		invoiced = frappe.db.get_value("Patient Appointment", appointment.name, "invoiced")
		self.assertEqual(invoiced, 1)
		self.assertTrue(fee_validity)
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "status"), "Active")
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "max_visits"), 2)

		start_date, valid_till = frappe.db.get_value(
			"Fee Validity", fee_validity, ["start_date", "valid_till"]
		)
		self.assertEqual(date_diff(valid_till, start_date), 5)

	def test_encounter_billed_when_setting_disabled(self):
		"""Free follow ups must not apply to encounters until explicitly opted in"""
		patient, practitioner = self.enable_free_follow_ups(apply_on_encounters=0)

		first = create_encounter(patient, practitioner, submit=True)
		second = create_encounter(patient, practitioner, submit=True)

		self.assertFalse(
			frappe.db.exists("Fee Validity", {"reference_dt": "Patient Encounter"}),
			"Fee Validity created for an encounter while the setting is disabled",
		)
		for encounter in (first, second):
			self.assertIn(encounter.name, self.encounters_to_invoice(patient))

	def test_fee_validity_for_encounter(self):
		patient, practitioner = self.enable_free_follow_ups()

		# first encounter is billed and starts the validity
		first = create_encounter(patient, practitioner, submit=True)
		fee_validity = frappe.db.exists(
			"Fee Validity", {"reference_dt": "Patient Encounter", "reference_dn": first.name}
		)
		self.assertTrue(fee_validity)
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "status"), "Active")
		self.assertIn(first.name, self.encounters_to_invoice(patient))

		# second encounter is a free follow up, so it is not billed
		second = create_encounter(patient, practitioner, submit=True)
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 1)
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "status"), "Completed")
		self.assertNotIn(second.name, self.encounters_to_invoice(patient))

		# max visits are used up, so the third encounter is billed and starts a new validity
		third = create_encounter(patient, practitioner, submit=True)
		self.assertIn(third.name, self.encounters_to_invoice(patient))
		self.assertTrue(
			frappe.db.exists(
				"Fee Validity", {"reference_dt": "Patient Encounter", "reference_dn": third.name}
			)
		)

	def test_fee_validity_shared_between_appointment_and_encounter(self):
		patient, practitioner = self.enable_free_follow_ups()

		appointment = create_appointment(patient, practitioner, nowdate())
		fee_validity = frappe.db.exists(
			"Fee Validity", {"reference_dt": "Patient Appointment", "reference_dn": appointment.name}
		)
		self.assertTrue(fee_validity)

		# the walk in encounter consumes the visit the appointment paid for
		encounter = create_encounter(patient, practitioner, submit=True)
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 1)
		self.assertNotIn(encounter.name, self.encounters_to_invoice(patient))

	def test_encounter_with_appointment_ignored(self):
		"""An encounter booked through an appointment is counted on the appointment only"""
		patient, practitioner = self.enable_free_follow_ups()

		create_appointment(patient, practitioner, nowdate())
		appointment = create_appointment(patient, practitioner, add_days(nowdate(), 1))
		fee_validity = frappe.db.get_value(
			"Fee Validity", {"patient": patient, "practitioner": practitioner}, "name"
		)
		visited = frappe.db.get_value("Fee Validity", fee_validity, "visited")

		create_encounter(patient, practitioner, submit=True, appointment=appointment.name)

		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), visited)

	def test_cancel_encounter_restores_visit(self):
		patient, practitioner = self.enable_free_follow_ups()

		create_encounter(patient, practitioner, submit=True)
		encounter = create_encounter(patient, practitioner, submit=True)
		fee_validity = frappe.db.get_value(
			"Fee Validity", {"patient": patient, "practitioner": practitioner}, "name"
		)
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 1)

		encounter.cancel()

		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 0)
		self.assertFalse(
			frappe.db.exists(
				"Fee Validity Reference",
				{"reference_dt": "Patient Encounter", "reference_dn": encounter.name},
			)
		)

	def enable_free_follow_ups(self, apply_on_encounters=1, max_visits=1, valid_days=7):
		patient = frappe.get_list("Patient", pluck="name")[0]
		practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]

		healthcare_settings = frappe.get_single("Healthcare Settings")
		healthcare_settings.enable_free_follow_ups = 1
		healthcare_settings.apply_free_follow_ups_on_encounters = apply_on_encounters
		healthcare_settings.max_visits = max_visits
		healthcare_settings.valid_days = valid_days
		healthcare_settings.show_payment_popup = 1
		healthcare_settings.op_consulting_charge_item = "HLC-SI-001"
		healthcare_settings.save(ignore_permissions=True)

		return patient, practitioner

	def encounters_to_invoice(self, patient):
		patient = frappe.get_doc("Patient", patient)
		return [
			item["reference_name"]
			for item in get_encounters_to_invoice(patient, "_Test Company")
			if item["reference_type"] == "Patient Encounter"
		]

	def test_expired_validity_status_is_updated(self):
		patient, practitioner = self.enable_free_follow_ups()
		encounter = create_encounter(patient, practitioner, submit=True)
		fee_validity = self.get_fee_validity(patient, practitioner)

		frappe.db.set_value("Fee Validity", fee_validity, "valid_till", add_days(nowdate(), -1))
		update_validity_status()

		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "status"), "Expired")
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "reference_dn"), encounter.name)

	def test_create_fee_validity_skipped_when_one_is_active(self):
		patient, practitioner = self.enable_free_follow_ups()
		encounter = create_encounter(patient, practitioner, submit=True)

		self.assertIsNone(create_fee_validity(encounter))

	def test_check_fee_validity_accepts_serialized_visit(self):
		patient, practitioner = self.enable_free_follow_ups()
		encounter = create_encounter(patient, practitioner, submit=True)

		fee_validity = check_fee_validity(frappe.as_json(encounter.as_dict()))

		self.assertEqual(fee_validity.reference_dn, encounter.name)

	def test_check_fee_validity_when_free_follow_ups_disabled(self):
		patient, practitioner = self.enable_free_follow_ups(apply_on_encounters=0)
		encounter = create_encounter(patient, practitioner, submit=True)

		self.assertIsNone(check_fee_validity(encounter))

	def test_check_fee_validity_for_unsaved_visit(self):
		patient, practitioner = self.enable_free_follow_ups()

		encounter = frappe.new_doc("Patient Encounter")
		encounter.patient = patient
		encounter.practitioner = practitioner
		encounter.encounter_date = nowdate()

		self.assertIsNone(check_fee_validity(encounter))

	def test_reschedule_invoiced_visit_shifts_validity(self):
		patient, practitioner = self.enable_free_follow_ups()
		appointment = create_appointment(patient, practitioner, nowdate(), invoice=1)
		fee_validity = self.get_fee_validity(patient, practitioner)

		new_date = add_days(nowdate(), 2)
		appointment.db_set("appointment_date", new_date)
		appointment.reload()
		manage_fee_validity(appointment)

		start_date, valid_till = frappe.db.get_value(
			"Fee Validity", fee_validity, ["start_date", "valid_till"]
		)
		self.assertEqual(start_date, getdate(new_date))
		self.assertEqual(date_diff(valid_till, start_date), 7)

	def test_reschedule_uses_practitioner_valid_days(self):
		patient, practitioner = self.enable_free_follow_ups()
		frappe.db.set_value(
			"Healthcare Practitioner",
			practitioner,
			{"enable_free_follow_ups": 1, "max_visits": 2, "valid_days": 5},
		)
		appointment = create_appointment(patient, practitioner, nowdate(), invoice=1)
		fee_validity = self.get_fee_validity(patient, practitioner)

		new_date = add_days(nowdate(), 2)
		appointment.db_set("appointment_date", new_date)
		appointment.reload()
		manage_fee_validity(appointment)

		start_date, valid_till = frappe.db.get_value(
			"Fee Validity", fee_validity, ["start_date", "valid_till"]
		)
		self.assertEqual(start_date, getdate(new_date))
		self.assertEqual(date_diff(valid_till, start_date), 5)

	def test_visit_not_counted_again_when_validity_is_completed(self):
		patient, practitioner = self.enable_free_follow_ups()
		create_appointment(patient, practitioner, nowdate())
		follow_up = create_appointment(patient, practitioner, add_days(nowdate(), 1))
		fee_validity = self.get_fee_validity(patient, practitioner)

		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "status"), "Completed")

		self.assertIsNone(manage_fee_validity(follow_up))
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 1)

	def test_reschedule_outside_validity_releases_visit(self):
		patient, practitioner = self.enable_free_follow_ups(max_visits=2)
		create_appointment(patient, practitioner, nowdate())
		follow_up = create_appointment(patient, practitioner, add_days(nowdate(), 1))
		fee_validity = self.get_fee_validity(patient, practitioner)
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 1)

		follow_up.db_set("appointment_date", add_days(nowdate(), 30))
		follow_up.reload()
		manage_fee_validity(follow_up)

		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 0)
		self.assertFalse(
			frappe.db.exists(
				"Fee Validity Reference",
				{"reference_dt": "Patient Appointment", "reference_dn": follow_up.name},
			)
		)

	def test_get_fee_validity_returns_none_for_unknown_visit(self):
		self.assertIsNone(get_fee_validity(None, nowdate()))
		self.assertIsNone(get_fee_validity("HLC-ENC-MISSING", nowdate(), reference_dt="Patient Encounter"))

	def get_fee_validity(self, patient, practitioner):
		return frappe.db.get_value("Fee Validity", {"patient": patient, "practitioner": practitioner}, "name")

	def test_invoiced_visit_keeps_validity_dates_when_not_rescheduled(self):
		patient, practitioner = self.enable_free_follow_ups()
		appointment = create_appointment(patient, practitioner, nowdate(), invoice=1)
		fee_validity = self.get_fee_validity(patient, practitioner)
		dates = frappe.db.get_value("Fee Validity", fee_validity, ["start_date", "valid_till"])

		appointment.reload()
		manage_fee_validity(appointment)

		self.assertEqual(
			frappe.db.get_value("Fee Validity", fee_validity, ["start_date", "valid_till"]), dates
		)

	def test_released_visit_does_not_drive_the_counter_negative(self):
		patient, practitioner = self.enable_free_follow_ups(max_visits=2)
		create_appointment(patient, practitioner, nowdate())
		follow_up = create_appointment(patient, practitioner, add_days(nowdate(), 1))
		fee_validity = self.get_fee_validity(patient, practitioner)

		# the reference row is left behind with a counter that is already spent
		frappe.db.set_value("Fee Validity", fee_validity, "visited", 0)

		follow_up.db_set("appointment_date", add_days(nowdate(), 30))
		follow_up.reload()
		manage_fee_validity(follow_up)

		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 0)
		self.assertFalse(
			frappe.db.exists(
				"Fee Validity Reference",
				{"reference_dt": "Patient Appointment", "reference_dn": follow_up.name},
			)
		)

	def test_encounter_validity_is_consumed_by_appointment(self):
		"""A validity started by a walk in encounter must cover a later appointment"""
		patient, practitioner = self.enable_free_follow_ups()
		encounter = create_encounter(patient, practitioner, submit=True)
		fee_validity = self.get_fee_validity(patient, practitioner)
		self.assertEqual(
			frappe.db.get_value("Fee Validity", fee_validity, "reference_dt"), "Patient Encounter"
		)

		appointment = create_appointment(patient, practitioner, add_days(nowdate(), 1))

		self.assertEqual(frappe.db.get_value("Patient Appointment", appointment.name, "invoiced"), 0)
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 1)
		self.assertTrue(
			frappe.db.exists(
				"Fee Validity Reference",
				{
					"parent": fee_validity,
					"reference_dt": "Patient Appointment",
					"reference_dn": appointment.name,
				},
			)
		)
		self.assertIn(encounter.name, self.encounters_to_invoice(patient))

	def test_visits_share_one_pool_across_doctypes(self):
		"""Appointments and encounters draw from the same max_visits budget"""
		patient, practitioner = self.enable_free_follow_ups(max_visits=2)
		create_encounter(patient, practitioner, submit=True)
		fee_validity = self.get_fee_validity(patient, practitioner)

		appointment = create_appointment(patient, practitioner, add_days(nowdate(), 1))
		self.assertEqual(frappe.db.get_value("Patient Appointment", appointment.name, "invoiced"), 0)
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 1)

		free_encounter = create_encounter(patient, practitioner, submit=True)
		self.assertNotIn(free_encounter.name, self.encounters_to_invoice(patient))
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 2)
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "status"), "Completed")

		# the budget is spent, so the next visit of either kind is billed again
		billed = create_appointment(patient, practitioner, add_days(nowdate(), 2), invoice=1)
		self.assertEqual(frappe.db.get_value("Patient Appointment", billed.name, "invoiced"), 1)

	def test_only_one_active_validity_per_patient_and_practitioner(self):
		"""A visit before an active validity must not open a second, overlapping one"""
		patient, practitioner = self.enable_free_follow_ups(max_visits=4, valid_days=30)

		# the appointment is booked for tomorrow, so its validity starts tomorrow
		appointment = create_appointment(patient, practitioner, add_days(nowdate(), 1))
		fee_validity = self.get_fee_validity(patient, practitioner)
		self.assertEqual(
			frappe.db.get_value("Fee Validity", fee_validity, "start_date"), getdate(add_days(nowdate(), 1))
		)

		# an encounter recorded today falls before that start date
		encounter = create_encounter(patient, practitioner, submit=True)

		validities = frappe.get_all(
			"Fee Validity", {"patient": patient, "practitioner": practitioner, "status": "Active"}
		)
		self.assertEqual(len(validities), 1)
		self.assertEqual(validities[0].name, fee_validity)
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "reference_dn"), appointment.name)

		# it consumes the one validity rather than being billed for nothing
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 1)
		self.assertNotIn(encounter.name, self.encounters_to_invoice(patient))

		# and the window stretches back to cover it
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "start_date"), getdate(nowdate()))

	def test_inpatient_encounter_is_left_out_of_fee_validity(self):
		patient, practitioner = self.enable_free_follow_ups()
		inpatient_record = self.admit(patient)

		create_encounter(patient, practitioner, submit=True, inpatient_record=inpatient_record)

		self.assertFalse(frappe.db.exists("Fee Validity", {"patient": patient, "practitioner": practitioner}))

	def test_inpatient_appointment_is_left_out_of_fee_validity(self):
		patient, practitioner = self.enable_free_follow_ups()
		self.admit(patient)

		create_appointment(patient, practitioner, nowdate())

		self.assertFalse(frappe.db.exists("Fee Validity", {"patient": patient, "practitioner": practitioner}))

	def test_inpatient_encounter_does_not_consume_an_active_validity(self):
		patient, practitioner = self.enable_free_follow_ups(max_visits=4)
		create_encounter(patient, practitioner, submit=True)
		fee_validity = self.get_fee_validity(patient, practitioner)

		inpatient_record = self.admit(patient)
		inpatient_encounter = create_encounter(
			patient, practitioner, submit=True, inpatient_record=inpatient_record
		)

		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 0)
		self.assertFalse(
			frappe.db.exists(
				"Fee Validity Reference",
				{"reference_dt": "Patient Encounter", "reference_dn": inpatient_encounter.name},
			)
		)

	def admit(self, patient):
		inpatient_record = create_inpatient(patient)
		inpatient_record.expected_length_of_stay = 0
		inpatient_record.save(ignore_permissions=True)
		frappe.db.set_value("Patient", patient, "inpatient_record", inpatient_record.name)
		self.addCleanup(frappe.db.set_value, "Patient", patient, "inpatient_record", None)
		return inpatient_record.name
