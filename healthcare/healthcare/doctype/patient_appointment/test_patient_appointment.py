# Copyright (c) 2015, ESS LLP and Contributors
# See license.txt


import datetime

import frappe
from frappe.utils import add_days, flt, get_time, getdate, now_datetime, nowdate, nowtime

from erpnext.accounts.doctype.pos_profile.test_pos_profile import make_pos_profile

from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
	check_in_appointment,
	check_is_new_patient,
	check_payment_reqd,
	get_availability_data,
	invoice_appointment,
	make_encounter,
	update_status,
)
from healthcare.healthcare.doctype.service_request.service_request import make_clinical_procedure
from healthcare.tests.utils import HealthcareTestSuite


class TestPatientAppointment(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		frappe.db.sql("""delete from `tabPatient Appointment`""")
		frappe.db.sql("""delete from `tabFee Validity`""")
		frappe.db.sql("""delete from `tabPatient Encounter`""")
		make_pos_profile()
		frappe.db.sql("DELETE FROM `tabPractitioner Availability`")

		self.patient = frappe.get_list("Patient", pluck="name")[0]
		self.practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]

	def test_status(self):
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 0)
		appointment = create_appointment(self.patient, self.practitioner, nowdate())
		self.assertEqual(appointment.status, "Open")
		appointment = create_appointment(self.patient, self.practitioner, add_days(nowdate(), 2))
		self.assertEqual(appointment.status, "Scheduled")
		encounter = create_encounter(appointment)
		self.assertEqual(frappe.db.get_value("Patient Appointment", appointment.name, "status"), "Closed")
		encounter.cancel()
		self.assertEqual(frappe.db.get_value("Patient Appointment", appointment.name, "status"), "Open")

	def test_check_in_appointment(self):
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 0)
		default_duration = frappe.db.get_value(
			"Appointment Type", "_Test Appointment Type", "default_duration"
		)
		appointment = create_appointment(
			self.patient, self.practitioner, nowdate(), duration=default_duration
		)
		self.assertEqual(appointment.status, "Open")

		check_in_appointment(appointment.name, practitioner=self.practitioner)
		appointment.reload()
		self.assertEqual(appointment.status, "Checked In")
		self.assertEqual(appointment.practitioner, self.practitioner)
		self.assertEqual(appointment.position_in_queue, 1)

	def test_check_in_past_no_show_appointment(self):
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 0)
		default_duration = frappe.db.get_value(
			"Appointment Type", "_Test Appointment Type", "default_duration"
		)
		appointment = create_appointment(
			self.patient, self.practitioner, add_days(nowdate(), -2), duration=default_duration
		)
		self.assertEqual(appointment.status, "No Show")

		check_in_appointment(appointment.name)
		appointment.reload()
		self.assertEqual(appointment.status, "Checked In")

	def test_cannot_check_in_cancelled_appointment(self):
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 0)
		appointment = create_appointment(self.patient, self.practitioner, nowdate())
		update_status(appointment.name, "Cancelled")
		self.assertRaises(frappe.ValidationError, check_in_appointment, appointment.name)

	def test_start_encounter(self):
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		appointment = create_appointment(self.patient, self.practitioner, add_days(nowdate(), 4), invoice=1)
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
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 0)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 0)
		appointment = create_appointment(self.patient, self.practitioner, nowdate())
		self.assertEqual(frappe.db.get_value("Patient Appointment", appointment.name, "invoiced"), 0)

		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		appointment = create_appointment(self.patient, self.practitioner, add_days(nowdate(), 2), invoice=1)
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
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 0)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		appointment = create_appointment(
			self.patient, self.practitioner, nowdate(), invoice=1, discount_amount=100
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
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 0)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		appointment = create_appointment(
			self.patient, self.practitioner, nowdate(), invoice=1, discount_percentage=10
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
		practitioner = frappe.get_list(
			"Healthcare Practitioner", filters={"last_name": "Healthcare Practitioner 0"}, pluck="name"
		)[0]
		frappe.db.set_value(
			"Healthcare Practitioner",
			practitioner,
			{
				"department": "_Test Medical Department",
				"op_consulting_charge": 0,
				"inpatient_visit_charge": 0,
				"op_consulting_charge_item": "",
				"inpatient_visit_charge_item": "",
			},
		)
		medical_department = "_Test Medical Department"
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 0)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)

		appointment = create_appointment(
			self.patient,
			practitioner,
			add_days(nowdate(), 2),
			invoice=1,
			appointment_type="_Test Appointment Type with Items",
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

		appointment = frappe.new_doc("Patient Appointment")
		appointment.patient = self.patient
		appointment.appointment_type = "_Test Appointment Type with Items for Department"
		appointment.department = "_Test Medical Department"
		appointment.appointment_date = add_days(nowdate(), 2)
		appointment.company = "_Test Company"

		appointment.save(ignore_permissions=True)
		if frappe.db.get_single_value("Healthcare Settings", "show_payment_popup"):
			invoice_appointment(appointment.name)
		appointment.reload()

		self.assertEqual(appointment.invoiced, 1)
		self.assertEqual(appointment.billing_item, "HLC-SI-001")
		self.assertEqual(appointment.paid_amount, 1000)

		sales_invoice_name = frappe.db.get_value(
			"Sales Invoice Item", {"reference_dn": appointment.name}, "parent"
		)
		self.assertTrue(sales_invoice_name)

	def test_auto_invoicing_based_on_service_unit(self):
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 0)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)

		service_unit_type = "_Test Service Unit Type - Appointments"
		service_unit = create_service_unit(
			service_unit_type=service_unit_type,
		)
		appointment = frappe.new_doc("Patient Appointment")
		appointment.patient = frappe.get_list("Patient")[0].name
		appointment.practitioner = frappe.get_list("Healthcare Practitioner")[0].name
		appointment.appointment_type = "_Test Appointment Type with Items for Service Unit"
		appointment.service_unit = service_unit
		appointment.appointment_date = add_days(nowdate(), 3)
		appointment.company = "_Test Company"

		appointment.save(ignore_permissions=True)
		if frappe.db.get_single_value("Healthcare Settings", "show_payment_popup"):
			invoice_appointment(appointment.name)
		appointment.reload()

		self.assertEqual(appointment.invoiced, 1)
		self.assertEqual(appointment.billing_item, "HLC-SI-001")
		self.assertEqual(appointment.paid_amount, 300)

		sales_invoice_name = frappe.db.get_value(
			"Sales Invoice Item", {"reference_dn": appointment.name}, "parent"
		)
		self.assertTrue(sales_invoice_name)

	def test_auto_invoicing_according_to_appointment_type_charge(self):
		frappe.db.set_value(
			"Healthcare Practitioner",
			self.practitioner,
			{
				"op_consulting_charge": 0,
				"inpatient_visit_charge": 0,
				"op_consulting_charge_item": "",
				"inpatient_visit_charge_item": "",
			},
		)
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 0)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)

		appointment = create_appointment(
			self.patient,
			self.practitioner,
			add_days(nowdate(), 2),
			invoice=1,
			appointment_type="_Test Appointment Type with Items",
		)
		appointment.reload()

		self.assertEqual(appointment.invoiced, 1)
		self.assertEqual(appointment.billing_item, "HLC-SI-001")
		self.assertEqual(appointment.paid_amount, 200)

		sales_invoice_name = frappe.db.get_value(
			"Sales Invoice Item", {"reference_dn": appointment.name}, "parent"
		)
		self.assertTrue(sales_invoice_name)

	def test_appointment_cancel(self):
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 1)
		appointment = create_appointment(self.patient, self.practitioner, nowdate())
		fee_validity = frappe.db.get_value(
			"Fee Validity", {"patient": self.patient, "practitioner": self.practitioner}
		)
		# fee validity created
		self.assertTrue(fee_validity)

		# first follow up appointment
		appointment = create_appointment(self.patient, self.practitioner, add_days(nowdate(), 1))
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 1)

		update_status(appointment.name, "Cancelled")
		# check fee validity updated
		self.assertEqual(frappe.db.get_value("Fee Validity", fee_validity, "visited"), 0)

		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 0)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		appointment = create_appointment(self.patient, self.practitioner, add_days(nowdate(), 1), invoice=1)
		update_status(appointment.name, "Cancelled")
		# check invoice cancelled
		sales_invoice_name = frappe.db.get_value(
			"Sales Invoice Item", {"reference_dn": appointment.name}, "parent"
		)
		self.assertEqual(frappe.db.get_value("Sales Invoice", sales_invoice_name, "status"), "Cancelled")

	def test_department_appointment_cancel_with_fee_validity_setting_on(self):
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 1)
		appointment_type = frappe.get_doc(
			"Appointment Type", "_Test Appointment Type with Items for Department"
		)
		appointment = create_appointment(
			patient=self.patient,
			department="_Test Medical Department",
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
		patient = frappe.get_list("Patient", pluck="name")[0]
		practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
		# Schedule Admission
		ip_record = create_inpatient(patient)
		ip_record.expected_length_of_stay = 0
		ip_record.save(ignore_permissions=True)

		# Admit
		service_unit = get_healthcare_service_unit()
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
		# Schedule Admission
		ip_record = create_inpatient(self.patient)
		ip_record.expected_length_of_stay = 0
		ip_record.save(ignore_permissions=True)

		# Admit
		service_unit = get_healthcare_service_unit()
		admit_patient(ip_record, service_unit, now_datetime())

		appointment_service_unit = "_Test HSU - Appointments"
		appointment = create_appointment(
			self.patient, self.practitioner, nowdate(), service_unit=appointment_service_unit, save=0
		)
		self.assertRaises(frappe.exceptions.ValidationError, appointment.save)

		# Discharge
		schedule_discharge(frappe.as_json({"patient": self.patient}))
		ip_record1 = frappe.get_doc("Inpatient Record", ip_record.name)
		mark_invoiced_inpatient_occupancy(ip_record1)
		discharge_patient(ip_record1)

	def test_payment_should_be_mandatory_for_new_patient_appointment(self):
		frappe.db.set_single_value("Healthcare Settings", "enable_free_follow_ups", 1)
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		frappe.db.set_single_value("Healthcare Settings", "max_visits", 3)
		frappe.db.set_single_value("Healthcare Settings", "valid_days", 30)

		patient = frappe.new_doc("Patient")
		patient.first_name = "_Test Patient 99"
		patient.sex = "Female"
		patient.customer_group = "Individual"
		patient.save(ignore_permissions=True)
		assert check_is_new_patient(patient.name)
		payment_required = check_payment_reqd(patient.name)
		assert payment_required is True

	def test_sales_invoice_should_be_generated_for_new_patient_appointment(self):
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 1)
		invoice_count = frappe.db.count("Sales Invoice")

		assert check_is_new_patient(self.patient)
		create_appointment(self.patient, self.practitioner, nowdate())
		new_invoice_count = frappe.db.count("Sales Invoice")

		assert new_invoice_count == invoice_count + 1

	def test_patient_appointment_should_consider_permissions_while_fetching_appointments(self):
		create_appointment(self.patient, self.practitioner, nowdate())

		new_patient = frappe.get_list("Patient", pluck="name")[1]
		new_practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[1]
		create_appointment(new_patient, new_practitioner, nowdate())

		user = frappe.get_doc("User", "gp@marleyhealth.io")
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

		patient_1 = frappe.get_list("Patient", pluck="name")[1]
		practitioner_1 = frappe.get_list("Healthcare Practitioner", pluck="name")[1]

		service_unit = create_service_unit(id=0)
		service_unit_1 = create_service_unit(id=1)
		appointment = create_appointment(
			self.patient, self.practitioner, nowdate(), service_unit=service_unit
		)  # valid

		# patient and practitioner cannot have overlapping appointments
		appointment = create_appointment(
			self.patient, self.practitioner, nowdate(), service_unit=service_unit, save=0
		)
		self.assertRaises(OverlapError, appointment.save)
		appointment = create_appointment(
			self.patient, self.practitioner, nowdate(), service_unit=service_unit_1, save=0
		)  # diff service unit
		self.assertRaises(OverlapError, appointment.save)
		appointment = create_appointment(
			self.patient, self.practitioner, nowdate(), save=0
		)  # with no service unit link
		self.assertRaises(OverlapError, appointment.save)

		# patient cannot have overlapping appointments with other practitioners
		appointment = create_appointment(
			self.patient, practitioner_1, nowdate(), service_unit=service_unit, save=0
		)
		self.assertRaises(OverlapError, appointment.save)
		appointment = create_appointment(
			self.patient, practitioner_1, nowdate(), service_unit=service_unit_1, save=0
		)
		self.assertRaises(OverlapError, appointment.save)
		appointment = create_appointment(self.patient, practitioner_1, nowdate(), save=0)
		self.assertRaises(OverlapError, appointment.save)

		# practitioner cannot have overlapping appointments with other patients
		appointment = create_appointment(
			patient_1, self.practitioner, nowdate(), service_unit=service_unit, save=0
		)
		self.assertRaises(OverlapError, appointment.save)
		appointment = create_appointment(
			patient_1, self.practitioner, nowdate(), service_unit=service_unit_1, save=0
		)
		self.assertRaises(OverlapError, appointment.save)
		appointment = create_appointment(patient_1, self.practitioner, nowdate(), save=0)
		self.assertRaises(OverlapError, appointment.save)

	def test_service_unit_capacity(self):
		from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
			MaximumCapacityError,
			OverlapError,
		)

		patient = frappe.get_list("Patient", pluck="name")[1]
		practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[1]

		capacity = 3
		overlap_service_unit_type = "_Test Service Unit Type - Overlapping Appointments"
		overlap_service_unit = create_service_unit(
			id=100, service_unit_type=overlap_service_unit_type, service_unit_capacity=capacity
		)

		for i in range(0, capacity):
			patient = frappe.get_list("Patient", pluck="name")[i]
			create_appointment(patient, practitioner, nowdate(), service_unit=overlap_service_unit)  # valid
			appointment = create_appointment(
				patient, practitioner, nowdate(), service_unit=overlap_service_unit, save=0
			)  # overlap
			self.assertRaises(OverlapError, appointment.save)

		patient = frappe.get_list("Patient", pluck="name")[5]
		appointment = create_appointment(
			patient, practitioner, nowdate(), service_unit=overlap_service_unit, save=0
		)
		self.assertRaises(MaximumCapacityError, appointment.save)

	def test_tele_consultation(self):
		appointment = create_appointment(self.patient, self.practitioner, nowdate())
		self.assertTrue(appointment.event)
		test_appointment_reschedule(self, appointment)
		test_appointment_cancel(self, appointment)

	def test_appointment_based_on_check_in(self):
		from healthcare.healthcare.doctype.patient_appointment.patient_appointment import OverlapError

		patient = frappe.get_list("Patient", pluck="name")[0]
		practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]

		patient_1 = frappe.get_list("Patient", pluck="name")[1]
		practitioner_1 = frappe.get_list("Healthcare Practitioner", pluck="name")[1]

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

		appointment_type = frappe.get_doc(
			"Appointment Type", "_Test Appointment Type with Items for Department"
		)
		medical_department = "_Test Medical Department 0"
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
		appointment_type = frappe.get_doc(
			"Appointment Type", "_Test Appointment Type with Items for Service Unit"
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
		frappe.db.set_single_value("Healthcare Settings", "show_payment_popup", 0)
		appointment = create_appointment(self.patient, self.practitioner, nowdate())
		procedure_template = frappe.get_doc(
			"Clinical Procedure Template", "_Test Procedure - Knee Surgery and Rehab"
		)
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
			self.patient,
			self.practitioner,
			nowdate(),
			procedure_template=procedure_template.name,
			service_request=service_request,
		)
		make_clinical_procedure(service_request, appointment.name).save()

		self.assertTrue(
			frappe.db.exists(
				"Clinical Procedure",
				{
					"service_request": service_request,
					"patient": self.patient,
					"docstatus": 0,
				},
			)
		)
		self.assertEqual(frappe.db.get_value("Patient Appointment", appointment.name, "status"), "Closed")

	def test_overlap_with_unavailable_same_scope_is_blocked(self):
		create_practitioner_availability(
			"09:00:00",
			"12:00:00",
			scope=self.practitioner,
			scope_type="Healthcare Practitioner",
			service_unit="Service Unit-A",
		)
		create_practitioner_availability(
			"10:15:00",
			"10:45:00",
			scope=self.practitioner,
			scope_type="Healthcare Practitioner",
			service_unit="Service Unit-A",
			type="Unavailable",
		)
		with self.assertRaises(frappe.ValidationError):
			create_appointment(
				self.patient,
				self.practitioner,
				service_unit="Service Unit-A",
				appointment_date=nowdate(),
				appointment_time="10:30:00",
			)

	def test_touching_unavailable_is_allowed(self):
		create_practitioner_availability(
			"09:00:00",
			"12:00:00",
			scope=self.practitioner,
			scope_type="Healthcare Practitioner",
			service_unit="Service Unit-A",
		)
		create_practitioner_availability(
			"10:00:00",
			"10:30:00",
			scope=self.practitioner,
			scope_type="Healthcare Practitioner",
			type="Unavailable",
		)
		create_appointment(
			self.patient,
			self.practitioner,
			service_unit="Service Unit-A",
			appointment_date=nowdate(),
			appointment_time="10:30:00",
		)

	def test_after_unavailable_is_allowed(self):
		create_practitioner_availability(
			"09:00:00",
			"12:00:00",
			scope=self.practitioner,
			scope_type="Healthcare Practitioner",
			service_unit="Service Unit-A",
		)
		create_practitioner_availability(
			"10:00:00",
			"10:30:00",
			scope=self.practitioner,
			scope_type="Healthcare Practitioner",
			type="Unavailable",
		)
		create_appointment(
			self.patient,
			self.practitioner,
			service_unit="Service Unit-A",
			appointment_date=nowdate(),
			appointment_time="10:31:00",
		)

	def test_different_scope_is_allowed(self):
		create_practitioner_availability("09:00:00", "12:00:00", scope="A")
		create_practitioner_availability("10:00:00", "10:30:00", scope="A", type="Unavailable")
		create_appointment(
			self.patient,
			self.practitioner,
			service_unit="Service Unit-B",
			appointment_date=nowdate(),
			appointment_time="10:15:00",
		)

	def test_cancelled_unavailability_is_ignored(self):
		create_practitioner_availability(
			"09:00:00",
			"12:00:00",
			scope=self.practitioner,
			scope_type="Healthcare Practitioner",
			service_unit="Service Unit-A",
		)
		u = create_practitioner_availability(
			"10:00:00",
			"10:30:00",
			scope=self.practitioner,
			scope_type="Healthcare Practitioner",
			type="Unavailable",
		)
		u.submit().cancel()
		create_appointment(
			self.patient,
			self.practitioner,
			service_unit="Service Unit-A",
			appointment_date=nowdate(),
			appointment_time="10:15:00",
		)

	def test_explicit_datetime_overlap_blocks(self):
		create_practitioner_availability("09:00:00", "12:00:00", scope="Service Unit-A")
		create_practitioner_availability("10:15:00", "10:45:00", scope="Service Unit-A", type="Unavailable")
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
		create_practitioner_availability(
			"09:00:00",
			"12:00:00",
			scope_type="Healthcare Practitioner",
			scope=self.practitioner,
			service_unit="Service Unit-A",
		)
		create_practitioner_availability(
			"10:00:00",
			"10:30:00",
			scope_type="Healthcare Practitioner",
			scope=self.practitioner,
			type="Unavailable",
		)
		with self.assertRaises(frappe.ValidationError):
			create_appointment(
				self.patient,
				self.practitioner,
				department="Ortho",
				service_unit="Service Unit-A",
				appointment_date=nowdate(),
				appointment_time="10:05:00",
			)

	def test_scope_priority_department_over_service_unit(self):
		create_practitioner_availability("13:00:00", "14:00:00", scope="Service Unit-A")
		create_practitioner_availability("13:15:00", "13:30:00", scope="Service Unit-A", type="Unavailable")
		with self.assertRaises(frappe.ValidationError):
			create_appointment(
				self.patient,
				department="Ortho",
				service_unit="Service Unit-A",
				appointment_date=nowdate(),
				appointment_time="13:20:00",
			)

	def test_any_scope_field_matching_blocks(self):
		create_practitioner_availability("09:00:00", "11:30:00", scope="Service Unit-A")
		create_practitioner_availability("10:00:00", "10:30:00", scope="Service Unit-A", type="Unavailable")
		with self.assertRaises(frappe.ValidationError):
			create_appointment(
				self.patient,
				self.practitioner,
				department="Ortho",
				service_unit="Service Unit-A",
				appointment_date=nowdate(),
				appointment_time="10:05:00",
			)

	def test_department_match_blocks_even_if_service_unit_differs(self):
		create_practitioner_availability("13:00:00", "14:00:00", scope="Ortho")
		create_practitioner_availability("13:15:00", "13:30:00", scope="Ortho", type="Unavailable")
		# department matches Unavailable scope; service_unit differs -> still blocked
		with self.assertRaises(frappe.ValidationError):
			create_appointment(
				self.patient,
				self.practitioner,
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


def create_patient(id=0, patient_name=None, email=None, mobile=None, customer=None, create_user=False):
	if frappe.db.exists("Patient", {"firstname": f"_Test Patient {id!s}"}):
		patient = frappe.db.get_value("Patient", {"first_name": f"_Test Patient {id!s}"}, ["name"])
		return patient

	patient = frappe.new_doc("Patient")
	patient.first_name = patient_name if patient_name else f"_Test Patient {id!s}"
	patient.sex = "Female"
	patient.mobile = mobile
	patient.email = email
	patient.customer = customer
	patient.customer_group = "Individual"
	patient.invite_user = create_user
	patient.save(ignore_permissions=True)

	return patient.name


def create_practitioner(id=0, medical_department=None):
	if frappe.db.exists("Healthcare Practitioner", {"firstname": f"_Test Healthcare Practitioner {id!s}"}):
		practitioner = frappe.db.get_value(
			"Healthcare Practitioner", {"firstname": f"_Test Healthcare Practitioner {id!s}"}, ["name"]
		)
		return practitioner

	practitioner = frappe.new_doc("Healthcare Practitioner")
	practitioner.first_name = f"_Test Healthcare Practitioner {id!s}"
	practitioner.gender = "Female"
	practitioner.department = medical_department or "_Test Medical Department"
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
	item = "HLC-SI-001"
	frappe.db.set_single_value("Healthcare Settings", "inpatient_visit_charge_item", item)
	frappe.db.set_single_value("Healthcare Settings", "op_consulting_charge_item", item)
	appointment = frappe.new_doc("Patient Appointment")
	appointment.patient = patient
	appointment.practitioner = practitioner
	appointment.appointment_for = appointment_for or "Practitioner"
	appointment.department = department or "_Test Medical Department"
	appointment.appointment_date = appointment_date or nowdate()
	appointment.company = "_Test Company"
	appointment.duration = duration
	appointment.appointment_type = appointment_type or "_Test Appointment Type"

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


def create_service_unit(id=0, service_unit_type=None, service_unit_capacity=0):
	if frappe.db.exists("Healthcare Service Unit", f"_Test Service Unit {id!s}"):
		return f"_Test Service_unit {id!s}"

	service_unit = frappe.new_doc("Healthcare Service Unit")
	service_unit.is_group = 0
	service_unit.healthcare_service_unit_name = f"_Test Service Unit {id!s}"
	service_unit.service_unit_type = service_unit_type or "_Test Service Unit Type - Appointments"
	service_unit.service_unit_capacity = service_unit_capacity
	service_unit.company = "_Test Company"
	service_unit.save(ignore_permissions=True)

	return service_unit.name


def test_appointment_reschedule(self, appointment):
	appointment_datetime = datetime.datetime.combine(
		getdate(appointment.appointment_date), get_time(appointment.appointment_time)
	)
	new_appointment_datetime = appointment_datetime + datetime.timedelta(minutes=flt(appointment.duration))
	appointment.appointment_time = new_appointment_datetime.time()
	appointment.appointment_date = new_appointment_datetime.date()
	appointment.save()
	self.assertTrue(
		frappe.db.exists("Event", {"name": appointment.event, "starts_on": new_appointment_datetime})
	)


def test_appointment_cancel(self, appointment):
	update_status(appointment.name, "Cancelled")
	self.assertTrue(frappe.db.exists("Event", {"name": appointment.event, "status": "Cancelled"}))


class TestAvailabilityAccess(HealthcareTestSuite):
	def setUp(self):
		super().setUp()
		self.patient = frappe.get_list("Patient", pluck="name")[0]
		self.practitioner = frappe.get_list("Healthcare Practitioner", pluck="name")[0]
		self.addCleanup(frappe.set_user, "Administrator")

	def test_availability_data_requires_read_access_to_the_patient(self):
		"""A crafted appointment naming any patient must not reveal that patient's validity"""
		crafted = frappe.as_json({"doctype": "Patient Appointment", "patient": self.patient, "__islocal": 1})

		frappe.set_user("test3@example.com")
		self.assertRaises(
			frappe.PermissionError, get_availability_data, nowdate(), self.practitioner, crafted
		)

	def test_availability_data_requires_read_access_to_the_appointment(self):
		appointment = create_appointment(self.patient, self.practitioner, nowdate())

		frappe.set_user("test3@example.com")
		self.assertRaises(
			frappe.PermissionError,
			get_availability_data,
			nowdate(),
			self.practitioner,
			frappe.as_json(appointment.as_dict()),
		)

	def test_availability_data_rejects_a_document_that_is_not_an_appointment(self):
		crafted = frappe.as_json({"doctype": "Patient Encounter", "patient": self.patient, "__islocal": 1})

		self.assertRaises(
			frappe.ValidationError, get_availability_data, nowdate(), self.practitioner, crafted
		)
