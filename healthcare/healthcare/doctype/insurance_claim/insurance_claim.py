# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe import _
from frappe.utils import getdate, get_link_to_form
from frappe.model.document import Document
from erpnext.accounts.doctype.sales_invoice.sales_invoice import get_bank_cash_account
class InsuranceClaim(Document):
	def validate(self):
		self.validate_existing_insurance_claims()
		self.validate_and_set_totals(status='Draft')
		self.set_bank_cash_account()

	def before_submit(self):
		self.validate_existing_insurance_claims()
		self.validate_and_set_totals(status='Submitted')

	def before_cancel(self):
		if self.status == 'Completed':
			frappe.throw(_('Cannot Cancel, Insurance Claim already completed'), title=_('Not Allowed'))

		for coverage in self.coverages:
			coverage.approved_amount = coverage.rejected_amount = 0
			coverage.payment_error_reason = 'Document Cancelled'
			coverage.status = 'Cancelled'

			self.update_linked_insurance_coverage(coverage)

		self.insurance_claim_amount = self.outstanding_amount = self.paid_amount = self.approved_amount = self.rejected_amount = 0

	def before_update_after_submit(self):
		# NOTE: no partial payment for now
		approved_amount = rejected_amount = 0

		for coverage in self.coverages:
			if coverage.status == 'Payment Approved' or coverage.approved_amount == coverage.coverage_amount:
				# Approved
				coverage.approved_amount = coverage.coverage_amount
				coverage.rejected_amount = 0
				coverage.status = 'Payment Approved'
				coverage.payment_error_reason = ''

			elif coverage.status in ['Payment Rejected', 'Claim Error'] or coverage.approved_amount < coverage.coverage_amount:
				# Not Approved
				coverage.approved_amount = 0
				coverage.rejected_amount = coverage.coverage_amount
				if coverage.status != 'Payment Rejected':
					coverage.status = 'Claim Error'

				if not coverage.payment_error_reason:
					if self.status == 'Submitted':
						frappe.throw(_('<b>Reason for Claim Error</b> is required, please update row #{}').format(coverage.idx), title=_('Reason '))
					else:
						frappe.msgprint(_('<b>Reason for Claim Error</b> is required, please update row #{}').format(
							coverage.idx), title=_('Reason '), alert=True, indicator='error')
			else:
					frappe.throw(_('Approved Amount connot be more than Claim Amount, please update row #{}').format(coverage.idx), title=_('Validation Error'))

			approved_amount+= coverage.approved_amount
			rejected_amount+= coverage.rejected_amount

			self.update_linked_insurance_coverage(coverage)

		self.approved_amount = approved_amount
		self.rejected_amount = rejected_amount
		self.outstanding_amount = self.approved_amount - self.paid_amount

	def validate_and_set_totals(self, status):

		total_coverage_amount = 0
		for coverage in self.coverages:
			if coverage.coverage_amount <= 0:
				frappe.throw(_('Invalid Claim Amount, row #{}').format(coverage.idx))

			coverage.status = status
			coverage.approved_amount = 0
			coverage.rejected_amount = 0
			coverage.payment_error_reason = ''
			total_coverage_amount += coverage.coverage_amount

			if status != 'Draft':
				self.update_linked_insurance_coverage(coverage)

		self.insurance_claim_amount = total_coverage_amount
		self.outstanding_amount = self.paid_amount = self.approved_amount = self.rejected_amount = 0

		self.status = status

	def validate_existing_insurance_claims(self):
		'''
		checks if insurance coverage is already part of payment requests in status Submitted / Payment Approved / Completed
		'''
		coverages = [coverage.insurance_coverage for coverage in self.coverages]

		claim_coverages = frappe.db.get_all('Insurance Claim Coverage', {
			'parent': ['!=', self.name],
			'status': ['in', ['Submitted', 'Payment Approved', 'Completed']],
			'insurance_coverage': ['in', coverages]
		}, ['insurance_coverage', 'status', 'parent'])

		if claim_coverages:
			frappe.throw(_('Insurance Claim already submitted for Insurance Coverages<br>{}').format(
				'<br> '.join([f'{coverage.insurance_coverage} ({coverage.status}),\
					Insurance Claim: {get_link_to_form(self.doctype, coverage.parent)}' for coverage in claim_coverages])
				), title=_('Insurance Claim Exists'))

	def update_linked_insurance_coverage(self, coverage):

		coverage_status_map = {
            'Submitted': 'Claim Processing',
            'Cancelled': 'Claim Error'
        }

		frappe.db.set_value('Patient Insurance Coverage', coverage.insurance_coverage, {
			'status': coverage_status_map.get(coverage.status, coverage.status),
			'payment_approved_amount': coverage.approved_amount,
			'paid_amount': coverage.approved_amount if coverage.status == 'Completed' else 0,
			'insurance_claim_comments': f'Insurance Claim {self.name}<br>{coverage.payment_error_reason}'
		})

	def set_bank_cash_account(self):
		if self.mode_of_payment:
			self.paid_to = get_bank_cash_account(self.mode_of_payment, self.company).get("account")
		else:
			self.paid_to = ''

	@frappe.whitelist()
	def get_coverages(self):
		if not self.insurance_payor or not self.company:
			frappe.throw(_('Company and Insurance Provider are mandatory'), title=_('Missing Mandatory Fields'))

		coverages = frappe.db.sql('''
			SELECT cl.name as insurance_coverage, cl.posting_date as insurance_coverage_posting_date,
				cl.patient as patient, cl.patient_name, cl.template_dt, cl.template_dn,
				cl.coverage, cl.discount, cl.coverage_amount, cl.discount_amount,
				cl.medical_code_standard, cl.medical_code, cl.medical_code_description,
				cl.mode_of_approval, cl.insurance_plan, cl.gender, cl.birth_date,
				cl.policy_number, cl.policy_expiry_date,
				si.name as sales_invoice, si.posting_date as sales_invoice_posting_date,
				sii.amount as sales_invoice_item_amount,
				jea.credit_in_account_currency as allocated_amount, jea.parent as journal_entry,
				'Draft' as status
			FROM `tabPatient Insurance Coverage` cl
			JOIN `tabSales Invoice Item` sii ON (cl.name=sii.insurance_coverage AND sii.docstatus=1)
			JOIN `tabSales Invoice` si ON (si.name=sii.parent AND si.docstatus=1)
			JOIN `tabJournal Entry Account` jea ON (jea.reference_name=si.name AND jea.docstatus=1 AND cl.coverage_amount=jea.credit_in_account_currency)
			WHERE
				cl.docstatus=1 AND
				cl.patient=%(patient)s AND
				cl.insurance_policy=%(insurance_policy)s AND
				cl.company=%(company)s AND
				cl.insurance_payor=%(insurance_payor)s AND
				({col} BETWEEN %(from_date)s AND %(to_date)s) AND
				cl.status in %(statuses)s
			ORDER BY patient ASC, {col} DESC
		'''.format(col='si.posting_date' if self.posting_date_based_on == 'Sales Invoice' else 'cl.posting_date'),
			{
				'patient': self.patient,
				'insurance_policy': self.insurance_policy,
				'company': self.company,
				'insurance_payor': self.insurance_payor,
				'from_date': self.from_date,
				'to_date': self.to_date,
				'statuses': tuple(['Invoiced', 'Claim Error'])
		}, as_dict=1)

		for coverage in coverages:
			self.append('coverages', coverage)

