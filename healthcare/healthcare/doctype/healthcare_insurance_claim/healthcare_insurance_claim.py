# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, get_link_to_form, getdate, nowdate

from erpnext.accounts.party import get_party_account
from erpnext.healthcare.doctype.healthcare_insurance_company.healthcare_insurance_company import (
	get_insurance_party_details,
)
from erpnext.healthcare.doctype.healthcare_service_insurance_coverage.healthcare_service_insurance_coverage import (
	get_service_insurance_coverage_details,
)


class HealthcareInsuranceClaim(Document):
	def after_insert(self):
		if self.create_coverage:
			create_coverage_for_service_or_item(self)

	def on_update_after_submit(self):
		self.update_approval_status_in_service()

		if self.status == "Invoiced" and not self.ref_journal_entry:
			self.create_journal_entry()

	def before_cancel(self):
		if self.approval_status == "Approved":
			frappe.throw(_("Cannot cancel Approved Insurance Claim"))

	def on_cancel(self):
		if self.status != "Invoiced":
			self.update_approval_status_in_service(cancel=True)

	def update_approval_status_in_service(self, cancel=False):
		service_docname = frappe.db.exists(self.service_doctype, {"insurance_claim": self.name})

		if service_docname:
			# unlink claim from service
			if cancel:
				frappe.db.set_value(
					self.service_doctype, service_docname, {"insurance_claim": "", "approval_status": ""}
				)
				frappe.msgprint(
					_("Insurance Claim unlinked from the {0} {1}").format(self.service_doctype, service_docname)
				)
			else:
				frappe.db.set_value(
					self.service_doctype, service_docname, "approval_status", self.approval_status
				)

	def create_journal_entry(self):
		if not self.sales_invoice:
			frappe.throw(_("Insurance Claim Status cannot be Invoiced without Sales Invoice reference"))

		sales_invoice = frappe.db.get_value(
			"Sales Invoice", self.sales_invoice, ["customer", "debit_to", "company"], as_dict=True
		)

		# Linked Party and Receivable Account for Insurance Company
		insurance_company_details = get_insurance_party_details(self.insurance_company, self.company)

		journal_entry = frappe.new_doc("Journal Entry")
		journal_entry.company = sales_invoice.company
		journal_entry.posting_date = self.billing_date

		journal_entry.append(
			"accounts",
			{
				"account": sales_invoice.debit_to,
				"credit_in_account_currency": self.coverage_amount,
				"party_type": "Customer",
				"party": sales_invoice.customer,
				"reference_type": "Sales Invoice",
				"reference_name": self.sales_invoice,
			},
		)

		journal_entry.append(
			"accounts",
			{
				"account": insurance_company_details.receivable_account,
				"debit_in_account_currency": self.coverage_amount,
				"party_type": "Customer",
				"party": insurance_company_details.party,
			},
		)

		journal_entry.flags.ignore_permissions = True
		journal_entry.flags.ignore_mandatory = True
		journal_entry.submit()

		self.db_set("ref_journal_entry", journal_entry.name)


def update_claim_status_to_service(doc):
	service_name = frappe.db.exists(
		doc.service_doctype, {"insurance_claim": doc.name, "claim_status": "Pending"}
	)
	if service_name:
		frappe.db.set_value(doc.service_doctype, service_name, "claim_status", doc.claim_status)


def create_journal_entry_insurance_claim(self):
	# create jv
	sales_invoice = frappe.get_doc("Sales Invoice", self.sales_invoice)
	insurance_company = frappe.get_doc("Healthcare Insurance Company", self.insurance_company)

	journal_entry = frappe.new_doc("Journal Entry")
	journal_entry.company = sales_invoice.company
	journal_entry.posting_date = self.billing_date
	accounts = []
	tax_amount = 0.0
	accounts.append(
		{
			"account": get_party_account("Customer", sales_invoice.customer, sales_invoice.company),
			"credit_in_account_currency": self.coverage_amount,
			"party_type": "Customer",
			"party": sales_invoice.customer,
			"reference_type": sales_invoice.doctype,
			"reference_name": sales_invoice.name,
		}
	)
	accounts.append(
		{
			"account": insurance_company.insurance_company_receivable_account,
			"debit_in_account_currency": self.coverage_amount,
			"party_type": "Customer",
			"party": insurance_company.customer,
		}
	)
	journal_entry.set("accounts", accounts)
	journal_entry.save(ignore_permissions=True)
	journal_entry.submit()
	frappe.db.set_value(
		"Healthcare Insurance Claim", self.name, "service_billed_jv", journal_entry.name
	)
	self.reload()


