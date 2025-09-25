# -*- coding: utf-8 -*-
# Copyright (c) 2015, ESS LLP and Contributors
# See license.txt


import datetime

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, flt, get_time, getdate, now_datetime, nowdate, nowtime

from erpnext.accounts.doctype.pos_profile.test_pos_profile import make_pos_profile

from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
	check_is_new_patient,
	check_payment_reqd,
	invoice_appointment,
	make_encounter,
	update_status,
)
from healthcare.healthcare.doctype.service_request.service_request import make_clinical_procedure


class TestPatientAppointment(IntegrationTestCase):
	def setUp(self):
		frappe.db.sql("""delete from `tabPatient Appointment`""")
		frappe.db.sql("""delete from `tabFee Validity`""")
		frappe.db.sql("""delete from `tabPatient Encounter`""")
		make_pos_profile()
		frappe.db.sql("""delete from `tabHealthcare Service Unit` where name like '_Test %'""")
		frappe.db.sql(
			"""delete from `tabHealthcare Service Unit` where name like '_Test Service Unit Type%'"""
		)
		frappe.db.sql("DELETE FROM `tabPractitioner Availability`")

	def test_status(self):
		patient, practitioner = create_healthcare_docs()
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 0)
		appointment = create_appointment(patient, practitioner, nowdate())
		self.assertEqual(appointment.status, "Open")
		appointment = create_appointment(patient, practitioner, add_days(nowdate(), 2))
		self.assertEqual(appointment.status, "Scheduled")
		encounter = create_encounter(appointment)
		self.assertEqual(
			frappe.db.get_value("Patient Appointment", appointment.name, "status"), "Closed"
		)
		encounter.cancel()
		self.assertEqual(frappe.db.get_value("Patient Appointment", appointment.name, "status"), "Open")

	def test_start_encounter(self):
		patient, practitioner = create_healthcare_docs()
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		appointment = create_appointment(patient, practitioner, add_days(nowdate(), 4), invoice=1)
		appointment.reload()
		self.assertEqual(appointment.invoiced, 1)
		encounter = make_encounter(appointment.name)
		self.assertTrue(encounter)
		self.assertEqual(encounter.company, appointment.company)
		self.assertEqual(encounter.practitioner, appointment.practitioner)
		self.assertEqual(encounter.patient, appointment.patient)
		# invoiced flag mapped from appointment
		self.assertEqual(
			encounter.invoiced, frappe.db.get_value("Patient Appointment", appointment.name, "invoiced")
		)

	def test_auto_invoicing(self):
		patient, practitioner = create_healthcare_docs()
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 0)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 0)
		appointment = create_appointment(patient, practitioner, nowdate())
		self.assertEqual(frappe.db.get_value("Patient Appointment", appointment.name, "invoiced"), 0)

		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		appointment = create_appointment(patient, practitioner, add_days(nowdate(), 2), invoice=1)
		self.assertEqual(frappe.db.get_value("Patient Appointment", appointment.name, "invoiced"), 1)
		sales_invoice_name = frappe.db.get_value(
			"Sales Invoice Item", {"reference_dn": appointment.name}, "parent"
		)
		self.assertTrue(sales_invoice_name)
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", sales_invoice_name, "company"), appointment.company
		)
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", sales_invoice_name, "patient"), appointment.patient
		)
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", sales_invoice_name, "paid_amount"), appointment.paid_amount
		)

	def test_auto_invoicing_with_discount_amount(self):
		patient, practitioner = create_healthcare_docs()
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 0)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		appointment = create_appointment(
			patient, practitioner, nowdate(), invoice=1, discount_amount=100
		)
		self.assertEqual(frappe.db.get_value("Patient Appointment", appointment.name, "invoiced"), 1)
		sales_invoice_name = frappe.db.get_value(
			"Sales Invoice Item", {"reference_dn": appointment.name}, "parent"
		)
		self.assertTrue(sales_invoice_name)
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", sales_invoice_name, "company"),
			appointment.company,
		)
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", sales_invoice_name, "patient"),
			appointment.patient,
		)
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", sales_invoice_name, "paid_amount"),
			(appointment.paid_amount - 100),
		)

	def test_auto_invoicing_with_discount_percentage(self):
		patient, practitioner = create_healthcare_docs()
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 0)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		appointment = create_appointment(
			patient, practitioner, nowdate(), invoice=1, discount_percentage=10
		)
		self.assertEqual(frappe.db.get_value("Patient Appointment", appointment.name, "invoiced"), 1)
		sales_invoice_name = frappe.db.get_value(
			"Sales Invoice Item", {"reference_dn": appointment.name}, "parent"
		)
		self.assertTrue(sales_invoice_name)
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", sales_invoice_name, "company"),
			appointment.company,
		)
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", sales_invoice_name, "patient"),
			appointment.patient,
		)
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", sales_invoice_name, "paid_amount"),
			(appointment.paid_amount - (appointment.paid_amount * (10 / 100))),
		)

	def test_auto_invoicing_based_on_practitioner_department(self):
		patient, practitioner = create_healthcare_docs()
		frappe.db.set_value(
			"Healthcare Practitioner",
			practitioner,
			{
				"op_consulting_charge": 0,
				"inpatient_visit_charge": 0,
			},
		)
		medical_department = create_medical_department()
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 0)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		appointment_type = create_appointment_type(
			{"medical_department": medical_department, "op_consulting_charge": 200}
		)

		appointment = create_appointment(
			patient,
			practitioner,
			add_days(nowdate(), 2),
			invoice=1,
			appointment_type=appointment_type.name,
			department=medical_department,
		)
		appointment.reload()

		self.assertEqual(appointment.invoiced, 1)
		self.assertEqual(appointment.billing_item, "HLC-SI-001")
		self.assertEqual(appointment.paid_amount, 200)

		sales_invoice_name = frappe.db.get_value(
			"Sales Invoice Item", {"reference_dn": appointment.name}, "parent"
		)
		self.assertTrue(sales_invoice_name)
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", sales_invoice_name, "paid_amount"), appointment.paid_amount
		)

	def test_auto_invoicing_based_on_department(self):
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 1)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		item = create_healthcare_service_items()
		department_name = create_medical_department(id=111)  # "_Test Medical Department 111"
		items = [
			{
				"dt": "Medical Department",
				"dn": department_name,
				"op_consulting_charge_item": item,
				"op_consulting_charge": 1000,
			}
		]
		appointment_type = create_appointment_type(
			args={
				"name": "_Test General OP",
				"allow_booking_for": "Department",
				"items": items,
				"duration": 15,
			}
		)
		appointment = frappe.new_doc("Patient Appointment")
		appointment.patient = create_patient()
		appointment.appointment_type = appointment_type.name
		appointment.department = department_name
		appointment.appointment_date = add_days(nowdate(), 2)
		appointment.company = "_Test Company"

		appointment.save(ignore_permissions=True)
		if frappe.db.get_single_value("Healthcare Settings", "show_payment_popup"):
			invoice_appointment(appointment.name)
		appointment.reload()

		self.assertEqual(appointment.invoiced, 1)
		self.assertEqual(appointment.billing_item, item)
		self.assertEqual(appointment.paid_amount, 1000)

		sales_invoice_name = frappe.db.get_value(
			"Sales Invoice Item", {"reference_dn": appointment.name}, "parent"
		)
		self.assertTrue(sales_invoice_name)

	def test_auto_invoicing_based_on_service_unit(self):
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 0)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		item = create_healthcare_service_items()
		service_unit_type = create_service_unit_type(id=11, allow_appointments=1)
		service_unit = create_service_unit(
			id=101,
			service_unit_type=service_unit_type,
		)
		items = [
			{
				"dt": "Healthcare Service Unit",
				"dn": service_unit,
				"op_consulting_charge_item": item,
				"op_consulting_charge": 2000,
			}
		]
		appointment_type = create_appointment_type(
			args={
				"name": "_Test XRay Modality",
				"allow_booking_for": "Service Unit",
				"items": items,
				"duration": 15,
			}
		)
		appointment = frappe.new_doc("Patient Appointment")
		appointment.patient = create_patient()
		appointment.appointment_type = appointment_type.name
		appointment.service_unit = service_unit
		appointment.appointment_date = add_days(nowdate(), 3)
		appointment.company = "_Test Company"

		appointment.save(ignore_permissions=True)
		if frappe.db.get_single_value("Healthcare Settings", "show_payment_popup"):
			invoice_appointment(appointment.name)
		appointment.reload()

		self.assertEqual(appointment.invoiced, 1)
		self.assertEqual(appointment.billing_item, item)
		self.assertEqual(appointment.paid_amount, 2000)

		sales_invoice_name = frappe.db.get_value(
			"Sales Invoice Item", {"reference_dn": appointment.name}, "parent"
		)
		self.assertTrue(sales_invoice_name)

	def test_auto_invoicing_according_to_appointment_type_charge(self):
		patient, practitioner = create_healthcare_docs()
		frappe.db.set_value(
			"Healthcare Practitioner",
			practitioner,
			{
				"op_consulting_charge": 0,
				"inpatient_visit_charge": 0,
			},
		)
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 0)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)

		item = create_healthcare_service_items()
		items = [{"op_consulting_charge_item": item, "op_consulting_charge": 300}]
		appointment_type = create_appointment_type(
			args={"name": "Generic Appointment Type charge", "items": items}
		)

		appointment = create_appointment(
			patient, practitioner, add_days(nowdate(), 2), invoice=1, appointment_type=appointment_type.name
		)
		appointment.reload()

		self.assertEqual(appointment.invoiced, 1)
		self.assertEqual(appointment.billing_item, item)
		self.assertEqual(appointment.paid_amount, 300)

		sales_invoice_name = frappe.db.get_value(
			"Sales Invoice Item", {"reference_dn": appointment.name}, "parent"
		)
		self.assertTrue(sales_invoice_name)

	def test_appointment_cancel(self):
		patient, practitioner = create_healthcare_docs()
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 1)
		appointment = create_appointment(patient, practitioner, nowdate())
		fee_validity = frappe.db.get_value(
			"Fee Validity", {"patient": patient, "practitioner": practitioner}
		)
		# fee validity created
		self.assertTrue(fee_validity)

		# first follow up appointment
		appointment = create_appointment(patient, practitioner, add_days(nowdate(), 1))
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 1)

		update_status(appointment.name, "Cancelled")
		# check fee validity updated
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 0)

		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 0)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		appointment = create_appointment(patient, practitioner, add_days(nowdate(), 1), invoice=1)
		update_status(appointment.name, "Cancelled")
		# check invoice cancelled
		sales_invoice_name = frappe.db.get_value(
			"Sales Invoice Item", {"reference_dn": appointment.name}, "parent"
		)
		self.assertEqual(frappe.db.get_value("Sales Invoice", sales_invoice_name, "status"), "Cancelled")

	def test_department_appointment_cancel_with_fee_validity_setting_on(self):
		patient, practitioner = create_healthcare_docs()
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 1)
		depatment = create_medical_department(123)
		appointment_type = create_appointment_type(
			{
				"name": "Department Appointment Type",
				"allow_booking_for": "Department",
				"medical_department": depatment,
			}
		)
		appointment = create_appointment(
			patient=patient,
			department=depatment,
			appointment_for="Department",
			appointment_type=appointment_type.name,
		)

		update_status(appointment.name, "Cancelled")
		appointment.reload()
		self.assertTrue(appointment.status, "Cancelled")

	def test_appointment_booking_for_admission_service_unit(self):
		from healthcare.healthcare.doctype.inpatient_record.inpatient_record import (
			admit_patient,
			discharge_patient,
			schedule_discharge,
		)
		from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import (
			create_inpatient,
			get_healthcare_service_unit,
			mark_invoiced_inpatient_occupancy,
		)

		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		frappe.db.sql("""delete from `tabInpatient Record`""")
		patient = create_patient()
		practitioner = create_practitioner()
		# Schedule Admission
		ip_record = create_inpatient(patient)
		ip_record.expected_length_of_stay = 0
		ip_record.save(ignore_permissions=True)

		# Admit
		service_unit = get_healthcare_service_unit("_Test Service Unit Ip Occupancy")
		admit_patient(ip_record, service_unit, now_datetime())

		appointment = create_appointment(
			patient, practitioner, nowdate(), service_unit=service_unit, invoice=1
		)
		self.assertEqual(appointment.service_unit, service_unit)

		# Discharge
		schedule_discharge(frappe.as_json({"patient": patient}))
		ip_record1 = frappe.get_doc("Inpatient Record", ip_record.name)
		mark_invoiced_inpatient_occupancy(ip_record1)
		discharge_patient(ip_record1)

	def test_invalid_healthcare_service_unit_validation(self):
		from healthcare.healthcare.doctype.inpatient_record.inpatient_record import (
			admit_patient,
			discharge_patient,
			schedule_discharge,
		)
		from healthcare.healthcare.doctype.inpatient_record.test_inpatient_record import (
			create_inpatient,
			get_healthcare_service_unit,
			mark_invoiced_inpatient_occupancy,
		)

		frappe.db.sql("""delete from `tabInpatient Record`""")
		patient, practitioner = create_healthcare_docs()
		patient = create_patient()
		# Schedule Admission
		ip_record = create_inpatient(patient)
		ip_record.expected_length_of_stay = 0
		ip_record.save(ignore_permissions=True)

		# Admit
		service_unit = get_healthcare_service_unit("_Test Service Unit Ip Occupancy")
		admit_patient(ip_record, service_unit, now_datetime())

		appointment_service_unit = get_healthcare_service_unit(
			"_Test Service Unit Ip Occupancy for Appointment"
		)
		appointment = create_appointment(
			patient, practitioner, nowdate(), service_unit=appointment_service_unit, save=0
		)
		self.assertRaises(frappe.exceptions.ValidationError, appointment.save)

		# Discharge
		schedule_discharge(frappe.as_json({"patient": patient}))
		ip_record1 = frappe.get_doc("Inpatient Record", ip_record.name)
		mark_invoiced_inpatient_occupancy(ip_record1)
		discharge_patient(ip_record1)

	def test_payment_should_be_mandatory_for_new_patient_appointment(self):
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 1)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		frappe.db.set_single_value("Healthcare Settings", "max_visits", 3)
		frappe.db.set_single_value("Healthcare Settings", "valid_days", 30)

		patient = create_patient()
		assert check_is_new_patient(patient)
		payment_required = check_payment_reqd(patient)
		assert payment_required is True

	def test_sales_invoice_should_be_generated_for_new_patient_appointment(self):
		patient, practitioner = create_healthcare_docs()
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		invoice_count = frappe.db.count("Sales Invoice")

		assert check_is_new_patient(patient)
		create_appointment(patient, practitioner, nowdate())
		new_invoice_count = frappe.db.count("Sales Invoice")

		assert new_invoice_count == invoice_count + 1

	def test_patient_appointment_should_consider_permissions_while_fetching_appointments(self):
		patient, practitioner = create_healthcare_docs()
		create_appointment(patient, practitioner, nowdate())

		patient, new_practitioner = create_healthcare_docs(id=5)
		create_appointment(patient, new_practitioner, nowdate())

		roles = [{"doctype": "Has Role", "role": "Physician"}]
		user = create_user(roles=roles)
		new_practitioner = frappe.get_doc("Healthcare Practitioner", new_practitioner)
		new_practitioner.user_id = user.email
		new_practitioner.save()

		frappe.set_user(user.name)
		appointments = frappe.get_list("Patient Appointment")
		assert len(appointments) == 1

		frappe.set_user("Administrator")
		appointments = frappe.get_list("Patient Appointment")
		assert len(appointments) == 2

	def test_overlap_appointment(self):
		from healthcare.healthcare.doctype.patient_appointment.patient_appointment import OverlapError

		patient, practitioner = create_healthcare_docs(id=1)
		patient_1, practitioner_1 = create_healthcare_docs(id=2)
		service_unit = create_service_unit(id=0)
		service_unit_1 = create_service_unit(id=1)
		appointment = create_appointment(
			patient, practitioner, nowdate(), service_unit=service_unit
		)  # valid

		# patient and practitioner cannot have overlapping appointments
		appointment = create_appointment(
			patient, practitioner, nowdate(), service_unit=service_unit, save=0
		)
		self.assertRaises(OverlapError, appointment.save)
		appointment = create_appointment(
			patient, practitioner, nowdate(), service_unit=service_unit_1, save=0
		)  # diff service unit
		self.assertRaises(OverlapError, appointment.save)
		appointment = create_appointment(
			patient, practitioner, nowdate(), save=0
		)  # with no service unit link
		self.assertRaises(OverlapError, appointment.save)

		# patient cannot have overlapping appointments with other practitioners
		appointment = create_appointment(
			patient, practitioner_1, nowdate(), service_unit=service_unit, save=0
		)
		self.assertRaises(OverlapError, appointment.save)
		appointment = create_appointment(
			patient, practitioner_1, nowdate(), service_unit=service_unit_1, save=0
		)
		self.assertRaises(OverlapError, appointment.save)
		appointment = create_appointment(patient, practitioner_1, nowdate(), save=0)
		self.assertRaises(OverlapError, appointment.save)

		# practitioner cannot have overlapping appointments with other patients
		appointment = create_appointment(
			patient_1, practitioner, nowdate(), service_unit=service_unit, save=0
		)
		self.assertRaises(OverlapError, appointment.save)
		appointment = create_appointment(
			patient_1, practitioner, nowdate(), service_unit=service_unit_1, save=0
		)
		self.assertRaises(OverlapError, appointment.save)
		appointment = create_appointment(patient_1, practitioner, nowdate(), save=0)
		self.assertRaises(OverlapError, appointment.save)

	def test_service_unit_capacity(self):
		from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
			MaximumCapacityError,
			OverlapError,
		)

		practitioner = create_practitioner()
		capacity = 3
		overlap_service_unit_type = create_service_unit_type(
			id=10, allow_appointments=1, overlap_appointments=1
		)
		overlap_service_unit = create_service_unit(
			id=100, service_unit_type=overlap_service_unit_type, service_unit_capacity=capacity
		)

		for i in range(0, capacity):
			patient = create_patient(id=i)
			create_appointment(patient, practitioner, nowdate(), service_unit=overlap_service_unit)  # valid
			appointment = create_appointment(
				patient, practitioner, nowdate(), service_unit=overlap_service_unit, save=0
			)  # overlap
			self.assertRaises(OverlapError, appointment.save)

		patient = create_patient(id=capacity)
		appointment = create_appointment(
			patient, practitioner, nowdate(), service_unit=overlap_service_unit, save=0
		)
		self.assertRaises(MaximumCapacityError, appointment.save)

	def test_tele_consultation(self):
		patient, practitioner = create_healthcare_docs()
		appointment = create_appointment(patient, practitioner, nowdate())
		self.assertTrue(appointment.event)
		test_appointment_reschedule(self, appointment)
		test_appointment_cancel(self, appointment)

	def test_appointment_based_on_check_in(self):
		from healthcare.healthcare.doctype.patient_appointment.patient_appointment import OverlapError

		patient, practitioner = create_healthcare_docs(id=1)
		patient_1, practitioner_1 = create_healthcare_docs(id=2)

		create_appointment(
			patient,
			practitioner,
			nowdate(),
			appointment_based_on_check_in=True,
			appointment_time="09:00",
		)
		appointment_1 = create_appointment(
			patient,
			practitioner,
			nowdate(),
			save=0,
			appointment_based_on_check_in=True,
			appointment_time="09:00",
		)
		# same patient cannot have multiple appointments for same practitioner
		self.assertRaises(OverlapError, appointment_1.save)

		appointment_1 = create_appointment(
			patient,
			practitioner_1,
			nowdate(),
			save=0,
			appointment_based_on_check_in=True,
			appointment_time="09:00",
		)
		# same patient cannot have multiple appointments for different practitioners
		self.assertRaises(OverlapError, appointment_1.save)

		appointment_2 = create_appointment(
			patient_1,
			practitioner,
			nowdate(),
			appointment_based_on_check_in=True,
			appointment_time="09:00",
		)
		# different practitioner can have multiple same time and date appointments for different patients
		self.assertTrue(appointment_2.name)

		# appointment booked for department
		appointment_type = create_appointment_type(
			args={
				"name": "_Test Department",
				"allow_booking_for": "Department",
				"duration": 15,
			}
		)
		medical_department = create_medical_department(id=2)
		dept_appointment = create_appointment(
			patient,
			None,
			nowdate(),
			appointment_type=appointment_type.name,
			appointment_for="Department",
			department=medical_department,
		)
		self.assertTrue(dept_appointment.appointment_based_on_check_in)
		dept_appointment.status = "Checked In"
		dept_appointment.save()
		self.assertEqual(dept_appointment.position_in_queue, 1)

		dept_appointment_1 = create_appointment(
			patient_1,
			None,
			nowdate(),
			appointment_type=appointment_type.name,
			appointment_for="Department",
			department=medical_department,
		)
		self.assertTrue(dept_appointment_1.appointment_based_on_check_in)
		dept_appointment_1.status = "Checked In"
		dept_appointment_1.save()
		self.assertEqual(dept_appointment_1.position_in_queue, 2)

		# appointment booked for service unit
		service_unit = create_service_unit(id=2)
		appointment_type = create_appointment_type(
			args={
				"name": "_Test Service Unit",
				"allow_booking_for": "Service Unit",
				"duration": 15,
			}
		)
		su_appointment = create_appointment(
			patient,
			None,
			nowdate(),
			appointment_type=appointment_type.name,
			appointment_for="Service Unit",
			service_unit=service_unit,
		)
		self.assertTrue(su_appointment.appointment_based_on_check_in)
		su_appointment.status = "Checked In"
		su_appointment.save()
		self.assertEqual(su_appointment.position_in_queue, 1)

		su_appointment_1 = create_appointment(
			patient_1,
			None,
			nowdate(),
			appointment_type=appointment_type.name,
			appointment_for="Service Unit",
			service_unit=service_unit,
		)
		self.assertTrue(su_appointment_1.appointment_based_on_check_in)
		su_appointment_1.status = "Checked In"
		su_appointment_1.save()
		self.assertEqual(su_appointment_1.position_in_queue, 2)

	def test_appointment_against_an_order(self):
		patient, practitioner = create_healthcare_docs()
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 0)
		appointment = create_appointment(patient, practitioner, nowdate())
		procedure_template = create_clinical_procedure_template()
		encounter = create_encounter(appointment, procedure_template=procedure_template)

		service_request = frappe.db.exists(
			"Service Request",
			{
				"order_group": encounter.name,
				"template_dt": "Clinical Procedure Template",
				"template_dn": procedure_template.name,
			},
		)
		self.assertTrue(service_request)

		appointment = create_appointment(
			patient,
			practitioner,
			nowdate(),
			procedure_template=procedure_template.name,
			service_request=service_request,
		)

		procedure = make_clinical_procedure(service_request, appointment.name).save()

		self.assertTrue(
			frappe.db.exists(
				"Clinical Procedure",
				{
					"service_request": service_request,
					"patient": patient,
					"docstatus": 0,
				},
			)
		)

		self.assertEqual(
			frappe.db.get_value("Patient Appointment", appointment.name, "status"), "Closed"
		)

	def test_overlap_with_unavailable_same_scope_is_blocked(self):
		patient, practitioner = create_healthcare_docs()
		create_practitioner_availability(
			"09:00:00",
			"12:00:00",
			scope=practitioner,
			scope_type="Healthcare Practitioner",
			service_unit="Service Unit-A",
		)
		create_practitioner_availability(
			"10:15:00",
			"10:45:00",
			scope=practitioner,
			scope_type="Healthcare Practitioner",
			service_unit="Service Unit-A",
			type="Unavailable",
		)
		with self.assertRaises(frappe.ValidationError):
			create_appointment(
				patient,
				practitioner,
				service_unit="Service Unit-A",
				appointment_date=nowdate(),
				appointment_time="10:30:00",
			)

	def test_touching_unavailable_is_allowed(self):
		patient, practitioner = create_healthcare_docs()
		create_practitioner_availability(
			"09:00:00",
			"12:00:00",
			scope=practitioner,
			scope_type="Healthcare Practitioner",
			service_unit="Service Unit-A",
		)
		create_practitioner_availability(
			"10:00:00",
			"10:30:00",
			scope=practitioner,
			scope_type="Healthcare Practitioner",
			type="Unavailable",
		)
		create_appointment(
			patient,
			practitioner,
			service_unit="Service Unit-A",
			appointment_date=nowdate(),
			appointment_time="10:30:00",
		)

	def test_after_unavailable_is_allowed(self):
		patient, practitioner = create_healthcare_docs()
		create_practitioner_availability(
			"09:00:00",
			"12:00:00",
			scope=practitioner,
			scope_type="Healthcare Practitioner",
			service_unit="Service Unit-A",
		)
		create_practitioner_availability(
			"10:00:00",
			"10:30:00",
			scope=practitioner,
			scope_type="Healthcare Practitioner",
			type="Unavailable",
		)
		create_appointment(
			patient,
			practitioner,
			service_unit="Service Unit-A",
			appointment_date=nowdate(),
			appointment_time="10:31:00",
		)

	def test_different_scope_is_allowed(self):
		create_practitioner_availability("09:00:00", "12:00:00", scope="A")
		create_practitioner_availability("10:00:00", "10:30:00", scope="A", type="Unavailable")
		patient, practitioner = create_healthcare_docs()
		create_appointment(
			patient,
			practitioner,
			service_unit="Service Unit-B",
			appointment_date=nowdate(),
			appointment_time="10:15:00",
		)

	def test_cancelled_unavailability_is_ignored(self):
		patient, practitioner = create_healthcare_docs()
		create_practitioner_availability(
			"09:00:00",
			"12:00:00",
			scope=practitioner,
			scope_type="Healthcare Practitioner",
			service_unit="Service Unit-A",
		)
		u = create_practitioner_availability(
			"10:00:00",
			"10:30:00",
			scope=practitioner,
			scope_type="Healthcare Practitioner",
			type="Unavailable",
		)
		u.submit().cancel()
		create_appointment(
			patient,
			practitioner,
			service_unit="Service Unit-A",
			appointment_date=nowdate(),
			appointment_time="10:15:00",
		)

	def test_explicit_datetime_overlap_blocks(self):
		create_practitioner_availability("09:00:00", "12:00:00", scope="Service Unit-A")
		create_practitioner_availability(
			"10:15:00", "10:45:00", scope="Service Unit-A", type="Unavailable"
		)
		doc = frappe.get_doc(
			{
				"doctype": "Patient Appointment",
				"status": "Scheduled",
				"service_unit": "Service Unit-A",
				"appointment_date": "2025-01-01",
				"appointment_time": "10:00:00",
				"duration": 0,
				"appointment_datetime": "2025-01-01 10:30:00",
				"appointment_end_datetime": "2025-01-01 10:40:00",
			}
		)
		with self.assertRaises(frappe.ValidationError):
			doc.insert(ignore_permissions=True, ignore_mandatory=True, ignore_links=True)

	def test_scope_priority_practitioner(self):
		patient, practitioner = create_healthcare_docs()
		create_practitioner_availability(
			"09:00:00",
			"12:00:00",
			scope_type="Healthcare Practitioner",
			scope=practitioner,
			service_unit="Service Unit-A",
		)
		create_practitioner_availability(
			"10:00:00",
			"10:30:00",
			scope_type="Healthcare Practitioner",
			scope=practitioner,
			type="Unavailable",
		)
		with self.assertRaises(frappe.ValidationError):
			create_appointment(
				patient,
				practitioner,
				department="Ortho",
				service_unit="Service Unit-A",
				appointment_date=nowdate(),
				appointment_time="10:05:00",
			)

	def test_scope_priority_department_over_service_unit(self):
		create_practitioner_availability("13:00:00", "14:00:00", scope="Service Unit-A")
		create_practitioner_availability(
			"13:15:00", "13:30:00", scope="Service Unit-A", type="Unavailable"
		)
		with self.assertRaises(frappe.ValidationError):
			patient, practitioner = create_healthcare_docs()
			create_appointment(
				patient,
				department="Ortho",
				service_unit="Service Unit-A",
				appointment_date=nowdate(),
				appointment_time="13:20:00",
			)

	def test_any_scope_field_matching_blocks(self):
		create_practitioner_availability("09:00:00", "11:30:00", scope="Service Unit-A")
		create_practitioner_availability(
			"10:00:00", "10:30:00", scope="Service Unit-A", type="Unavailable"
		)
		patient, practitioner = create_healthcare_docs()
		with self.assertRaises(frappe.ValidationError):
			create_appointment(
				patient,
				practitioner,
				department="Ortho",
				service_unit="Service Unit-A",
				appointment_date=nowdate(),
				appointment_time="10:05:00",
			)

	def test_department_match_blocks_even_if_service_unit_differs(self):
		create_practitioner_availability("13:00:00", "14:00:00", scope="Ortho")
		create_practitioner_availability("13:15:00", "13:30:00", scope="Ortho", type="Unavailable")
		patient, practitioner = create_healthcare_docs()
		# department matches Unavailable scope; service_unit differs -> still blocked
		with self.assertRaises(frappe.ValidationError):
			create_appointment(
				patient,
				practitioner,
				department="Ortho",
				service_unit="Service Unit-A",
				appointment_date=nowdate(),
				appointment_time="13:20:00",
			)


