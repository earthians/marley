# Copyright (c) 2015, ESS LLP and Contributors
# See license.txt


import frappe
from frappe.utils import getdate, nowtime

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import (
	get_income_account,
	get_receivable_account,
)
from healthcare.healthcare.doctype.lab_test.lab_test import create_multiple
from healthcare.tests.utils import HealthcareTestSuite


class TestLabTest(HealthcareTestSuite):
	def test_lab_test_item(self):
		lab_template = frappe.get_doc("Lab Test Template", "_Test Lab Test - with Sample")
		self.assertTrue(frappe.db.exists("Item", lab_template.item))
		self.assertEqual(
			frappe.db.get_value("Item Price", {"item_code": lab_template.item}, "price_list_rate"),
			lab_template.lab_test_rate,
		)

		lab_template.disabled = 1
		lab_template.save()
		self.assertEqual(frappe.db.get_value("Item", lab_template.item, "disabled"), 1)

		lab_template.reload()

		lab_template.disabled = 0
		lab_template.save()

	def test_reqd_result_lab_test_raises(self):
		lab_template = frappe.get_doc("Lab Test Template", "_Test Lab Test - without Sample")

		# blank result value not allowed as per template
		lab_test = create_lab_test(lab_template)
		lab_test.descriptive_test_items[0].result_value = 12
		lab_test.descriptive_test_items[2].result_value = 1
		lab_test.save()
		self.assertRaises(frappe.ValidationError, lab_test.submit)

	def test_sample_collection(self):
		frappe.db.set_single_value("Healthcare Settings", "create_sample_collection_for_lab_test", 1)
		lab_template = frappe.get_doc("Lab Test Template", "_Test Lab Test - with Sample")

		lab_test = create_lab_test(lab_template)
		lab_test.descriptive_test_items[0].result_value = 12
		lab_test.descriptive_test_items[1].result_value = 1
		lab_test.descriptive_test_items[2].result_value = 2.3
		lab_test.save()

		# check sample collection created
		self.assertTrue(frappe.db.exists("Sample Collection", {"sample": lab_template.sample}))

		frappe.db.set_single_value("Healthcare Settings", "create_sample_collection_for_lab_test", 0)
		lab_test = create_lab_test(lab_template)
		lab_test.descriptive_test_items[0].result_value = 12
		lab_test.descriptive_test_items[1].result_value = 1
		lab_test.descriptive_test_items[2].result_value = 2.3
		lab_test.save()

		# sample collection should not be created
		lab_test.reload()
		self.assertEqual(lab_test.sample, None)

	def test_create_lab_tests_from_sales_invoice(self):
		sales_invoice = create_sales_invoice()
		create_multiple("Sales Invoice", sales_invoice.name)
		sales_invoice.reload()
		self.assertIsNotNone(sales_invoice.items[0].reference_dn)
		self.assertIsNotNone(sales_invoice.items[1].reference_dn)

	def test_create_lab_tests_from_patient_encounter(self):
		patient_encounter = create_patient_encounter()
		create_multiple("Patient Encounter", patient_encounter.name)
		patient_encounter.reload()
		service_requests = frappe.db.get_list(
			"Service Request",
			filters={
				"order_group": patient_encounter.name,
				"status": ["!=", "Completed"],
				"template_dt": "Lab Test Template",
			},
			fields=["name"],
		)
		if service_requests:
			for service_request in service_requests:
				self.assertTrue(
					frappe.db.exists("Lab Test", {"service_request": service_request.get("name")})
				)


def create_lab_test_template(test_sensitivity=0, sample_collection=1):
	medical_department = "_Test Medical Department"
	if frappe.db.exists("Lab Test Template", "Insulin Resistance"):
		return frappe.get_doc("Lab Test Template", "Insulin Resistance")
	template = frappe.new_doc("Lab Test Template")
	template.lab_test_name = "Insulin Resistance"
	template.lab_test_template_type = "Descriptive"
	template.lab_test_code = "Insulin Resistance"
	template.lab_test_group = "Services"
	template.department = medical_department
	template.is_billable = 1
	template.lab_test_description = "Insulin Resistance"
	template.lab_test_rate = 2000

	for entry in ["FBS", "Insulin", "IR"]:
		template.append(
			"descriptive_test_templates", {"particulars": entry, "allow_blank": 1 if entry == "IR" else 0}
		)

	if test_sensitivity:
		template.sensitivity = 1

	if sample_collection:
		template.sample = create_lab_test_sample()
		template.sample_qty = 5.0

	template.save()
	return template


def create_lab_test(lab_template):
	patient = "_Test Patient"
	lab_test = frappe.new_doc("Lab Test")
	lab_test.template = lab_template.name
	lab_test.patient = patient
	lab_test.patient_sex = "Female"
	lab_test.company = "_Test Company"
	lab_test.save()

	return lab_test


def create_lab_test_sample():
	blood_sample = frappe.db.exists("Lab Test Sample", "Blood Sample")
	if blood_sample:
		return blood_sample

	sample = frappe.new_doc("Lab Test Sample")
	sample.sample = "Blood Sample"
	sample.sample_uom = "U/ml"
	sample.save()

	return sample.name


def create_sales_invoice():
	patient = "_Test Patient"
	insulin_resistance_template = frappe.get_doc("Lab Test Template", "_Test Lab Test - Sensitivity")
	blood_test_template = frappe.get_doc("Lab Test Template", "_Test Lab Test - with Sample")

	sales_invoice = frappe.new_doc("Sales Invoice")
	sales_invoice.patient = patient
	sales_invoice.customer = frappe.db.get_value("Patient", patient, "customer")
	sales_invoice.due_date = getdate()
	sales_invoice.company = "_Test Company"
	sales_invoice.debit_to = get_receivable_account("_Test Company")

	tests = [insulin_resistance_template, blood_test_template]
	for entry in tests:
		sales_invoice.append(
			"items",
			{
				"item_code": entry.item,
				"item_name": entry.lab_test_name,
				"description": entry.lab_test_description,
				"qty": 1,
				"uom": "Nos",
				"conversion_factor": 1,
				"income_account": get_income_account(None, "_Test Company"),
				"rate": entry.lab_test_rate,
				"amount": entry.lab_test_rate,
			},
		)

	sales_invoice.set_missing_values()

	sales_invoice.submit()
	return sales_invoice


def create_patient_encounter():
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
