# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
from __future__ import unicode_literals

import json
import frappe
import unittest
from frappe.utils import nowdate, flt
from healthcare.healthcare.doctype.patient_appointment.test_patient_appointment import (
	create_healthcare_docs,
	create_medical_department,
	create_healthcare_service_items,
)
from healthcare.healthcare.doctype.patient_insurance_policy.test_patient_insurance_policy import get_new_insurance_policy
from healthcare.healthcare.doctype.insurance_payor_contract.test_insurance_payor_contract import (
	create_insurance_payor,
	get_new_payor_contract_doc
)
from healthcare.healthcare.doctype.patient_appointment.patient_appointment import get_appointment_item
from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import get_receivable_account
from frappe.utils import today, add_years, getdate
from healthcare.healthcare.utils import get_appointments_to_invoice

class TestPatientInsuranceCoverage(unittest.TestCase):
	def test_insurance_coverage(self):
		frappe.db.sql("""delete from `tabAppointment Type` where name = '_Test Appointment'""")
		frappe.db.sql("""delete from `tabPatient Appointment` where appointment_type = '_Test Appointment'""")
		frappe.db.sql("""delete from `tabInsurance Payor Contract` where insurance_payor = '_Test Insurance Payor'""")
		test_docs = create_insurance_test_docs()
		invoice_dict = frappe.db.get_value('Sales Invoice', test_docs['Sales Invoice'], ['total_insurance_coverage_amount', 'patient_payable_amount'], as_dict=1)
		self.assertEqual(invoice_dict.total_insurance_coverage_amount, 320)
		self.assertEqual(invoice_dict.patient_payable_amount, 80)

def create_insurance_test_docs():
	patient, practitioner = create_healthcare_docs()

	# Create Insurance Payor, Contract, Item Insurance Eligibility, Eligibility Plan, Patient Insurance Policy
	create_insurance_payor()
	eligibility_plan = create_payor_insurance_eligibility_plan()
	contract = get_new_payor_contract_doc(today(), add_years(today(), 1))
	contract.submit()
	insurance_policy = get_new_insurance_policy(patient, eligibility_plan)
	insurance_policy.submit()
	medical_department = create_medical_department()
	appointment_type = create_appointment_type(medical_department)
	create_item_insurance_eligibility('Service', 'Appointment Type', appointment_type, eligibility_plan)

	# Book Appointment and Invoice
	# invoice total 400 (after 20% discount) coverage 80%
	appointment = create_appointment(patient, practitioner, nowdate(), appointment_type, insurance_policy.name)
	appointments_to_invoice = get_appointments_to_invoice(frappe.get_doc('Patient', patient), '_Test Company')
	sales_invoice = create_sales_invoice(appointment, appointments_to_invoice)
	test_docs = {'Patient' : patient, 'Practitioner' : practitioner, 'Eligibility Plan': eligibility_plan,\
		'Contract' : contract.name, 'Insurance Policy' : insurance_policy.name, 'Medical Department' : medical_department, 'Patient Appointment' : appointment.name,\
		'appointments_to_invoice' : appointments_to_invoice, 'Sales Invoice' : sales_invoice}
	return test_docs

def create_item_insurance_eligibility(eligibility_for, template_dt, template_dn, eligibility_plan):
	if not frappe.db.exists({ 'doctype': 'Item Insurance Eligibility', 'template_dt': template_dt, 'template_dn': template_dn, 'is_active':1}):
		eligibility = frappe.new_doc('Item Insurance Eligibility')
		eligibility.eligibility_for = eligibility_for
		eligibility.template_dt = template_dt
		eligibility.template_dn = template_dn
		eligibility.coverage = 80
		eligibility.discount = 20
		eligibility.valid_till = add_years(today(), 1)
		eligibility.insurance_plan = eligibility_plan
		eligibility.save()