def create_practitioner_availability(
	start, end, scope=None, scope_type=None, date=None, type="Available", service_unit=None
):
	return frappe.get_doc(
		{
			"doctype": "Practitioner Availability",
			"type": type,
			"start_date": date or nowdate(),
			"start_time": start,
			"end_date": date or nowdate(),
			"end_time": end,
			"scope_type": scope_type or "Healthcare Service Unit",
			"scope": scope or "Service Unit-A",
			"status": "Active",
			"service_unit": service_unit,
		}
	).insert(ignore_permissions=True, ignore_links=True, ignore_if_duplicate=True)


def create_healthcare_docs(id=0):
	patient = create_patient(id)
	practitioner = create_practitioner(id)

	return patient, practitioner


def create_patient(
	id=0, patient_name=None, email=None, mobile=None, customer=None, create_user=False
):
	if frappe.db.exists("Patient", {"firstname": f"_Test Patient {str(id)}"}):
		patient = frappe.db.get_value("Patient", {"first_name": f"_Test Patient {str(id)}"}, ["name"])
		return patient

	patient = frappe.new_doc("Patient")
	patient.first_name = patient_name if patient_name else f"_Test Patient {str(id)}"
	patient.sex = "Female"
	patient.mobile = mobile
	patient.email = email
	patient.customer = customer
	patient.invite_user = create_user
	patient.save(ignore_permissions=True)

	return patient.name