def create_coverage_for_service_or_item(self):
	healthcare_insurance_coverage_plan = frappe.db.get_value(
		"Healthcare Insurance Subscription",
		self.insurance_subscription,
		"healthcare_insurance_coverage_plan",
	)
	if healthcare_insurance_coverage_plan:
		coverage_based_on = ""
		if self.healthcare_service_type and self.service_template:
			coverage_based_on = "Service"
		elif self.medical_code:
			coverage_based_on = "Medical Code"
		elif self.service_item:
			coverage_based_on = "Item"
		coverage_service = frappe.new_doc("Healthcare Service Insurance Coverage")
		coverage_service.coverage_based_on = coverage_based_on
		coverage_service.healthcare_insurance_coverage_plan = healthcare_insurance_coverage_plan
		coverage_service.healthcare_service = (
			self.healthcare_service_type
			if self.healthcare_service_type and coverage_based_on == "Service"
			else ""
		)
		coverage_service.healthcare_service_template = (
			self.service_template if self.service_template and coverage_based_on == "Service" else ""
		)
		coverage_service.medical_code = (
			self.medical_code if self.medical_code and coverage_based_on == "Medical Code" else ""
		)
		coverage_service.item = (
			self.service_item if self.service_item and coverage_based_on == "Item" else ""
		)
		coverage_service.coverage = self.coverage if self.coverage else 0
		coverage_service.discount = self.discount if self.discount else 0
		coverage_service.start_date = self.claim_posting_date if self.claim_posting_date else nowdate()
		coverage_service.end_date = (
			self.approval_validity_end_date if self.approval_validity_end_date else nowdate()
		)
		coverage_service.save(ignore_permissions=True)


def make_insurance_claim(doc, service_doctype, service, qty, billing_item=None):
	insurance_details = get_insurance_details(doc, service_doctype, service, billing_item)

	if not insurance_details:
		return

	claim = frappe.new_doc("Healthcare Insurance Claim")
	claim.patient = doc.patient
	claim.reference_dt = doc.doctype
	claim.reference_dn = doc.name
	claim.insurance_subscription = doc.insurance_subscription
	claim.insurance_company = doc.insurance_company
	claim.healthcare_service_type = service_doctype
	claim.service_template = service
	claim.approval_status = (
		"Approved" if insurance_details.claim_approval_mode == "Automatic" else "Pending"
	)
	claim.claim_approval_mode = insurance_details.claim_approval_mode
	claim.claim_posting_date = getdate()
	claim.quantity = qty
	claim.service_doctype = doc.doctype
	claim.service_item = billing_item
	claim.discount = insurance_details.discount
	claim.price_list_rate = insurance_details.price_list_rate
	claim.amount = flt(insurance_details.price_list_rate) * flt(qty)

	if claim.discount:
		claim.discount_amount = flt(claim.price_list_rate) * flt(claim.discount) * 0.01
		claim.amount = flt(claim.price_list_rate - claim.discount_amount) * flt(qty)

	claim.coverage = insurance_details.coverage
	claim.coverage_amount = flt(claim.amount) * 0.01 * flt(claim.coverage)
	claim.flags.ignore_permissions = True
	claim.flags.ignore_mandatory = True
	claim.submit()

	update_claim_status_in_doc(doc, claim)


def get_insurance_details(doc, service_doctype, service, billing_item=None):
	if not billing_item:
		billing_item = frappe.get_cached_value(service_doctype, service, "item")

	insurance_details = get_service_insurance_coverage_details(
		service_doctype, service, billing_item, doc.insurance_subscription
	)

	if not insurance_details:
		frappe.msgprint(
			_("Insurance Coverage not found for {0}: {1}").format(service_doctype, frappe.bold(service))
		)
		return

	insurance_subscription = frappe.db.get_value(
		"Healthcare Insurance Subscription",
		doc.insurance_subscription,
		["insurance_company", "healthcare_insurance_coverage_plan"],
		as_dict=True,
	)
	price_list_rate = get_insurance_price_list_rate(insurance_subscription, billing_item)

	insurance_details.update({"price_list_rate": price_list_rate})

	return insurance_details


def get_insurance_price_list_rate(insurance_subscription, billing_item):
	rate = 0.0

	if insurance_subscription.healthcare_insurance_coverage_plan:
		price_list = frappe.db.get_value(
			"Healthcare Insurance Coverage Plan",
			insurance_subscription.healthcare_insurance_coverage_plan,
			"price_list",
		)
		if not price_list:
			price_list = frappe.db.get_value(
				"Healthcare Insurance Contract",
				{"insurance_company": insurance_subscription.insurance_company},
				"default_price_list",
			)
			if not price_list:
				price_list = frappe.db.get_single_value("Selling Settings", "selling_price_list")

		if price_list:
			item_price = frappe.db.exists(
				"Item Price", {"item_code": billing_item, "price_list": price_list}
			)
			if item_price:
				rate = frappe.db.get_value("Item Price", item_price, "price_list_rate")

	return rate


def update_claim_status_in_doc(doc, claim):
	if claim:
		doc.reload()
		doc.db_set("insurance_claim", claim.name)
		doc.db_set("approval_status", claim.approval_status)

		frappe.msgprint(
			_("Healthcare Insurance Claim {0} created successfully").format(
				get_link_to_form("Healthcare Insurance Claim", claim.name)
			),
			title=_("Success"),
			indicator="green",
		)


def update_insurance_claim(insurance_claim, sales_invoice_name, posting_date, total_amount):
	frappe.db.set_value(
		"Healthcare Insurance Claim",
		insurance_claim,
		{
			"sales_invoice": sales_invoice_name,
			"sales_invoice_posting_date": posting_date,
			"billing_date": getdate(),
			"billing_amount": total_amount,
			"status": "Invoiced",
		},
	)
