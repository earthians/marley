import frappe
from frappe.tests.classes.context_managers import freeze_time

from erpnext.tests.utils import ERPNextTestSuite


def healthcare_owns_abdm_settings():
	"""The marley_abdm app replaces this legacy doctype with a Single of the same name."""
	return frappe.get_meta("ABDM Settings").module == "Healthcare"


class BootStrapTestData:
	def __init__(self):
		self.make_master_data()

	def make_master_data(self):
		self.make_company()
		self.make_service_items()
		self.make_stock_items()
		self.make_diagnoses()
		self.make_medical_departments()
		self.make_users()
		self.make_patients()
		self.make_practitioners()
		self.make_service_unit_types()
		self.make_service_units()
		self.make_appointment_types()
		self.make_clinical_procedure_templates()
		self.make_lab_test_samples()
		self.make_lab_test_templates()
		self.make_observation_templates()
		self.make_care_activity()
		self.make_nursing_checklist_templates()
		self.make_exercise_types()
		self.make_therapy_types()
		self.make_therapy_plan_templates()
		self.make_medication_classes()
		self.make_medications()
		self.make_treatment_plan_templates()
		self.make_insurance_payors()
		self.make_custom_doctypes()
		self.make_abdm_settings()

	def make_abdm_settings(self):
		"""ABDM Settings are read for the user's default company, which a test site does not have."""
		if not healthcare_owns_abdm_settings():
			return
		frappe.defaults.set_user_default("company", "_Test Company", "abdm_user@marleyhealth.io")
		records = [
			{
				"doctype": "ABDM Settings",
				"name": "_Test Gateway-_Test Company",
				"gateway_name": "_Test Gateway",
				"company": "_Test Company",
				"default": 1,
				"auth_base_url": "https://dev.abdm.gov.in/gateway/",
				"health_id_base_url": "https://healthidsbx.abdm.gov.in/api/",
			}
		]
		self.make_records(["name"], records)

	def make_custom_doctypes(self):
		"""A DocType is a schema change, which MariaDB commits at once, so no test may create one."""
		records = [
			{
				"doctype": "DocType",
				"name": "Test Patient Feedback",
				"module": "Healthcare",
				"custom": 1,
				"is_submittable": 1,
				"fields": [
					{"label": "Date", "fieldname": "date", "fieldtype": "Date"},
					{"label": "Patient", "fieldname": "patient", "fieldtype": "Link", "options": "Patient"},
					{"label": "Rating", "fieldname": "rating", "fieldtype": "Rating"},
					{"label": "Feedback", "fieldname": "feedback", "fieldtype": "Small Text"},
				],
				"permissions": [{"role": "System Manager", "read": 1}],
			}
		]
		self.make_records(["name"], records)

	def make_insurance_payors(self):
		records = [
			{
				"doctype": "Insurance Payor",
				"insurance_payor_name": "_Test Insurance Payor",
				"abbr": "HIC",
				"default_currency": "INR",
				"country": "India",
				"claims_receivable_accounts": [{"company": "_Test Company", "account": "Debtors - _TC"}],
				"rejected_claims_expense_accounts": [
					{"company": "_Test Company", "account": "Debtors - _TC"},
				],
			},
		]
		self.make_records(["insurance_payor_name"], records)

	def make_treatment_plan_templates(self):
		records = [
			{
				"doctype": "Treatment Plan Template",
				"template_name": "COVID19",
				"medical_department": "_Test Medical Department",
				"disabled": 0,
				"is_inpatient": 1,
				"treatment_counselling_required_for_ip": 1,
				"items": [
					{"type": "Observation Template", "template": "_Test COVID RT PCR", "qty": 1},
				],
			},
		]
		self.make_records(["template_name"], records)

	def make_medications(self):
		records = [
			{
				"doctype": "Medication",
				"generic_name": "Paracetamol",
				"medication_class": "Analgesics",
				"strength": 300,
				"strength_uom": "Milligram",
				"dosage_form": "Tablet",
				"linked_items": [
					{
						"item_code": "Paracetamol",
						"item_group": "Drug",
						"is_billable": 1,
						"rate": 25,
					},
				],
			},
		]
		self.make_records(["generic_name"], records)

	def make_dosage_forms(self):
		records = [
			{
				"dosage_form": "Tablet",
			},
			{
				"dosage_form": "Ointment",
			},
		]
		self.make_records(["dosage_form"], records)

	def make_medication_classes(self):
		records = [
			{
				"doctype": "Medication Class",
				"medication_class": "Analgesics",
			},
			{
				"doctype": "Medication Class",
				"medication_class": "Antibiotics",
			},
		]
		self.make_records(["medication_class"], records)

	def make_therapy_plan_templates(self):
		records = [
			{
				"doctype": "Therapy Plan Template",
				"plan_name": "Complete Rehab",
				"item_code": "Complete Rehab",
				"item_name": "Complete Rehab",
				"is_billable": 1,
				"rate": 5000,
				"item_group": "Services",
				"therapy_types": [
					{
						"therapy_type": "Basic Rehab",
						"no_of_sessions": 2,
						"rate": 5000,
						"amount": 2 * 5000,
					},
				],
			},
		]
		self.make_records(["plan_name"], records)

	def make_therapy_types(self):
		records = [
			{
				"doctype": "Therapy Type",
				"therapy_type": "Basic Rehab",
				"default_duration": 30,
				"is_billable": 1,
				"rate": 5000,
				"item_code": "Basic Rehab",
				"item_name": "Basic Rehab",
				"item_group": "Services",
				"exercises": [
					{
						"exercise_type": "Sit to Stand",
						"counts_target": 10,
						"assistance_level": "Passive",
					},
				],
			},
		]
		self.make_records(["therapy_type"], records)

	def make_exercise_types(self):
		records = [
			{
				"doctype": "Exercise Type",
				"exercise_name": "Sit to Stand",
				"steps_table": [
					{
						"title": "Step 1",
						"description": "Squat and Rise",
					},
				],
			}
		]
		self.make_records(["exercise_name"], records)

	def make_nursing_checklist_templates(self):
		records = [
			{
				"doctype": "Nursing Checklist Template",
				"name": "Discharge checklist",
				"title": "Discharge checklist",
				"tasks": [
					{
						"doctype": "Nursing Checklist Template Task",
						"activity": "BP Check",
						"mandatory": 1,
						"task_duration": 60,
						"parent": "Discharge checklist",
						"parentfield": "tasks",
						"parenttype": "Nursing Checklist Template",
					},
				],
			},
		]
		self.make_records(["name"], records)

	def make_care_activity(self):
		records = [
			{
				"doctype": "Healthcare Activity",
				"name": "BP Check",
				"activity": "BP Check",
				"description": "BP Check",
				"activity_duration": 60,
				"role": "Nursing User",
				"task_doctype": "Vital Signs",
			},
		]
		self.make_records(["name"], records)

	def make_observation_templates(self):
		records = [
			{
				"doctype": "Observation Template",
				"observation": "_Test Observation with Sample",
				"abbr": "OWS",
				"item_code": "_Test Observation with Sample",
				"observation_category": "Laboratory",
				"permitted_data_type": "Quantity",
				"permitted_unit": "mg / dl",
				"item_group": "Services",
				"sample_collection_required": 1,
				"is_billable": 1,
				"rate": 300,
			},
			{
				"doctype": "Observation Template",
				"observation": "_Test Observation without Sample",
				"abbr": "OWOS",
				"item_code": "_Test Observation without Sample",
				"observation_category": "Laboratory",
				"permitted_data_type": "Quantity",
				"permitted_unit": "mg / dl",
				"item_group": "Services",
				"sample_collection_required": 0,
				"is_billable": 1,
				"rate": 300,
			},
			{
				"doctype": "Observation Template",
				"observation": "_Test Observation Grouped with Sample",
				"abbr": "OG",
				"item_code": "_Test Observation Grouped with Sample",
				"has_component": 1,
				"observation_category": "Laboratory",
				"permitted_data_type": "Quantity",
				"permitted_unit": "mg / dl",
				"item_group": "Services",
				"sample_collection_required": 1,
				"is_billable": 1,
				"rate": 300,
				"observation_component": [  # FIXME: observation_components
					{
						"observation_template": "_Test Observation with Sample",
						"abbr": "OWOS",
					},
				],
			},
			{
				"doctype": "Observation Template",
				"observation": "_Test Observation Grouped without Sample",
				"abbr": "OG",
				"item_code": "_Test Observation Grouped without Sample",
				"has_component": 1,
				"observation_category": "Laboratory",
				"permitted_data_type": "Quantity",
				"permitted_unit": "mg / dl",
				"item_group": "Services",
				"sample_collection_required": 0,
				"is_billable": 1,
				"rate": 300,
				"observation_component": [  # FIXME: observation_components
					{
						"observation_template": "_Test Observation without Sample",
						"abbr": "OWOS",
					},
				],
			},
			{
				"doctype": "Observation Template",
				"observation": "_Test Observation Operand 2",
				"abbr": "OWOS2",
				"item_code": "_Test Observation Operand 2",
				"observation_category": "Laboratory",
				"permitted_data_type": "Quantity",
				"permitted_unit": "mg / dl",
				"item_group": "Services",
				"sample_collection_required": 0,
				"is_billable": 1,
				"rate": 300,
			},
			{
				"doctype": "Observation Template",
				"observation": "_Test Observation Formula Result 1",
				"abbr": "TFR1",
				"item_code": "_Test Observation Formula Result 1",
				"observation_category": "Laboratory",
				"permitted_data_type": "Quantity",
				"permitted_unit": "mg / dl",
				"item_group": "Services",
				"sample_collection_required": 0,
				"is_billable": 1,
				"rate": 300,
			},
			{
				"doctype": "Observation Template",
				"observation": "_Test Observation Formula Result 2",
				"abbr": "TFR2",
				"item_code": "_Test Observation Formula Result 2",
				"observation_category": "Laboratory",
				"permitted_data_type": "Quantity",
				"permitted_unit": "mg / dl",
				"item_group": "Services",
				"sample_collection_required": 0,
				"is_billable": 1,
				"rate": 300,
			},
			{
				"doctype": "Observation Template",
				"observation": "_Test COVID RT PCR",
				"abbr": "RTPCR",
				"item_code": "_Test COVID RT PCR",
				"observation_category": "Laboratory",
				"permitted_data_type": "Quantity",
				"permitted_unit": "mg / dl",
				"item_group": "Services",
				"sample_collection_required": 0,
				"is_billable": 1,
				"rate": 300,
			},
		]
		self.make_records(["observation"], records)

	def make_lab_test_templates(self):
		records = [
			{
				"doctype": "Lab Test Template",
				"lab_test_name": "_Test Lab Test - with Sample",
				"lab_test_template_type": "Descriptive",
				"lab_test_description": "Fasting Blood Sugar",
				"lab_test_code": "_Test Lab Test - with Sample",
				"lab_test_group": "Services",
				"department": "_Test Medical Department",
				"is_billable": 1,
				"lab_test_rate": 2000,
				"sample": "_Test Sample - Blood Sample",
				"sample_qty": "5.0",
				"descriptive_test_templates": [
					{"particulars": "FBS", "allow_blank": 1},
					{"particulars": "Insulin", "allow_blank": 0},
					{"particulars": "IR", "allow_blank": 1},
				],
			},
			{
				"doctype": "Lab Test Template",
				"lab_test_name": "_Test Lab Test - without Sample",
				"lab_test_template_type": "Descriptive",
				"lab_test_description": "Insulin Resistance",
				"lab_test_code": "_Test Lab Test - without Sample",
				"lab_test_group": "Services",
				"department": "_Test Medical Department",
				"is_billable": 1,
				"lab_test_rate": 2000,
				"descriptive_test_templates": [
					{"particulars": "FBS", "allow_blank": 1},
					{"particulars": "Insulin", "allow_blank": 0},
					{"particulars": "IR", "allow_blank": 1},
				],
			},
			{
				"doctype": "Lab Test Template",
				"lab_test_name": "_Test Lab Test - Sensitivity",
				"lab_test_template_type": "Descriptive",
				"lab_test_description": "Insulin Resistance",
				"lab_test_code": "_Test Lab Test - Sensitivity",
				"lab_test_group": "Services",
				"department": "_Test Medical Department",
				"is_billable": 1,
				"lab_test_rate": 2000,
				"sensitivity": 1,
				"descriptive_test_templates": [
					{"particulars": "FBS", "allow_blank": 1},
					{"particulars": "Insulin", "allow_blank": 0},
					{"particulars": "IR", "allow_blank": 1},
				],
			},
		]
		self.make_records(["lab_test_name", "lab_test_code"], records)

	def make_lab_test_samples(self):
		records = [
			{
				"doctype": "Lab Test Sample",
				"sample": "_Test Sample - Blood Sample",
				"sample_uom": "U/ml",
			},
			{
				"doctype": "Lab Test Sample",
				"sample": "_Test Sample - Urine",
				"sample_uom": "U/ml",
			},
		]
		self.make_records(["sample"], records)

	def make_clinical_procedure_templates(self):
		records = [
			{
				"doctype": "Clinical Procedure Template",
				"template": "_Test Procedure - Knee Surgery and Rehab",
				"item_code": "_Test Procedure - Knee Surgery and Rehab",
				"item_group": "Services",
				"description": "Knee Surgery and Rehab",
				"is_billable": 1,
				"rate": 50000,
			},
			{
				"doctype": "Clinical Procedure Template",
				"template": "_Test Procedure - Wound Inspection and Cleaning",
				"item_code": "_Test Procedure - Wound Inspection and Cleaning",
				"item_group": "Services",
				"description": "Wound Inspection and Cleaning",
				"is_billable": 1,
				"rate": 1000,
			},
		]
		self.make_records(["template", "item_code"], records)

	def make_appointment_types(self):
		records = [
			{
				"doctype": "Appointment Type",
				"appointment_type": "_Test Appointment Type",
				"allow_booking_for": "Practitioner",
				"medical_department": "_Test Medical Department",
				"default_duration": 20,
			},
			{
				"doctype": "Appointment Type",
				"appointment_type": "_Test Appointment Type for Department",
				"allow_booking_for": "Department",
				"medical_department": "_Test Medical Department",
				"default_duration": 20,
			},
			{
				"doctype": "Appointment Type",
				"appointment_type": "_Test Appointment Type with Items",
				"allow_booking_for": "Practitioner",
				"medical_department": "_Test Medical Department",
				"default_duration": 20,
				"items": [
					{
						"dt": "Medical Department",
						"dn": "_Test Medical Department",
						"op_consulting_charge_item": "HLC-SI-001",
						"op_consulting_charge": 200,
						"inpatient_visit_charge_item": "HLC-SI-002",
						"ip_consulting_charge": 200,
					},
				],
			},
			{
				"doctype": "Appointment Type",
				"appointment_type": "_Test Appointment Type with Items for Department",
				"allow_booking_for": "Department",
				"default_duration": 20,
				"items": [
					{
						"dt": "Medical Department",
						"dn": "_Test Medical Department",
						"op_consulting_charge_item": "HLC-SI-001",
						"op_consulting_charge": 1000,
						"inpatient_visit_charge_item": "HLC-SI-002",
						"ip_consulting_charge": 1000,
					},
				],
			},
			{
				"doctype": "Appointment Type",
				"appointment_type": "_Test Appointment Type with Items for Service Unit",
				"allow_booking_for": "Service Unit",
				"default_duration": 20,
				"items": [
					{
						"dt": "Healthcare Service Unit",
						"dn": "_Test HSU - Appointments - _TC",
						"op_consulting_charge_item": "HLC-SI-001",
						"op_consulting_charge": 1000,
						"inpatient_visit_charge_item": "HLC-SI-002",
						"ip_consulting_charge": 1000,
					},
				],
			},
		]
		self.make_records(["appointment_type"], records)

	def make_service_units(self):
		records = [
			{
				"doctype": "Healthcare Service Unit",
				"healthcare_service_unit_name": "_Test HSU - Appointments",
				"service_unit_type": "_Test Service Unit Type - Appointments",
				"company": "_Test Company",
				"allow_appointments": 1,
				"overlap_appointments": 0,
			},
			{
				"doctype": "Healthcare Service Unit",
				"healthcare_service_unit_name": "_Test HSU - Overlapping Appointments",
				"service_unit_type": "_Test Service Unit Type - Overlapping Appointments",
				"company": "_Test Company",
				"allow_appointments": 1,
				"overlap_appointments": 1,
				"service_unit_capacity": 10,
			},
			{
				"doctype": "Healthcare Service Unit",
				"healthcare_service_unit_name": "_Test HSU - Occupancy",
				"service_unit_type": "_Test Service Unit Type - Occupancy",
				"company": "_Test Company",
				"inpatient_occupancy": 1,
				"occupancy_status": "Vacant",
			},
			{
				"doctype": "Healthcare Service Unit",
				"healthcare_service_unit_name": "_Test HSU - OT",
				"service_unit_type": "_Test Service Unit Type - Non-billable Occupancy",
				"company": "_Test Company",
				"inpatient_occupancy": 1,
				"occupancy_status": "Vacant",
			},
		]
		self.make_records(["healthcare_service_unit_name"], records)

	def make_service_unit_types(self):
		records = [
			{
				"doctype": "Healthcare Service Unit Type",
				"service_unit_type": "_Test Service Unit Type - Appointments",
				"allow_appointments": 1,
				"overlap_appointments": 0,
			},
			{
				"doctype": "Healthcare Service Unit Type",
				"service_unit_type": "_Test Service Unit Type - Overlapping Appointments",
				"allow_appointments": 1,
				"overlap_appointments": 1,
			},
			{
				"doctype": "Healthcare Service Unit Type",
				"service_unit_type": "_Test Service Unit Type - Non-billable Occupancy",
				"inpatient_occupancy": 1,
				"is_billable": 0,
				"item_code": "_Test Service Unit Type - Occupancy",
				"item_group": "Services",
				"uom": "Day",
				"no_of_hours": 24,
				"unit_type.rate": 0,
			},
			{
				"doctype": "Healthcare Service Unit Type",
				"service_unit_type": "_Test Service Unit Type - Occupancy",
				"inpatient_occupancy": 1,
				"is_billable": 1,
				"item_code": "_Test Service Unit Type - Occupancy",
				"item_group": "Services",
				"uom": "Day",
				"no_of_hours": 24,
				"unit_type.rate": 4000,
			},
			{
				"doctype": "Healthcare Service Unit Type",
				"service_unit_type": "_Test Inpatient Rooms",
				"inpatient_occupancy": 1,
				"is_billable": 1,
				"item_code": "_Test Inpatient Rooms",
				"item_group": "Services",
				"uom": "Hour",
				"no_of_hours": 1,
				"unit_type.rate": 4000,
			},
		]
		self.make_records(["service_unit_type"], records)

	def make_users(self):
		records = [
			{
				"doctype": "User",
				"email": "test_user@marleyhealth.io",
				"first_name": "test_user",
				"password": "password",
			},
			{
				"doctype": "User",
				"email": "test_user_0@marleyhealth.io",
				"first_name": "test_user_0",
				"password": "password",
			},
			{
				"doctype": "User",
				"email": "gp@marleyhealth.io",
				"first_name": "gp",
				"password": "password",
				"roles": [{"doctype": "Has Role", "role": "Physician"}],
			},
			{
				"doctype": "User",
				"email": "abdm_user@marleyhealth.io",
				"first_name": "abdm_user",
				"password": "password",
				"roles": [{"doctype": "Has Role", "role": "Physician"}],
			},
			{
				"doctype": "User",
				"email": "nurse@marleyhealth.io",
				"first_name": "nurse",
				"password": "password",
				"roles": [{"doctype": "Has Role", "role": "Nursing User"}],
			},
			{
				"doctype": "User",
				"email": "incoming.nurse@example.com",
				"first_name": "Incoming Nurse",
				"password": "password",
				"roles": [{"doctype": "Has Role", "role": "Nursing User"}],
			},
			{
				"doctype": "User",
				"email": "lab_permissions@marleyhealth.io",
				"first_name": "Laboratory User",
				"password": "password",
				"roles": [{"doctype": "Has Role", "role": "Laboratory User"}],
			},
			{
				"doctype": "User",
				"email": "lab_approver@marleyhealth.io",
				"first_name": "approver",
				"password": "password",
				"roles": [{"doctype": "Has Role", "role": "LabTest Approver"}],
			},
			{
				"doctype": "User",
				"email": "portal_patient@marleyhealth.io",
				"first_name": "Patient",
				"password": "password",
				"roles": [{"doctype": "Has Role", "role": "Patient"}],
			},
		]
		self.make_records(["email"], records)

	def make_patients(self):
		records = [
			{
				"doctype": "Patient",
				"name": "_Test Patient",
				"first_name": "_Test Patient",
				"sex": "Female",
				"customer_group": "Individual",
			},
			{
				"doctype": "Patient",
				"name": "_Test Patient 0",
				"first_name": "_Test Patient 0",
				"sex": "Male",
				"customer_group": "Individual",
			},
			{
				"doctype": "Patient",
				"name": "_Test Patient 1",
				"first_name": "_Test Patient 1",
				"sex": "Male",
				"customer_group": "Individual",
			},
			{
				"doctype": "Patient",
				"name": "_Test IPD Patient",
				"first_name": "_Test IPD Patient",
				"sex": "Female",
				"customer_group": "Individual",
			},
			{
				"doctype": "Patient",
				"name": "_Test Patient 2",
				"first_name": "_Test Patient 2",
				"sex": "Female",
				"customer_group": "Individual",
			},
			{
				"doctype": "Patient",
				"name": "_Test Patient 3",
				"first_name": "_Test Patient 3",
				"sex": "Female",
				"customer_group": "Individual",
			},
		]
		self.make_records(["name"], records)

	def make_practitioners(self):
		records = [
			{
				"doctype": "Healthcare Practitioner",
				"name": "_Test Healthcare Practitioner 0",
				"first_name": "_Test",
				"last_name": "Healthcare Practitioner 0",
				"gender": "Female",
				"department": "_Test Medical Department",
				"op_consulting_charge_item": "HLC-SI-001",
				"op_consulting_charge": 500,
				"inpatient_visit_charge_item": "HLC-SI-002",
				"inpatient_visit_charge": 500,
			},
			{
				"doctype": "Healthcare Practitioner",
				"name": "_Test Healthcare Practitioner 1",
				"first_name": "_Test",
				"last_name": "Healthcare Practitioner 1",
				"gender": "Male",
				"department": "_Test Medical Department 0",
				"op_consulting_charge_item": "HLC-SI-001",
				"op_consulting_charge": 500,
				"inpatient_visit_charge_item": "HLC-SI-002",
				"inpatient_visit_charge": 500,
			},
			{
				"doctype": "Healthcare Practitioner",
				"name": "_Test Healthcare Practitioner 2",
				"first_name": "_Test",
				"last_name": "Healthcare Practitioner 2",
				"gender": "Male",
				"department": "Cardiology",
				"op_consulting_charge_item": "HLC-SI-001",
				"op_consulting_charge": 300,
				"inpatient_visit_charge_item": "HLC-SI-002",
				"inpatient_visit_charge": 300,
			},
		]
		self.make_records(["name"], records)

	def make_medical_departments(self):
		records = [
			{
				"doctype": "Medical Department",
				"department": "_Test Medical Department",
			},
			{
				"doctype": "Medical Department",
				"department": "_Test Medical Department 0",
			},
			{
				"doctype": "Medical Department",
				"department": "_Test Medical Department 1",
			},
			{
				"doctype": "Medical Department",
				"department": "Cardiology",
			},
		]
		self.make_records(["department"], records)

	def make_diagnoses(self):
		records = [
			{
				"doctype": "Diagnosis",
				"diagnosis": "Fever",
			},
			{
				"doctype": "Diagnosis",
				"diagnosis": "Heart Attack",
			},
		]
		self.make_records(["diagnosis"], records)

	def make_stock_items(self):
		records = [
			{
				"doctype": "Item",
				"item_code": "Dextromethorphan",
				"item_name": "Dextromethorphan",
				"item_group": "Products",
				"stock_uom": "Nos",
				"is_stock_item": 1,
				"valuation_rate": 50,
				"opening_stock": 20,
			},
			{
				"doctype": "Item",
				"item_code": "_Test_Stock_Item",
				"item_name": "_Test_Stock_Item",
				"item_group": "Services",
				"is_stock_item": 1,
				"stock_uom": "Nos",
				"valuation_rate": 50,
				"opening_stock": 20,
			},
		]
		self.make_records(["item_code"], records)

	def make_service_items(self):
		records = [
			{
				"doctype": "Item",
				"item_code": "HLC-SI-001",
				"item_name": "OP Consulting Charges",
				"item_group": "Services",
				"is_stock_item": 0,
				"stock_uom": "Nos",
			},
			{
				"doctype": "Item",
				"item_code": "HLC-SI-002",
				"item_name": "IP Consulting Charges",
				"item_group": "Services",
				"is_stock_item": 0,
				"stock_uom": "Nos",
			},
			{
				"doctype": "Item",
				"item_code": "_Test_Service_Item",
				"item_name": "_Test_Service_Item",
				"item_group": "Services",
				"is_stock_item": 0,
				"stock_uom": "Nos",
			},
			{
				"doctype": "Item",
				"item_code": "_Test Registration",
				"item_name": "_Test Registration",
				"item_group": "Services",
				"is_stock_item": 0,
				"stock_uom": "Nos",
			},
		]
		self.make_records(["item_code"], records)

	def make_company(self):
		records = [
			{
				"abbr": "_TC",
				"company_name": "_Test Company",
				"country": "India",
				"default_currency": "INR",
				"doctype": "Company",
				"chart_of_accounts": "Standard",
			},
		]
		self.make_records(["company_name"], records)

	def make_records(self, key, records):
		doctype = records[0].get("doctype")

		def get_filters(record):
			filters = {}
			for x in key:
				filters[x] = record.get(x)
			return filters

		for x in records:
			filters = get_filters(x)
			if not frappe.db.exists(doctype, filters):
				frappe.get_doc(x).insert(set_name=x.get("name"))

		frappe.db.commit()


# Master data is always older than the test clock, so rates and prices dated "today" apply.
# Only Python's clock is frozen: MariaDB NOW() / CURDATE() and Redis expiry still run on real time,
# so compute dates in Python, never in SQL.
BOOTSTRAP_TIME = "2026-01-01 09:00:00"
TEST_TIME = "2027-06-16 10:00:00"

with freeze_time(BOOTSTRAP_TIME):
	BootStrapTestData()


class HealthcareTestSuite(ERPNextTestSuite):
	"""Runs every test on a fixed weekday morning, so dates and times never depend on the real clock."""

	def run(self, result=None):
		with freeze_time(TEST_TIME, tick=True):
			return super().run(result)