def create_medical_department(id=0):
	if frappe.db.exists("Medical Department", f"_Test Medical Department {str(id)}"):
		return f"_Test Medical Department {str(id)}"

	medical_department = frappe.new_doc("Medical Department")
	medical_department.department = f"_Test Medical Department {str(id)}"
	medical_department.save(ignore_permissions=True)
	return medical_department.name


def create_practitioner(id=0, medical_department=None):
	if frappe.db.exists(
		"Healthcare Practitioner", {"firstname": f"_Test Healthcare Practitioner {str(id)}"}
	):
		practitioner = frappe.db.get_value(
			"Healthcare Practitioner", {"firstname": f"_Test Healthcare Practitioner {str(id)}"}, ["name"]
		)
		return practitioner

	practitioner = frappe.new_doc("Healthcare Practitioner")
	practitioner.first_name = f"_Test Healthcare Practitioner {str(id)}"
	practitioner.gender = "Female"
	practitioner.department = medical_department or create_medical_department(id)
	practitioner.op_consulting_charge = 500
	practitioner.inpatient_visit_charge = 500
	practitioner.save(ignore_permissions=True)

	return practitioner.name


def create_encounter(
	appointment,
	procedure_template=None,
):
	if appointment:
		encounter = frappe.new_doc("Patient Encounter")
		encounter.appointment = appointment.name
		encounter.appointment_type = appointment.appointment_type
		encounter.patient = appointment.patient
		encounter.practitioner = appointment.practitioner
		encounter.encounter_date = appointment.appointment_date
		encounter.encounter_time = appointment.appointment_time
		encounter.company = appointment.company

		if procedure_template:
			encounter.append(
				"procedure_prescription",
				{
					"procedure": procedure_template.name,
					"procedure_name": procedure_template.item_code,
					"no_of_sessions": 1,
				},
			)
		encounter.save()
		encounter.submit()

		return encounter


