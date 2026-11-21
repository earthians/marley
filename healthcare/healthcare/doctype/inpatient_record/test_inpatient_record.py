# -*- coding: utf-8 -*-
# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt


import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import now_datetime, today
from frappe.utils.make_random import get_random

from healthcare.healthcare.doctype.inpatient_record.inpatient_record import (
	admit_patient,
	discharge_patient,
	get_unbilled_inpatient_docs,
	schedule_discharge,
)
from healthcare.healthcare.doctype.lab_test.test_lab_test import (
	create_lab_test_template,
	create_patient_encounter,
)
from healthcare.healthcare.utils import get_encounters_to_invoice


class TestInpatientRecord(FrappeTestCase):
	def test_admit_and_discharge(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")
		patient = create_patient()
		# Schedule Admission
		ip_record = create_inpatient(patient)
		ip_record.expected_length_of_stay = 0
		ip_record.save(ignore_permissions=True)
		self.assertEqual(ip_record.name, frappe.db.get_value("Patient", patient, "inpatient_record"))
		self.assertEqual(ip_record.status, frappe.db.get_value("Patient", patient, "inpatient_status"))

		# Admit
		service_unit = get_healthcare_service_unit()
		admit_patient(ip_record, service_unit, now_datetime())
		self.assertEqual("Admitted", frappe.db.get_value("Patient", patient, "inpatient_status"))
		self.assertEqual(
			"Occupied", frappe.db.get_value("Healthcare Service Unit", service_unit, "occupancy_status")
		)

		# Discharge
		schedule_discharge(frappe.as_json({"patient": patient}))
		self.assertEqual(
			"Vacant", frappe.db.get_value("Healthcare Service Unit", service_unit, "occupancy_status")
		)

		ip_record1 = frappe.get_doc("Inpatient Record", ip_record.name)
		# Validate Pending Invoices
		self.assertRaises(frappe.ValidationError, ip_record.discharge)
		mark_invoiced_inpatient_occupancy(ip_record1)

		discharge_patient(ip_record1)

		self.assertEqual(None, frappe.db.get_value("Patient", patient, "inpatient_record"))
		self.assertEqual(None, frappe.db.get_value("Patient", patient, "inpatient_status"))

	def test_allow_discharge_despite_unbilled_services(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")
		setup_inpatient_settings(key="allow_discharge_despite_unbilled_services", value=1)
		patient = create_patient()
		# Schedule Admission
		ip_record = create_inpatient(patient)
		ip_record.expected_length_of_stay = 0
		ip_record.save(ignore_permissions=True)

		# Admit
		service_unit = get_healthcare_service_unit()
		admit_patient(ip_record, service_unit, now_datetime())

		# Discharge
		schedule_discharge(frappe.as_json({"patient": patient}))
		self.assertEqual(
			"Vacant", frappe.db.get_value("Healthcare Service Unit", service_unit, "occupancy_status")
		)

		ip_record = frappe.get_doc("Inpatient Record", ip_record.name)
		# Should not validate Pending Invoices
		ip_record.discharge()

		self.assertEqual(None, frappe.db.get_value("Patient", patient, "inpatient_record"))
		self.assertEqual(None, frappe.db.get_value("Patient", patient, "inpatient_status"))

		setup_inpatient_settings(key="allow_discharge_despite_unbilled_services", value=0)

	def test_do_not_bill_patient_encounters_for_inpatients(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")
		setup_inpatient_settings(key="do_not_bill_inpatient_encounters", value=1)
		patient = create_patient()
		# Schedule Admission
		ip_record = create_inpatient(patient)
		ip_record.expected_length_of_stay = 0
		ip_record.save(ignore_permissions=True)

		# Admit
		service_unit = get_healthcare_service_unit()
		admit_patient(ip_record, service_unit, now_datetime())

		# Patient Encounter
		patient_encounter = create_patient_encounter()
		encounters = get_encounters_to_invoice(patient, "_Test Company")
		encounter_ids = [entry.reference_name for entry in encounters]
		self.assertFalse(patient_encounter.name in encounter_ids)

		# Discharge
		schedule_discharge(frappe.as_json({"patient": patient}))
		self.assertEqual(
			"Vacant", frappe.db.get_value("Healthcare Service Unit", service_unit, "occupancy_status")
		)

		ip_record = frappe.get_doc("Inpatient Record", ip_record.name)
		mark_invoiced_inpatient_occupancy(ip_record)
		discharge_patient(ip_record)
		setup_inpatient_settings(key="do_not_bill_inpatient_encounters", value=0)

	def test_validate_overlap_admission(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")
		patient = create_patient()

		ip_record = create_inpatient(patient)
		ip_record.expected_length_of_stay = 0
		ip_record.save(ignore_permissions=True)
		ip_record_new = create_inpatient(patient)
		ip_record_new.expected_length_of_stay = 0
		self.assertRaises(frappe.ValidationError, ip_record_new.save)

		service_unit = get_healthcare_service_unit()
		admit_patient(ip_record, service_unit, now_datetime())
		ip_record_new = create_inpatient(patient)
		self.assertRaises(frappe.ValidationError, ip_record_new.save)
		frappe.db.sql("""delete from `tabInpatient Record`""")

	def test_unbilled_lab_test_blocks_discharge(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")
		ip_record = admit_inpatient()
		lab_test = create_inpatient_lab_test(ip_record)
		lab_test.submit()

		self.assertIn(lab_test.name, get_unbilled_names("Lab Test", ip_record))

		schedule_discharge(frappe.as_json({"patient": ip_record.patient}))
		ip_record = frappe.get_doc("Inpatient Record", ip_record.name)
		mark_invoiced_inpatient_occupancy(ip_record)
		self.assertRaises(frappe.ValidationError, ip_record.discharge)

	def test_cancelled_lab_test_does_not_block_discharge(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")
		ip_record = admit_inpatient()
		service_unit = ip_record.inpatient_occupancies[0].service_unit
		lab_test = create_inpatient_lab_test(ip_record)
		lab_test.submit()
		lab_test.cancel()

		self.assertNotIn(lab_test.name, get_unbilled_names("Lab Test", ip_record))

		schedule_discharge(frappe.as_json({"patient": ip_record.patient}))
		ip_record = frappe.get_doc("Inpatient Record", ip_record.name)
		mark_invoiced_inpatient_occupancy(ip_record)
		ip_record.discharge()
		self.assertEqual(
			"Vacant", frappe.db.get_value("Healthcare Service Unit", service_unit, "occupancy_status")
		)


def mark_invoiced_inpatient_occupancy(ip_record):
	if ip_record.inpatient_occupancies:
		for inpatient_occupancy in ip_record.inpatient_occupancies:
			inpatient_occupancy.invoiced = 1
		ip_record.save(ignore_permissions=True)


def setup_inpatient_settings(key, value):
	settings = frappe.get_single("Healthcare Settings")
	settings.set(key, value)
	settings.save()


def create_inpatient(patient):
	patient_obj = frappe.get_doc("Patient", patient)
	inpatient_record = frappe.new_doc("Inpatient Record")
	inpatient_record.patient = patient
	inpatient_record.patient_name = patient_obj.patient_name
	inpatient_record.gender = patient_obj.sex
	inpatient_record.blood_group = patient_obj.blood_group
	inpatient_record.dob = patient_obj.dob
	inpatient_record.mobile = patient_obj.mobile
	inpatient_record.email = patient_obj.email
	inpatient_record.phone = patient_obj.phone
	inpatient_record.inpatient = "Scheduled"
	inpatient_record.scheduled_date = today()
	inpatient_record.company = "_Test Company"
	return inpatient_record


def admit_inpatient():
	inpatient_record = create_inpatient(create_patient())
	inpatient_record.expected_length_of_stay = 0
	inpatient_record.save(ignore_permissions=True)
	admit_patient(inpatient_record, get_healthcare_service_unit(), now_datetime())
	return inpatient_record


def create_inpatient_lab_test(inpatient_record):
	lab_test = frappe.new_doc("Lab Test")
	lab_test.template = create_lab_test_template(sample_collection=0).name
	lab_test.patient = inpatient_record.patient
	lab_test.patient_sex = inpatient_record.gender
	lab_test.company = "_Test Company"
	lab_test.inpatient_record = inpatient_record.name
	lab_test.save()

	for descriptive_test_item in lab_test.descriptive_test_items:
		descriptive_test_item.result_value = 1
	lab_test.save()

	return lab_test


def get_unbilled_names(doctype, inpatient_record):
	return [entry.name for entry in get_unbilled_inpatient_docs(doctype, inpatient_record)]


def get_healthcare_service_unit(unit_name=None):
	if not unit_name:
		service_unit = get_random(
			"Healthcare Service Unit", filters={"inpatient_occupancy": 1, "company": "_Test Company"}
		)
	else:
		service_unit = frappe.db.exists(
			"Healthcare Service Unit", {"healthcare_service_unit_name": unit_name}
		)

	if not service_unit:
		service_unit = frappe.new_doc("Healthcare Service Unit")
		service_unit.healthcare_service_unit_name = unit_name or "_Test Service Unit Ip Occupancy"
		service_unit.company = "_Test Company"
		service_unit.service_unit_type = get_service_unit_type()
		service_unit.inpatient_occupancy = 1
		service_unit.occupancy_status = "Vacant"
		service_unit.is_group = 0
		service_unit_parent_name = frappe.db.exists(
			{
				"doctype": "Healthcare Service Unit",
				"healthcare_service_unit_name": "_Test All Healthcare Service Units",
				"is_group": 1,
			}
		)
		if not service_unit_parent_name:
			parent_service_unit = frappe.new_doc("Healthcare Service Unit")
			parent_service_unit.healthcare_service_unit_name = "_Test All Healthcare Service Units"
			parent_service_unit.is_group = 1
			parent_service_unit.save(ignore_permissions=True)
			service_unit.parent_healthcare_service_unit = parent_service_unit.name
		else:
			service_unit.parent_healthcare_service_unit = service_unit_parent_name
		service_unit.save(ignore_permissions=True)
		return service_unit.name
	return service_unit


def get_service_unit_type():
	service_unit_type = get_random("Healthcare Service Unit Type", filters={"inpatient_occupancy": 1})

	if not service_unit_type:
		service_unit_type = frappe.new_doc("Healthcare Service Unit Type")
		service_unit_type.service_unit_type = "_Test Service Unit Type Ip Occupancy"
		service_unit_type.inpatient_occupancy = 1
		service_unit_type.save(ignore_permissions=True)
		return service_unit_type.name
	return service_unit_type


def create_patient():
	patient = frappe.db.exists("Patient", "_Test IPD Patient")
	if not patient:
		patient = frappe.new_doc("Patient")
		patient.first_name = "_Test IPD Patient"
		patient.sex = "Female"
		patient.save(ignore_permissions=True)
		patient = patient.name
	return patient
