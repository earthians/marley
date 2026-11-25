import frappe
from frappe.utils import getdate, now_datetime, nowdate, nowtime


def create_allergy(allergy_name, category="Medication", substance_type="Medication Class", substance=None):
	return frappe.get_doc(
		{
			"doctype": "Allergy",
			"allergy_name": allergy_name,
			"category": category,
			"substance_type": substance_type,
			"substance": substance,
		}
	).insert()


def create_procedure(procedure_template, patient, practitioner, submit=True):
	procedure = frappe.new_doc("Clinical Procedure")
	procedure.procedure_template = procedure_template.name
	procedure.patient = patient
	procedure.practitioner = practitioner
	procedure.consume_stock = procedure_template.consume_stock
	procedure.items = procedure_template.items
	procedure.company = "_Test Company"
	procedure.warehouse = "_Test Warehouse - _TC"
	procedure.start_date = frappe.utils.getdate()
	procedure.start_time = frappe.utils.nowtime()
	if submit:
		procedure.submit()
	else:
		procedure.insert()
	return procedure


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


def create_lab_test(lab_template):
	patient = "_Test Patient"
	lab_test = frappe.new_doc("Lab Test")
	lab_test.template = lab_template.name
	lab_test.patient = patient
	lab_test.patient_sex = "Female"
	lab_test.company = "_Test Company"
	lab_test.save()

	return lab_test


def create_encounter_with_lab_tests():
	patient = "_Test Patient"
	insulin_resistance_template = frappe.get_doc("Lab Test Template", "_Test Lab Test - Sensitivity")
	blood_test_template = frappe.get_doc("Lab Test Template", "_Test Lab Test - with Sample")

	patient_encounter = frappe.new_doc("Patient Encounter")
	patient_encounter.appointment_type = "_Test Appointment Type"
	patient_encounter.patient = patient
	patient_encounter.practitioner = "_Test Healthcare Practitioner 2"
	patient_encounter.encounter_date = getdate()
	patient_encounter.encounter_time = nowtime()

	tests = [insulin_resistance_template, blood_test_template]
	for entry in tests:
		patient_encounter.append(
			"lab_test_prescription", {"lab_test_code": entry.item, "lab_test_name": entry.lab_test_name}
		)

	patient_encounter.submit()
	return patient_encounter


def create_patient(id=0, patient_name=None, email=None, mobile=None, customer=None, create_user=False):
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


def create_encounter_from_appointment(
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


def create_encounter_with_order(
	patient,
	practitioner,
	type,
	template,
	appointment_type=None,
	procedure_template=None,
	therapy_type=None,
	obs=False,
	submit=False,
):
	patient_encounter = frappe.new_doc("Patient Encounter")
	patient_encounter.patient = patient
	patient_encounter.appointment_type = appointment_type or "_Test Appointment Type"
	patient_encounter.practitioner = practitioner
	patient_encounter.encounter_date = getdate()
	patient_encounter.encounter_time = nowtime()
	patient_encounter.company = "_Test Company"
	if not obs:
		if type == "lab_test_prescription":
			patient_encounter.append(
				type, {"lab_test_code": template.item, "lab_test_name": template.lab_test_name}
			)
		elif type == "drug_prescription":
			patient_encounter.append(
				type,
				{
					"medication": template.name,
					"drug_code": template.linked_items[0].get("item"),
					"dosage": "0-0-1",
					"period": "1 Day",
				},
			)
	else:
		patient_encounter.append(type, {"observation_template": template.name})

	if procedure_template:
		patient_encounter.append(
			"procedure_prescription",
			{
				"procedure": procedure_template.name,
				"procedure_name": procedure_template.item_code,
				"no_of_sessions": 1,
			},
		)
	if therapy_type:
		patient_encounter.append(
			"therapies",
			{"therapy_type": therapy_type.name, "no_of_sessions": 1},
		)

	if submit:
		patient_encounter.submit()
	else:
		patient_encounter.save()

	return patient_encounter


def create_therapy_plan(template=None, patient=None):
	if not patient:
		patient = "_Test Patient"

	therapy_type = "Basic Rehab"
	practitioner = "_Test Healthcare Practitioner 2"
	plan = frappe.new_doc("Therapy Plan")
	plan.patient = patient
	plan.start_date = getdate()
	plan.company = "_Test Company"
	plan.practitioner = practitioner
	plan.practitioner_name = frappe.db.get_value("Healthcare Practitioner", practitioner, "practitioner_name")

	if template:
		plan.therapy_plan_template = template
		plan = plan.set_therapy_details_from_template()
	else:
		plan.append("therapy_plan_details", {"therapy_type": therapy_type, "no_of_sessions": 2})

	plan.save()
	return plan


def create_encounter_with_therapy(patient, medical_department, practitioner, submit=True):
	encounter = frappe.new_doc("Patient Encounter")
	encounter.patient = patient
	encounter.practitioner = practitioner
	encounter.medical_department = medical_department
	encounter.appointment_type = "_Test Appointment Type with Items for Service Unit"
	encounter.source = "Direct"
	therapy_type = "Basic Rehab"
	encounter.append("therapies", {"therapy_type": therapy_type, "no_of_sessions": 2})
	encounter.company = "_Test Company"
	encounter.save()
	if submit:
		encounter.submit()
	return encounter


def create_therapy_session(patient, therapy_type, therapy_plan, duration=0, start_date=None):
	if not start_date:
		start_date = nowdate()
	therapy_session = frappe.new_doc("Therapy Session")
	therapy_session.patient = patient
	therapy_session.therapy_type = therapy_type
	therapy_session.therapy_plan = therapy_plan
	therapy_session.duration = duration
	therapy_session.start_date = start_date
	therapy_session.company = "_Test Company"
	therapy_session.save()

	return therapy_session


def create_encounter(patient, practitioner, submit=False, **kwargs):
	encounter = frappe.new_doc("Patient Encounter")
	encounter.patient = patient
	encounter.practitioner = practitioner
	encounter.company = "_Test Company"
	encounter.appointment_type = "_Test Appointment Type"
	encounter.update(kwargs)
	encounter.save()
	if submit:
		encounter.submit()
	return encounter