def create_appointment(
	patient,
	practitioner=None,
	appointment_date=None,
	invoice=0,
	procedure_template=None,
	service_unit=None,
	appointment_type=None,
	save=1,
	appointment_for=None,
	department=None,
	appointment_based_on_check_in=None,
	appointment_time=None,
	discount_percentage=0,
	discount_amount=0,
	service_request=None,
	duration=15,
):
	item = create_healthcare_service_items()
	frappe.db.set_single_value("Healthcare Settings", "inpatient_visit_charge_item", item)
	frappe.db.set_single_value("Healthcare Settings", "op_consulting_charge_item", item)
	appointment = frappe.new_doc("Patient Appointment")
	appointment.patient = patient
	appointment.practitioner = practitioner
	appointment.appointment_for = appointment_for or "Practitioner"
	appointment.department = department or create_medical_department()
	appointment.appointment_date = appointment_date or nowdate()
	appointment.company = "_Test Company"
	appointment.duration = duration
	appointment.appointment_type = appointment_type or create_appointment_type().name

	if service_unit:
		appointment.service_unit = service_unit
	if invoice:
		appointment.mode_of_payment = "Cash"
	if procedure_template:
		appointment.template_dt = "Clinical Procedure Template"
		appointment.template_dn = procedure_template
		appointment.service_request = service_request
	if appointment_based_on_check_in:
		appointment.appointment_based_on_check_in = True
	if appointment.appointment_type:
		appointment_for = frappe.get_cached_value(
			"Appointment Type", appointment.appointment_type, "allow_booking_for"
		)
		if appointment_for == "Practitioner":
			appointment.appointment_time = appointment_time if appointment_time else nowtime()
	if save:
		appointment.insert(ignore_permissions=True, ignore_links=True)
		if invoice or frappe.db.get_single_value("Healthcare Settings", "show_payment_popup"):
			invoice_appointment(appointment.name, discount_percentage, discount_amount)

	return appointment


