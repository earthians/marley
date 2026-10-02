# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.utils import add_to_date, now_datetime

from healthcare.healthcare.doctype.emergency_record.emergency_record import (
	get_active_triage,
	occupancy_qty,
)
from healthcare.tests.utils import HealthcareTestSuite


class TestEmergencyRecord(HealthcareTestSuite):
	def test_registration_defaults_to_registered(self):
		record = create_emergency_record("_Test Patient")
		self.assertEqual(record.status, "Registered")
		self.assertTrue(record.name.startswith("HLC-ED-"))

	def test_patient_age_populated(self):
		frappe.db.set_value("Patient", "_Test Patient", "dob", "1990-01-01")
		record = create_emergency_record("_Test Patient")
		self.assertTrue(record.patient_age)
		self.assertIn("Year", record.patient_age)

	def test_manual_age_preserved_without_dob(self):
		frappe.db.set_value("Patient", "_Test Patient", "dob", None)
		record = create_emergency_record("_Test Patient", patient_age="40 Years")
		self.assertEqual(record.patient_age, "40 Years")

	def test_provisional_patient_created_when_unidentified(self):
		record = create_unidentified_record("Unconscious male approx 40", gender="Male")
		self.assertTrue(record.patient)
		self.assertTrue(record.patient.startswith("ER-"))
		self.assertEqual(
			frappe.db.get_value("Patient", record.patient, "first_name"), "Unconscious male approx 40"
		)
		self.assertEqual(frappe.db.get_value("Patient", record.patient, "sex"), "Male")

	def test_merge_patient_into_existing(self):
		record = create_unidentified_record("Unidentified", gender="Other")
		provisional = record.patient
		record.merge_patient("_Test Patient")
		self.assertFalse(frappe.db.exists("Patient", provisional))
		self.assertEqual(frappe.db.get_value("Emergency Record", record.name, "patient"), "_Test Patient")
		self.assertEqual(frappe.db.get_value("Patient", "_Test Patient", "emergency_record"), record.name)

	def test_patient_stamped_on_registration(self):
		record = create_emergency_record("_Test Patient")
		self.assertEqual(frappe.db.get_value("Patient", "_Test Patient", "emergency_record"), record.name)

	def test_patient_cleared_on_disposition(self):
		record = create_emergency_record("_Test Patient")
		record.set_disposition("Discharged")
		self.assertIsNone(frappe.db.get_value("Patient", "_Test Patient", "emergency_record"))

	def test_consultation_defaults_from_practitioner(self):
		practitioner = get_test_practitioner()
		record = create_emergency_record("_Test Patient", attending_practitioner=practitioner)
		self.assertEqual(record.consultation_item, "HLC-SI-001")
		self.assertEqual(record.consultation_charge, 500)

	def test_consultation_fee_manual_override_preserved(self):
		practitioner = get_test_practitioner()
		record = create_emergency_record(
			"_Test Patient", attending_practitioner=practitioner, consultation_charge=999
		)
		self.assertEqual(record.consultation_charge, 999)

	def test_record_triage_sets_acuity_and_status(self):
		record = create_emergency_record("_Test Patient")
		record.record_triage("Urgent")
		record.reload()
		self.assertEqual(record.status, "Triaged")
		self.assertEqual(record.triage_level, "Urgent")
		self.assertTrue(record.triage_datetime)

	def test_assign_bed_occupies_unit(self):
		bed = "_Test HSU - Occupancy - _TC"
		record = create_emergency_record("_Test Patient")
		record.assign_bed(bed)
		record.reload()
		self.assertEqual(record.status, "In Treatment")
		self.assertEqual(record.service_unit, bed)
		self.assertEqual(occupancy_status(bed), "Occupied")

	def test_transfer_bed_moves_occupancy(self):
		bed_one = "_Test HSU - Occupancy - _TC"
		bed_two = "_Test HSU - OT - _TC"
		record = create_emergency_record("_Test Patient")
		record.assign_bed(bed_one)
		record.transfer_bed(bed_two)
		record.reload()
		self.assertEqual(record.service_unit, bed_two)
		self.assertEqual(occupancy_status(bed_one), "Vacant")
		self.assertEqual(occupancy_status(bed_two), "Occupied")
		self.assertEqual([o.left for o in record.occupancies], [1, 0])

	def test_release_bed_frees_unit(self):
		bed = "_Test HSU - Occupancy - _TC"
		record = create_emergency_record("_Test Patient")
		record.assign_bed(bed)
		record.release_bed()
		record.reload()
		self.assertFalse(record.service_unit)
		self.assertEqual(occupancy_status(bed), "Vacant")

	def test_occupancy_qty_blocks_and_minimum(self):
		self.assertEqual(occupancy_qty(2, 1, 1), 2)
		self.assertEqual(occupancy_qty(2.5, 1, 1), 3)
		self.assertEqual(occupancy_qty(48, 24, 1), 2)
		self.assertEqual(occupancy_qty(0, 24, 5), 5)

	def test_occupancy_billable_items(self):
		bed = "_Test HSU - Occupancy - _TC"
		record = create_emergency_record("_Test Patient")
		record.assign_bed(bed, check_in=add_to_date(now_datetime(), hours=-2))
		items = record.get_occupancy_billable_items()
		expected_item, rate = frappe.db.get_value(
			"Healthcare Service Unit Type", "_Test Service Unit Type - Occupancy", ["item", "rate"]
		)
		self.assertEqual(len(items), 1)
		self.assertEqual(items[0]["item_code"], expected_item)
		self.assertEqual(items[0]["qty"], 1)
		self.assertEqual(items[0]["rate"], rate)

	def test_non_billable_unit_has_no_charge(self):
		record = create_emergency_record("_Test Patient")
		record.assign_bed("_Test HSU - OT - _TC")
		self.assertEqual(record.get_occupancy_billable_items(), [])

	def test_occupied_bed_cannot_be_reassigned(self):
		bed = "_Test HSU - Occupancy - _TC"
		create_emergency_record("_Test Patient").assign_bed(bed)
		other = create_emergency_record("_Test Patient 1")
		self.assertRaises(frappe.ValidationError, other.assign_bed, bed)

	def test_occupancy_checkout_before_checkin_is_rejected(self):
		record = create_emergency_record("_Test Patient")
		record.append(
			"occupancies",
			{
				"service_unit": "_Test HSU - Occupancy - _TC",
				"check_in": now_datetime(),
				"check_out": add_to_date(now_datetime(), hours=-1),
			},
		)
		self.assertRaises(frappe.ValidationError, record.save)

	def test_record_vitals_creates_observations(self):
		record = create_emergency_record("_Test Patient")
		record.add_vital_signs([{"template": "Pulse", "result": "82"}])
		observations = frappe.get_all(
			"Observation",
			filters={
				"reference_doctype": "Emergency Record",
				"reference_docname": record.name,
				"observation_category": "Vital Signs",
			},
			fields=["observation_template", "result"],
		)
		self.assertEqual(len(observations), 1)
		self.assertEqual(observations[0].observation_template, "Pulse")
		self.assertEqual(observations[0].result, "82")

	def test_get_vital_signs_returns_recorded(self):
		record = create_emergency_record("_Test Patient")
		record.add_vital_signs(
			[{"template": "Pulse", "result": "80"}, {"template": "Respiratory Rate", "result": "16"}]
		)
		vitals = record.get_vital_signs()
		self.assertEqual(len(vitals), 2)
		self.assertEqual({v["observation_template"] for v in vitals}, {"Pulse", "Respiratory Rate"})

	def test_vitals_use_triage_practitioner(self):
		practitioner = get_test_practitioner()
		record = create_emergency_record("_Test Patient", triage_practitioner=practitioner)
		record.add_vital_signs([{"template": "Pulse", "result": "80"}])
		recorded_by = frappe.db.get_value(
			"Observation",
			{"reference_doctype": "Emergency Record", "reference_docname": record.name},
			"healthcare_practitioner",
		)
		self.assertEqual(recorded_by, practitioner)

	def test_discharge_closes_record_and_frees_bed(self):
		bed = "_Test HSU - Occupancy - _TC"
		record = create_emergency_record("_Test Patient")
		record.assign_bed(bed)
		record.set_disposition("Discharged")
		record.reload()
		self.assertEqual(record.status, "Closed")
		self.assertEqual(record.disposition, "Discharged")
		self.assertFalse(record.service_unit)
		self.assertEqual(occupancy_status(bed), "Vacant")

	def test_non_admit_dispositions_close_and_free_bed(self):
		bed = "_Test HSU - Occupancy - _TC"
		for disposition in ("Transferred", "Left Without Being Seen", "Deceased"):
			with self.subTest(disposition=disposition):
				record = create_emergency_record("_Test Patient")
				record.assign_bed(bed)
				record.set_disposition(disposition, notes="handover note")
				record.reload()
				self.assertEqual(record.status, "Closed")
				self.assertEqual(record.disposition, disposition)
				self.assertEqual(record.disposition_notes, "handover note")
				self.assertFalse(record.inpatient_record)
				self.assertEqual(occupancy_status(bed), "Vacant")

	def test_admit_disposition_creates_inpatient_record(self):
		bed = "_Test HSU - Occupancy - _TC"
		record = create_emergency_record("_Test Patient")
		record.assign_bed(bed)
		record.set_disposition("Admitted")
		record.reload()
		self.assertEqual(record.status, "Closed")
		self.assertTrue(record.inpatient_record)
		self.assertTrue(frappe.db.exists("Inpatient Record", record.inpatient_record))
		self.assertEqual(occupancy_status(bed), "Vacant")

	def test_admit_copies_details_to_inpatient_record(self):
		practitioner = get_test_practitioner()
		record = create_emergency_record(
			"_Test Patient",
			attending_practitioner=practitioner,
			medical_department="_Test Medical Department",
			chief_complaint="Severe chest pain",
		)
		record.assign_bed("_Test HSU - Occupancy - _TC")
		record.set_disposition("Admitted")
		inpatient = frappe.get_doc("Inpatient Record", record.inpatient_record)
		self.assertEqual(inpatient.patient, "_Test Patient")
		self.assertEqual(inpatient.primary_practitioner, practitioner)
		self.assertEqual(inpatient.admission_instruction, "Severe chest pain")
		self.assertEqual(inpatient.status, "Admission Scheduled")

	def test_create_sales_invoice(self):
		frappe.db.set_value("Patient", "_Test Patient", "customer", "_Test Customer")
		record = create_emergency_record("_Test Patient", attending_practitioner=get_test_practitioner())
		record.assign_bed("_Test HSU - Occupancy - _TC", check_in=add_to_date(now_datetime(), hours=-2))
		invoice_name = record.create_sales_invoice()
		record.reload()
		self.assertEqual(record.sales_invoice, invoice_name)

		invoice = frappe.get_doc("Sales Invoice", invoice_name)
		item_codes = [row.item_code for row in invoice.items]
		self.assertIn("HLC-SI-001", item_codes)
		bed_item = frappe.db.get_value(
			"Healthcare Service Unit Type", "_Test Service Unit Type - Occupancy", "item"
		)
		self.assertIn(bed_item, item_codes)
		self.assertEqual(invoice.patient, "_Test Patient")

	def test_create_sales_invoice_blocks_double(self):
		frappe.db.set_value("Patient", "_Test Patient", "customer", "_Test Customer")
		record = create_emergency_record("_Test Patient", attending_practitioner=get_test_practitioner())
		record.create_sales_invoice()
		self.assertRaises(frappe.ValidationError, record.create_sales_invoice)

	def test_create_sales_invoice_requires_customer(self):
		frappe.db.set_value("Patient", "_Test Patient", "customer", None)
		record = create_emergency_record("_Test Patient", attending_practitioner=get_test_practitioner())
		self.assertRaises(frappe.ValidationError, record.create_sales_invoice)

	def test_emergency_services_surface_in_patient_billing(self):
		from healthcare.healthcare.utils import get_healthcare_services_to_invoice

		frappe.db.set_value("Patient", "_Test Patient", "customer", "_Test Customer")
		record = create_emergency_record("_Test Patient", attending_practitioner=get_test_practitioner())
		record.assign_bed("_Test HSU - Occupancy - _TC", check_in=add_to_date(now_datetime(), hours=-2))

		services = get_healthcare_services_to_invoice("_Test Patient", "_Test Customer", "_Test Company")
		references = {(row["reference_type"], row["reference_name"]) for row in services}
		self.assertIn(("Emergency Record", record.name), references)
		self.assertIn(("Emergency Occupancy", record.occupancies[0].name), references)

	def test_invoiced_occupancy_excluded_from_billing(self):
		from healthcare.healthcare.utils import get_emergency_services_to_invoice

		patient = frappe.get_doc("Patient", "_Test Patient")
		record = create_emergency_record("_Test Patient", attending_practitioner=get_test_practitioner())
		record.assign_bed("_Test HSU - Occupancy - _TC", check_in=add_to_date(now_datetime(), hours=-2))
		frappe.db.set_value("Emergency Occupancy", record.occupancies[0].name, "invoiced", 1)

		occupancy_refs = [
			row["reference_name"]
			for row in get_emergency_services_to_invoice(patient, "_Test Company")
			if row["reference_type"] == "Emergency Occupancy"
		]
		self.assertNotIn(record.occupancies[0].name, occupancy_refs)

	def test_create_insurance_coverage_requires_policy(self):
		record = create_emergency_record("_Test Patient")
		self.assertRaises(frappe.ValidationError, record.create_insurance_coverage)

	def test_get_active_triage_returns_colour(self):
		record = create_emergency_record("_Test Patient")
		record.record_triage("Emergency")
		triage = get_active_triage("_Test Patient")
		self.assertEqual(triage["triage_level"], "Emergency")
		self.assertEqual(triage["emergency_record"], record.name)
		self.assertTrue(triage["color"])

	def test_get_active_triage_returns_most_recent(self):
		older = create_emergency_record(
			"_Test Patient", arrival_datetime=add_to_date(now_datetime(), hours=-2)
		)
		older.record_triage("Non-urgent")
		newer = create_emergency_record("_Test Patient")
		newer.record_triage("Emergency")
		triage = get_active_triage("_Test Patient")
		self.assertEqual(triage["emergency_record"], newer.name)
		self.assertEqual(triage["triage_level"], "Emergency")

	def test_get_active_triage_none_without_record(self):
		self.assertIsNone(get_active_triage("_Test Patient 3"))

	def test_get_active_triage_none_without_triage(self):
		create_emergency_record("_Test Patient")
		self.assertIsNone(get_active_triage("_Test Patient"))

	def test_get_active_triage_ignores_closed(self):
		record = create_emergency_record("_Test Patient")
		record.record_triage("Urgent")
		record.set_disposition("Discharged")
		self.assertIsNone(get_active_triage("_Test Patient"))


def create_emergency_record(patient, **extra):
	values = {
		"doctype": "Emergency Record",
		"patient": patient,
		"company": "_Test Company",
		"arrival_datetime": now_datetime(),
		"arrival_mode": "Walk-in",
		"chief_complaint": "Chest pain",
	}
	values.update(extra)
	record = frappe.get_doc(values)
	record.insert(ignore_permissions=True)
	return record


def create_unidentified_record(patient_description, gender="Other"):
	record = frappe.get_doc(
		{
			"doctype": "Emergency Record",
			"company": "_Test Company",
			"arrival_datetime": now_datetime(),
			"arrival_mode": "Ambulance",
			"patient_description": patient_description,
			"gender": gender,
		}
	)
	record.insert(ignore_permissions=True)
	return record


def get_test_practitioner():
	return frappe.db.get_value("Healthcare Practitioner", {"last_name": "Healthcare Practitioner 0"}, "name")


def occupancy_status(service_unit):
	return frappe.db.get_value("Healthcare Service Unit", service_unit, "occupancy_status")
