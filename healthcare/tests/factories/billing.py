import frappe
from frappe.utils import add_days, add_years, flt, getdate, nowtime, today

import erpnext

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import (
	get_income_account,
	get_receivable_account,
)
from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
	get_appointment_item,
)


def get_new_payor_contract_doc(start_date, end_date):
	payor_contract = frappe.new_doc("Insurance Payor Contract")
	payor_contract.insurance_payor = "_Test Insurance Payor"
	payor_contract.start_date = start_date
	payor_contract.company = "_Test Company"
	payor_contract.end_date = end_date
	payor_contract.is_active = 1
	return payor_contract


def invoice_item(patient, item):
	sales_invoice = frappe.new_doc("Sales Invoice")
	sales_invoice.patient = patient
	sales_invoice.customer = frappe.db.get_value("Patient", patient, "customer")
	sales_invoice.due_date = getdate()
	sales_invoice.company = "_Test Company"
	sales_invoice.debit_to = get_receivable_account("_Test Company")
	sales_invoice.append(
		"items",
		{
			"item_code": item,
			"item_name": item,
			"description": item,
			"qty": 1,
			"uom": "Nos",
			"conversion_factor": 1,
			"income_account": get_income_account(None, "_Test Company"),
			"rate": 300,
			"amount": 300,
		},
	)

	sales_invoice.set_missing_values()
	sales_invoice.submit()
	return sales_invoice


def create_item_insurance_eligibility(eligibility_for, template_dt, template_dn, eligibility_plan):
	if not frappe.db.exists(
		{
			"doctype": "Item Insurance Eligibility",
			"template_dt": template_dt,
			"template_dn": template_dn,
			"is_active": 1,
		}
	):
		eligibility = frappe.new_doc("Item Insurance Eligibility")
		eligibility.eligibility_for = eligibility_for
		eligibility.template_dt = template_dt
		eligibility.template_dn = template_dn
		eligibility.coverage = 80
		eligibility.discount = 20
		eligibility.valid_till = add_years(today(), 1)
		eligibility.insurance_plan = eligibility_plan
		eligibility.save()


def create_insured_appointment(patient, practitioner, appointment_date, appointment_type, policy=None):
	item = "HLC-SI-001"
	frappe.db.set_single_value("Healthcare Settings", "inpatient_visit_charge_item", item)
	frappe.db.set_single_value("Healthcare Settings", "op_consulting_charge_item", item)
	appointment = frappe.new_doc("Patient Appointment")
	appointment.patient = patient
	appointment.practitioner = practitioner
	appointment.appointment_type = appointment_type
	appointment.department = "_Test Medical Department"
	appointment.appointment_date = appointment_date
	appointment.appointment_time = nowtime()
	appointment.company = "_Test Company"
	appointment.duration = 30
	appointment.insurance_policy = policy
	appointment.save(ignore_permissions=True)
	appointment.reload()
	return appointment


def create_payor_insurance_eligibility_plan():
	if not frappe.db.exists(
		{
			"doctype": "Insurance Payor Eligibility Plan",
			"insurance_payor": "_Test Insurance Payor",
			"price_list": "Standard Selling",
		}
	):
		eligibility_plan = frappe.new_doc("Insurance Payor Eligibility Plan")
		eligibility_plan.insurance_plan_name = "_Test Insurance Payor Eligibility Plan"
		eligibility_plan.insurance_payor = "_Test Insurance Payor"
		eligibility_plan.price_list = "Standard Selling"
		eligibility_plan.save()
		return eligibility_plan.name
	else:
		return "_Test Insurance Payor Eligibility Plan"