def create_healthcare_service_items():
	if frappe.db.exists("Item", "HLC-SI-001"):
		return "HLC-SI-001"

	item = frappe.new_doc("Item")
	item.item_code = "HLC-SI-001"
	item.item_name = "Consulting Charges"
	item.item_group = "Services"
	item.is_stock_item = 0
	item.stock_uom = "Nos"
	item.save()

	return item.name


def create_clinical_procedure_template():
	if frappe.db.exists("Clinical Procedure Template", "Knee Surgery and Rehab"):
		return frappe.get_doc("Clinical Procedure Template", "Knee Surgery and Rehab")

	template = frappe.new_doc("Clinical Procedure Template")
	template.template = "Knee Surgery and Rehab"
	template.item_code = "Knee Surgery and Rehab"
	template.item_group = "Services"
	template.is_billable = 1
	template.description = "Knee Surgery and Rehab"
	template.rate = 50000
	template.save()

	return template


def create_appointment_type(args=None):  # nosemgrep
	if not args:
		args = frappe.local.form_dict

	name = args.get("name", "_Test Appointment Type")

	if frappe.db.exists("Appointment Type", name):
		return frappe.get_doc("Appointment Type", name)

	else:
		item = create_healthcare_service_items()
		items = [
			{
				"dt": "Medical Department",
				"dn": args.get("medical_department") or create_medical_department(),
				"op_consulting_charge_item": item,
				"op_consulting_charge": args.get("op_consulting_charge", 200),
			}
		]
		return frappe.get_doc(
			{
				"doctype": "Appointment Type",
				"appointment_type": name,
				"allow_booking_for": args.get("allow_booking_for", "Practitioner"),
				"default_duration": args.get("default_duration", 20),
				"color": args.get("color", "#7575ff"),
				"price_list": args.get("price_list") or frappe.db.get_value("Price List", {"selling": 1}),
				"items": args.get("items") or items,
			}
		).insert()


