# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt


import frappe
from frappe.utils import add_to_date, flt, now_datetime, nowtime, today
from frappe.utils.make_random import get_random

from healthcare.healthcare.doctype.inpatient_record.inpatient_record import (
	admit_patient,
	discharge_patient,
	get_unbilled_inpatient_docs,
	schedule_discharge,
)
from healthcare.healthcare.doctype.lab_test.test_lab_test import create_patient_encounter
from healthcare.healthcare.utils import get_encounters_to_invoice
from healthcare.tests.utils import HealthcareTestSuite


class TestInpatientRecord(HealthcareTestSuite):
	def test_admit_and_discharge(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")
		patient = frappe.get_list("Patient", pluck="name")[0]
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
		self.assertEqual("Discharge Scheduled", frappe.db.get_value("Patient", patient, "inpatient_status"))
		self.assertEqual(
			"Occupied", frappe.db.get_value("Healthcare Service Unit", service_unit, "occupancy_status")
		)

		ip_record1 = frappe.get_doc("Inpatient Record", ip_record.name)
		# Validate Pending Invoices
		self.assertRaises(frappe.ValidationError, ip_record.discharge)
		mark_invoiced_inpatient_occupancy(ip_record1)

		discharge_patient(ip_record1)
		self.assertEqual(
			"Vacant", frappe.db.get_value("Healthcare Service Unit", service_unit, "occupancy_status")
		)

		self.assertEqual(None, frappe.db.get_value("Patient", patient, "inpatient_record"))
		self.assertEqual(None, frappe.db.get_value("Patient", patient, "inpatient_status"))

	def test_allow_discharge_despite_unbilled_services(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")
		setup_inpatient_settings(key="allow_discharge_despite_unbilled_services", value=1)
		patient = frappe.get_list("Patient", pluck="name")[0]
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
			"Occupied", frappe.db.get_value("Healthcare Service Unit", service_unit, "occupancy_status")
		)

		ip_record = frappe.get_doc("Inpatient Record", ip_record.name)
		# Should not validate Pending Invoices
		ip_record.discharge()
		self.assertEqual(
			"Vacant", frappe.db.get_value("Healthcare Service Unit", service_unit, "occupancy_status")
		)

		self.assertEqual(None, frappe.db.get_value("Patient", patient, "inpatient_record"))
		self.assertEqual(None, frappe.db.get_value("Patient", patient, "inpatient_status"))

		setup_inpatient_settings(key="allow_discharge_despite_unbilled_services", value=0)

	def test_allow_discharge_despite_pending_healthcare_services(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")
		previous_pending_services = frappe.db.get_single_value(
			"Healthcare Settings", "allow_discharge_despite_pending_healthcare_services"
		)
		self.addCleanup(
			setup_inpatient_settings,
			key="allow_discharge_despite_pending_healthcare_services",
			value=previous_pending_services,
		)
		setup_inpatient_settings(key="allow_discharge_despite_pending_healthcare_services", value=1)
		patient = frappe.get_list("Patient", pluck="name")[0]
		ip_record = create_inpatient(patient)
		ip_record.expected_length_of_stay = 0
		ip_record.save(ignore_permissions=True)

		service_unit = get_healthcare_service_unit()
		admit_patient(ip_record, service_unit, now_datetime())
		create_pending_service_request(ip_record)

		schedule_discharge(frappe.as_json({"patient": patient}))
		self.assertEqual(
			"Occupied", frappe.db.get_value("Healthcare Service Unit", service_unit, "occupancy_status")
		)

		ip_record = frappe.get_doc("Inpatient Record", ip_record.name)
		mark_invoiced_inpatient_occupancy(ip_record)
		ip_record.discharge()
		self.assertEqual(
			"Vacant", frappe.db.get_value("Healthcare Service Unit", service_unit, "occupancy_status")
		)
		self.assertEqual(None, frappe.db.get_value("Patient", patient, "inpatient_record"))
		self.assertEqual(None, frappe.db.get_value("Patient", patient, "inpatient_status"))

	def test_discharge_closes_active_nursing_care_plan(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")
		patient = frappe.get_list("Patient", pluck="name")[0]
		ip_record = create_inpatient(patient)
		ip_record.expected_length_of_stay = 0
		ip_record.save(ignore_permissions=True)

		service_unit = get_healthcare_service_unit()
		admit_patient(ip_record, service_unit, now_datetime())

		care_plan = frappe.get_doc(
			{
				"doctype": "Nursing Care Plan",
				"patient": patient,
				"inpatient_record": ip_record.name,
				"goals": [{"goal": "Patient remains comfortable"}],
			}
		).insert(ignore_permissions=True)

		schedule_discharge(frappe.as_json({"patient": patient}))
		ip_record = frappe.get_doc("Inpatient Record", ip_record.name)
		mark_invoiced_inpatient_occupancy(ip_record)
		discharge_patient(ip_record)

		care_plan.reload()
		self.assertEqual(care_plan.status, "Closed")
		self.assertTrue(care_plan.closed_on)

	def test_disallow_discharge_with_pending_healthcare_services(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")
		previous_pending_services = frappe.db.get_single_value(
			"Healthcare Settings", "allow_discharge_despite_pending_healthcare_services"
		)
		self.addCleanup(
			setup_inpatient_settings,
			key="allow_discharge_despite_pending_healthcare_services",
			value=previous_pending_services,
		)
		setup_inpatient_settings(key="allow_discharge_despite_pending_healthcare_services", value=0)
		patient = frappe.get_list("Patient", pluck="name")[0]
		ip_record = create_inpatient(patient)
		ip_record.expected_length_of_stay = 0
		ip_record.save(ignore_permissions=True)

		service_unit = get_healthcare_service_unit()
		admit_patient(ip_record, service_unit, now_datetime())
		create_pending_service_request(ip_record)

		schedule_discharge(frappe.as_json({"patient": patient}))
		ip_record = frappe.get_doc("Inpatient Record", ip_record.name)
		mark_invoiced_inpatient_occupancy(ip_record)
		self.assertRaises(frappe.ValidationError, ip_record.discharge)
		self.assertEqual(
			"Occupied", frappe.db.get_value("Healthcare Service Unit", service_unit, "occupancy_status")
		)

	def test_do_not_bill_patient_encounters_for_inpatients(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")
		previous_do_not_bill = frappe.db.get_single_value(
			"Healthcare Settings", "do_not_bill_inpatient_encounters"
		)
		previous_pending_services = frappe.db.get_single_value(
			"Healthcare Settings", "allow_discharge_despite_pending_healthcare_services"
		)
		self.addCleanup(
			setup_inpatient_settings,
			key="do_not_bill_inpatient_encounters",
			value=previous_do_not_bill,
		)
		self.addCleanup(
			setup_inpatient_settings,
			key="allow_discharge_despite_pending_healthcare_services",
			value=previous_pending_services,
		)
		setup_inpatient_settings(key="do_not_bill_inpatient_encounters", value=1)
		setup_inpatient_settings(key="allow_discharge_despite_pending_healthcare_services", value=1)
		patient = frappe.get_list("Patient", pluck="name")[0]
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
			"Occupied", frappe.db.get_value("Healthcare Service Unit", service_unit, "occupancy_status")
		)

		ip_record = frappe.get_doc("Inpatient Record", ip_record.name)
		mark_invoiced_inpatient_occupancy(ip_record)
		discharge_patient(ip_record)
		self.assertEqual(
			"Vacant", frappe.db.get_value("Healthcare Service Unit", service_unit, "occupancy_status")
		)

	def test_validate_overlap_admission(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")
		patient = frappe.get_list("Patient", pluck="name")[0]

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

	def test_validate_admission_on_vacant_service_unit(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")
		patient_1 = frappe.get_list("Patient", pluck="name")[0]
		patient_2 = frappe.get_list("Patient", pluck="name")[1]

		ip_record_1 = create_inpatient(patient_1)
		ip_record_1.expected_length_of_stay = 0
		ip_record_1.save(ignore_permissions=True)

		ip_record_2 = create_inpatient(patient_2)
		ip_record_2.expected_length_of_stay = 0
		ip_record_2.save(ignore_permissions=True)

		# # Admit
		service_unit = get_healthcare_service_unit()
		admit_patient(ip_record_1, service_unit, now_datetime())

		with self.assertRaises(frappe.ValidationError):
			admit_patient(ip_record_2, service_unit, now_datetime())
		frappe.db.sql("""delete from `tabInpatient Record`""")

	def test_unbilled_lab_test_blocks_discharge(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")
		ip_record = admit_inpatient()
		lab_test = create_inpatient_lab_test(ip_record)

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

	def test_validate_billables(self):
		frappe.db.sql("""delete from `tabInpatient Record`""")

		# Setup test patient and inpatient record
		patient = frappe.get_list("Patient", pluck="name")[0]
		ip_record = create_inpatient(patient)
		ip_record.expected_length_of_stay = 0
		ip_record.save(ignore_permissions=True)

		# Setup service unit and mark as billable
		service_unit = get_healthcare_service_unit()
		service_unit_type = frappe.get_cached_value(
			"Healthcare Service Unit", service_unit, "service_unit_type"
		)
		service_unit_type_doc = frappe.get_doc("Healthcare Service Unit Type", service_unit_type)
		service_unit_type_doc.update(
			{
				"is_billable": 1,
				"item_code": service_unit_type,
				"item_group": "Services",
				"uom": "Day",
				"no_of_hours": 24,
				"minimum_billable_qty": 0,
				"rate": 1000,
			}
		)
		service_unit_type_doc.save()

		# Admit patient with backdated timestamp (12 hours ago)
		checkin = add_to_date(now_datetime(), hours=-12)
		admit_patient(ip_record, service_unit, checkin, currency="INR")

		# allow items (like OT) to have 0 as Item Price Rate - disable this check
		# Remove any existing Item Price to force the error
		# frappe.db.sql(f"""delete from `tabItem Price` where item_code='{service_unit_type}'""")

		# # Expect frappe.throw when Item Price is missing
		# with self.assertRaises(frappe.ValidationError):
		# 	ip_record.add_service_unit_rent_to_billable_items()

		# # Now, create a valid Item Price and ensure it proceeds correctly
		# price_list_name = frappe.db.get_value("Price List", {"selling": 1})
		# frappe.get_doc(
		# 	{
		# 		"doctype": "Item Price",
		# 		"price_list": price_list_name,
		# 		"item_code": service_unit_type,
		# 		"uom": "Day",
		# 		"price_list_rate": 1000,
		# 	}
		# ).insert(ignore_permissions=True, ignore_mandatory=True)

		# Generate Billables
		ip_record.add_service_unit_rent_to_billable_items()
		ip_record.reload()

		self.assertTrue(frappe.db.exists("Inpatient Record Item", {"parent": ip_record.name}))
		self.assertEqual(1000, ip_record.items[0].get("rate"))
		self.assertEqual("Day", ip_record.items[0].get("uom"))
		self.assertEqual(0.5, flt(ip_record.items[0].get("quantity"), 2))
		self.assertEqual(500, flt(ip_record.items[0].get("amount"), 2))


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
	patient = frappe.get_list("Patient", pluck="name")[0]
	inpatient_record = create_inpatient(patient)
	inpatient_record.expected_length_of_stay = 0
	inpatient_record.save(ignore_permissions=True)
	admit_patient(inpatient_record, get_healthcare_service_unit(), now_datetime())
	return inpatient_record


def create_inpatient_lab_test(inpatient_record):
	lab_test = frappe.new_doc("Lab Test")
	lab_test.template = "_Test Lab Test - without Sample"
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


def create_pending_service_request(ip_record):
	patient = frappe.get_doc("Patient", ip_record.patient)
	service_request = frappe.get_doc(
		{
			"doctype": "Service Request",
			"order_date": today(),
			"order_time": nowtime(),
			"company": "_Test Company",
			"patient": ip_record.patient,
			"patient_name": patient.patient_name,
			"patient_gender": patient.sex,
			"practitioner": frappe.get_list("Healthcare Practitioner", pluck="name")[0],
			"inpatient_record": ip_record.name,
			"status": "draft-Request Status",
			"quantity": 1,
			"template_dt": "Lab Test Template",
			"template_dn": "_Test Lab Test - with Sample",
		}
	)
	service_request.insert(ignore_permissions=True, ignore_mandatory=True)
	service_request.submit()
	return service_request


def get_healthcare_service_unit(unit_name=None):
	service_unit = frappe.get_doc("Healthcare Service Unit", "_Test HSU - Occupancy - _TC")
	service_unit.occupancy_status = "Vacant"
	service_unit.save()
	return service_unit.name