def create_appointment(patient, practitioner, appointment_date, appointment_type, policy=None):
	item = create_healthcare_service_items()
	frappe.db.set_value('Healthcare Settings', None, 'inpatient_visit_charge_item', item)
	frappe.db.set_value('Healthcare Settings', None, 'op_consulting_charge_item', item)
	appointment = frappe.new_doc('Patient Appointment')
	appointment.patient = patient
	appointment.practitioner = practitioner
	appointment.appointment_type = appointment_type
	appointment.department = '_Test Medical Department'
	appointment.appointment_date = appointment_date
	appointment.company = '_Test Company'
	appointment.duration = 30
	appointment.insurance_policy = policy
	appointment.save(ignore_permissions=True)
	return appointment

def create_payor_insurance_eligibility_plan():
	if not frappe.db.exists({ 'doctype': 'Insurance Payor Eligibility Plan', 'insurance_payor': '_Test Insurance Payor', 'price_list': 'Standard Selling'}):
		eligibility_plan = frappe.new_doc('Insurance Payor Eligibility Plan')
		eligibility_plan.insurance_plan_name = '_Test Insurance Payor Eligibility Plan'
		eligibility_plan.insurance_payor = '_Test Insurance Payor'
		eligibility_plan.price_list = 'Standard Selling'
		eligibility_plan.save()
		return eligibility_plan.name
	else:
		return '_Test Insurance Payor Eligibility Plan'

def create_sales_invoice(appointment_doc, appointments_to_invoice):
	coverage_details = frappe.get_cached_value('Patient Insurance Coverage', appointment_doc.insurance_coverage,
					['status', 'coverage', 'discount', 'price_list_rate', 'item_code', 'qty', 'policy_number', 'coverage_validity_end_date', 'company', 'insurance_payor'],
					as_dict=True)
	sales_invoice = frappe.new_doc('Sales Invoice')
	sales_invoice.patient = appointment_doc.patient
	sales_invoice.customer = frappe.get_value('Patient', appointment_doc.patient, 'customer')
	sales_invoice.appointment = appointment_doc.name
	sales_invoice.due_date = getdate()
	sales_invoice.company = appointment_doc.company
	sales_invoice.debit_to = get_receivable_account(appointment_doc.company)

	item = sales_invoice.append('items', {})
	item = get_appointment_item(appointment_doc, item)
	item.insurance_coverage = appointment_doc.insurance_coverage
	item.patient_insurance_policy =  coverage_details.policy_number
	item.insurance_payor =  coverage_details.insurance_payor
	item.service = coverage_details.item_code
	item.rate = coverage_details.price_list_rate
	item.coverage_percentage = coverage_details.coverage
	item.discount_percentage = coverage_details.discount
	item.coverage_rate = coverage_details.price_list_rate
	item.coverage_qty = coverage_details.qty

	if item.discount_percentage:
		item.discount_amount = flt(item.rate) * flt(item.discount_percentage) * 0.01
		item.rate = flt(item.rate) - flt(item.discount_amount)

	item.amount = flt(item.rate) * flt(item.qty)

	if item.insurance_coverage:
		item.insurance_coverage_amount = flt(item.amount) * 0.01 * flt(item.coverage_percentage)


	# Add payments if payment details are supplied else proceed to create invoice as Unpaid
	if appointment_doc.mode_of_payment and appointment_doc.paid_amount:
		sales_invoice.is_pos = 1
		payment = sales_invoice.append('payments', {})
		payment.mode_of_payment = appointment_doc.mode_of_payment
		payment.amount = appointment_doc.paid_amount

	sales_invoice.set_missing_values(for_validate=True)
	sales_invoice.flags.ignore_mandatory = True
	sales_invoice.save(ignore_permissions=True)
	sales_invoice.submit()
	return sales_invoice.name

def create_appointment_type(medical_department):
	item = create_healthcare_service_items()
	items = [{
		'medical_department': medical_department,
		'op_consulting_charge_item': item,
		'op_consulting_charge': 500
	}]
	appoint_type_doc = frappe.get_doc({
		'doctype': 'Appointment Type',
		'appointment_type': '_Test Appointment',
		'default_duration': 30,
		'color':  '#7575ff',
		'price_list': frappe.db.get_value("Price List", {"selling": 1}),
		'items': items
	}).insert()
	return appoint_type_doc.name