def create_user(email=None, roles=None):
	if not email:
		email = "{}@frappe.com".format(frappe.utils.random_string(10))
	user = frappe.db.exists("User", email)
	if not user:
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": "test_user",
				"password": "password",
				"roles": roles,
			}
		).insert()
	return user


def create_service_unit_type(id=0, allow_appointments=1, overlap_appointments=0):
	if frappe.db.exists("Healthcare Service Unit Type", f"_Test Service Unit Type {str(id)}"):
		return f"_Test Service Unit Type {str(id)}"

	service_unit_type = frappe.new_doc("Healthcare Service Unit Type")
	service_unit_type.service_unit_type = f"_Test Service Unit Type {str(id)}"
	service_unit_type.allow_appointments = allow_appointments
	service_unit_type.overlap_appointments = overlap_appointments
	service_unit_type.save(ignore_permissions=True)

	return service_unit_type.name


def create_service_unit(id=0, service_unit_type=None, service_unit_capacity=0):
	if frappe.db.exists("Healthcare Service Unit", f"_Test Service Unit {str(id)}"):
		return f"_Test service_unit {str(id)}"

	service_unit = frappe.new_doc("Healthcare Service Unit")
	service_unit.is_group = 0
	service_unit.healthcare_service_unit_name = f"_Test Service Unit {str(id)}"
	service_unit.service_unit_type = service_unit_type or create_service_unit_type(id)
	service_unit.service_unit_capacity = service_unit_capacity
	service_unit.save(ignore_permissions=True)

	return service_unit.name


def test_appointment_reschedule(self, appointment):
	appointment_datetime = datetime.datetime.combine(
		getdate(appointment.appointment_date), get_time(appointment.appointment_time)
	)
	new_appointment_datetime = appointment_datetime + datetime.timedelta(
		minutes=flt(appointment.duration)
	)
	appointment.appointment_time = new_appointment_datetime.time()
	appointment.appointment_date = new_appointment_datetime.date()
	appointment.save()
	self.assertTrue(
		frappe.db.exists("Event", {"name": appointment.event, "starts_on": new_appointment_datetime})
	)


def test_appointment_cancel(self, appointment):
	update_status(appointment.name, "Cancelled")
	self.assertTrue(frappe.db.exists("Event", {"name": appointment.event, "status": "Cancelled"}))