@frappe.whitelist()
def create_payment_entry(doc):
	import json
	from six import string_types

	if isinstance(doc, string_types):
		doc = json.loads(doc)
		doc = frappe._dict(doc)

	payment_entry = frappe.new_doc('Payment Entry')
	payment_entry.voucher_type = 'Payment Entry'
	payment_entry.company = doc.company
	payment_entry.posting_date = getdate()
	payment_entry.mode_of_payment = doc.mode_of_payment
	payment_entry.paid_to = doc.paid_to
	payment_entry.payment_type = "Receive"
	payment_entry.party_type = "Customer"
	payment_entry.party = doc.customer
	payment_entry.paid_amount= doc.outstanding_amount
	payment_entry.custom_remarks = True
	payment_entry.remarks = _('Payment Entry against Insurance Coverages {} via Insurance Claim {}').format(
		', '.join([coverage.get('insurance_coverage') for coverage in doc.coverages]), doc.name)

	# coverage_names = []
	# for coverage in doc.coverages:
	# 	# add reference
	# 	if coverage.get('status') == 'Payment Approved' and coverage.get('journal_entry'):
	# 		payment_entry.append('references', {
	# 			'reference_doctype': 'Journal Entry',
	# 			'reference_name': coverage.get('journal_entry'),
	# 			'total_amount': coverage.get('allocated_amount'),
	# 			'outstanding_amount': coverage.get('allocated_amount'),
	# 			'allocated_amount': coverage.get('allocated_amount')
	# 		})
	# 	# build remarks
	# 	coverage_names.append(coverage.get('insurance_coverage'))

	# payment_entry.remarks = _('Payment Entry against Insurance Coverages {} via Insurance Claim {}').format(
	# 	', '.join(coverage_names), doc.name)

	payment_entry.setup_party_account_field()
	payment_entry.set_missing_values()

	return payment_entry.as_dict()