def invoice_insured_appointments(appointment_doc, appointments_to_invoice):
	coverage_details = frappe.get_cached_value(
		"Patient Insurance Coverage",
		appointment_doc.insurance_coverage,
		[
			"status",
			"coverage",
			"discount",
			"price_list_rate",
			"item_code",
			"qty",
			"policy_number",
			"coverage_validity_end_date",
			"company",
			"insurance_payor",
		],
		as_dict=True,
	)

	sales_invoice = frappe.new_doc("Sales Invoice")
	sales_invoice.patient = appointment_doc.patient
	sales_invoice.customer = frappe.get_value("Patient", appointment_doc.patient, "customer")
	sales_invoice.appointment = appointment_doc.name
	sales_invoice.due_date = getdate()
	sales_invoice.company = appointment_doc.company
	sales_invoice.debit_to = get_receivable_account(appointment_doc.company)

	item = sales_invoice.append("items", {})
	item = get_appointment_item(appointment_doc, item)
	item.insurance_coverage = appointment_doc.insurance_coverage
	item.patient_insurance_policy = coverage_details.policy_number
	item.insurance_payor = coverage_details.insurance_payor
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
		payment = sales_invoice.append("payments", {})
		payment.mode_of_payment = appointment_doc.mode_of_payment
		payment.amount = appointment_doc.paid_amount

	sales_invoice.set_missing_values(for_validate=True)
	sales_invoice.flags.ignore_mandatory = True
	sales_invoice.save(ignore_permissions=True)
	sales_invoice.submit()
	return sales_invoice.name


def get_new_insurance_policy(patient, eligibility_plan=None):
	insurance_policy = frappe.new_doc("Patient Insurance Policy")
	insurance_policy.insurance_payor = "_Test Insurance Payor"
	insurance_policy.patient = patient
	insurance_policy.policy_expiry_date = add_days(today(), 5)
	insurance_policy.policy_number = "123"
	insurance_policy.insurance_plan = eligibility_plan
	return insurance_policy


def invoice_service_request(patient, service_request, template, type):
	sales_invoice = frappe.new_doc("Sales Invoice")
	sales_invoice.patient = patient
	sales_invoice.customer = frappe.db.get_value("Patient", patient, "customer")
	sales_invoice.due_date = getdate()
	sales_invoice.currency = "INR"
	sales_invoice.company = "_Test Company"
	sales_invoice.debit_to = get_receivable_account("_Test Company")
	if type == "lab_test_prescription":
		sales_invoice.append(
			"items",
			{
				"qty": 1,
				"uom": "Nos",
				"conversion_factor": 1,
				"income_account": get_income_account(None, "_Test Company"),
				"rate": template.lab_test_rate,
				"amount": template.lab_test_rate,
				"reference_dt": service_request.doctype,
				"reference_dn": service_request.name,
				"cost_center": erpnext.get_default_cost_center("_Test Company"),
				"item_code": template.item,
				"item_name": template.lab_test_name,
				"description": template.lab_test_description,
			},
		)
	elif type == "drug_prescription":
		sales_invoice.append(
			"items",
			{
				"qty": 1,
				"uom": "Nos",
				"conversion_factor": 1,
				"income_account": get_income_account(None, "_Test Company"),
				"reference_dt": service_request.doctype,
				"reference_dn": service_request.name,
				"cost_center": erpnext.get_default_cost_center("_Test Company"),
				"item_name": template.name,
				"description": template.name,
			},
		)
	elif type in ["observation", "procedure_prescription"]:
		sales_invoice.append(
			"items",
			{
				"qty": 1,
				"uom": "Nos",
				"conversion_factor": 1,
				"income_account": get_income_account(None, "_Test Company"),
				"rate": template.rate,
				"amount": template.rate,
				"reference_dt": service_request.doctype,
				"reference_dn": service_request.name,
				"cost_center": erpnext.get_default_cost_center("_Test Company"),
				"item_code": template.item,
				"item_name": template.item_code,
				"description": template.description,
			},
		)
	elif type == "therapies":
		sales_invoice.append(
			"items",
			{
				"qty": 1,
				"uom": "Nos",
				"conversion_factor": 1,
				"income_account": get_income_account(None, "_Test Company"),
				"rate": template.rate,
				"amount": template.rate,
				"reference_dt": service_request.doctype,
				"reference_dn": service_request.name,
				"cost_center": erpnext.get_default_cost_center("_Test Company"),
				"item_code": template.item_code,
				"item_name": template.item_code,
				"description": template.description,
			},
		)

	sales_invoice.set_missing_values()

	sales_invoice.submit()
	return sales_invoice
