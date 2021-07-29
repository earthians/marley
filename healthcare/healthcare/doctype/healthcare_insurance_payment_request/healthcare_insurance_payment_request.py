# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe import _
from frappe.utils import getdate, get_link_to_form
from frappe.model.document import Document
from erpnext.accounts.doctype.sales_invoice.sales_invoice import get_bank_cash_account
class HealthcareInsurancePaymentRequest(Document):
	def validate(self):
		self.validate_existing_payment_requests()
		self.validate_and_set_totals(status='Draft')
		self.set_bank_cash_account()

	def before_submit(self):
		self.validate_existing_payment_requests()
		self.validate_and_set_totals(status='Submitted')

	def before_cancel(self):
		if self.status == 'Completed':
			frappe.throw(_('cannot Cancel, Payment request already completed'), title=_('Not Allowed'))

		for claim in self.claims:
			claim.approved_amount = claim.rejected_amount = 0
			claim.payment_error_reason = 'Document Cancelled'
			claim.status = 'Cancelled'

			self.update_linked_insurance_claim(claim)

		self.payment_request_amount = self.outstanding_amount = self.paid_amount = self.approved_amount = self.rejected_amount = 0

	def before_update_after_submit(self):
		# NOTE: no partial payment for now
		approved_amount = rejected_amount = 0

		for claim in self.claims:
			if claim.status == 'Payment Approved' or claim.approved_amount == claim.claim_amount:
				# Approved
				claim.approved_amount = claim.claim_amount
				claim.rejected_amount = 0
				claim.status = 'Payment Approved'
				claim.payment_error_reason = ''

			elif claim.status in ['Payment Rejected', 'Payment Error'] or claim.approved_amount < claim.claim_amount:
				# Not Approved
				claim.approved_amount = 0
				claim.rejected_amount = claim.claim_amount
				if claim.status != 'Payment Rejected':
					claim.status = 'Payment Error'

				if not claim.payment_error_reason:
					if self.status == 'Verified':
						frappe.throw(_('<b>Reason for Payment Error</b> is required, please update row #{}').format(claim.idx), title=_('Reason '))
					else:
						frappe.msgprint(_('<b>Reason for Payment Error</b> is required, please update row #{}').format(
							claim.idx), title=_('Reason '), alert=True, indicator='error')
			else:
					frappe.throw(_('Approved Amount connot be more than Claim Amount, please update row #{}').format(claim.idx), title=_('Validation Error'))

			# acc
			approved_amount+= claim.approved_amount
			rejected_amount+= claim.rejected_amount

			self.update_linked_insurance_claim(claim)

		self.approved_amount = approved_amount
		self.rejected_amount = rejected_amount
		self.outstanding_amount = self.approved_amount - self.paid_amount

	def validate_and_set_totals(self, status):

		total_claim_amount = 0
		for claim in self.claims:
			if claim.claim_amount <= 0:
				frappe.throw(_('Invalid Claim Amount, row #{}').format(claim.idx))

			claim.status = status
			claim.approved_amount = 0
			claim.rejected_amount = 0
			claim.payment_error_reason = ''
			total_claim_amount += claim.claim_amount

			if status != 'Draft':
				self.update_linked_insurance_claim(claim)

		self.payment_request_amount = total_claim_amount
		self.outstanding_amount = self.paid_amount = self.approved_amount = self.rejected_amount = 0

		self.status = status

	def validate_existing_payment_requests(self):
		'''
		checks if insurance claim is already part of payment requests in status Submitted / Payment Approved / Completed
		'''
		claims = [claim.insurance_claim for claim in self.claims]

		payment_request_items = frappe.db.get_all('Healthcare Insurance Payment Request Item', {
			'parent': ['!=', self.name],
			'status': ['in', ['Submitted', 'Payment Approved', 'Completed']],
			'insurance_claim': ['in', claims]
		}, ['insurance_claim', 'status', 'parent'])

		if payment_request_items:
			frappe.throw(_('Payment Request already submitted for Insurance Claims<br>{}').format(
				'<br> '.join([f'{claim.insurance_claim} ({claim.status}),\
					Payment Request: {get_link_to_form(self.doctype, claim.parent)}' for claim in payment_request_items])
				), title=_('Payment Request Exists'))

	def update_linked_insurance_claim(self, claim):

		claim_status_map = {
            'Submitted': 'Payment Requested',
            'Cancelled': 'Payment Error'
        }

		frappe.db.set_value('Healthcare Insurance Claim', claim.insurance_claim, {
			'status': claim_status_map.get(claim.status, claim.status),
			'payment_approved_amount': claim.approved_amount,
			'paid_amount': claim.approved_amount if claim.status == 'Completed' else 0,
			'payment_request_comments': f'Insurance Payment Request {self.name}<br>{claim.payment_error_reason}'
		})

	def set_bank_cash_account(self):
		if self.mode_of_payment:
			self.paid_to = get_bank_cash_account(self.mode_of_payment, self.company).get("account")
		else:
			self.paid_to = ''

	@frappe.whitelist()
	def get_claims(self):
		if not self.insurance_company or not self.company:
			frappe.throw(_('Company and Insurance Provider are mandatory'), title=_('Missing Mandatory Fields'))

		claims = frappe.db.sql('''
			SELECT cl.name as insurance_claim, cl.posting_date as insurance_claim_posting_date,
				cl.patient as patient, cl.patient_name, cl.template_dt, cl.template_dn,
				cl.coverage, cl.discount, cl.claim_amount, cl.discount_amount,
				cl.medical_code_standard, cl.medical_code, cl.medical_code_description,
				cl.mode_of_approval, cl.insurance_coverage_plan, cl.gender, cl.birth_date,
				cl.policy_number, cl.policy_expiry_date,
				si.name as sales_invoice, si.posting_date as sales_invoice_posting_date,
				sii.amount as sales_invoice_item_amount,
				jea.credit_in_account_currency as allocated_amount, jea.parent as journal_entry,
				'Draft' as status
			FROM `tabHealthcare Insurance Claim` cl
			JOIN `tabSales Invoice Item` sii ON (cl.name=sii.insurance_claim AND sii.docstatus=1)
			JOIN `tabSales Invoice` si ON (si.name=sii.parent AND si.docstatus=1)
			JOIN `tabJournal Entry Account` jea ON (jea.reference_name=si.name AND jea.docstatus=1 AND cl.claim_amount=jea.credit_in_account_currency)
			WHERE
				cl.docstatus=1 AND
				cl.patient=%(patient)s AND
				cl.insurance_subscription=%(insurance_subscription)s AND
				cl.company=%(company)s AND
				cl.insurance_company=%(insurance_company)s AND
				({col} BETWEEN %(from_date)s AND %(to_date)s) AND
				cl.status in %(statuses)s
			ORDER BY patient ASC, {col} DESC
		'''.format(col='si.posting_date' if self.posting_date_based_on == 'Sales Invoice' else 'cl.posting_date'),
			{
				'patient': self.patient,
				'insurance_subscription': self.insurance_subscription,
				'company': self.company,
				'insurance_company': self.insurance_company,
				'from_date': self.from_date,
				'to_date': self.to_date,
				'statuses': tuple(['Invoiced', 'Payment Error'])
		}, as_dict=1)

		print(len(claims))

		for claim in claims:
			self.append('claims', claim)

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
	payment_entry.remarks = _('Payment Entry against Insurance Claims {} via Healthcare Insurance Payment Request {}').format(
		', '.join([claim.get('insurance_claim') for claim in doc.claims]), doc.name)

	# claim_names = []
	# for claim in doc.claims:
	# 	# add reference
	# 	if claim.get('status') == 'Payment Approved' and claim.get('journal_entry'):
	# 		payment_entry.append('references', {
	# 			'reference_doctype': 'Journal Entry',
	# 			'reference_name': claim.get('journal_entry'),
	# 			'total_amount': claim.get('allocated_amount'),
	# 			'outstanding_amount': claim.get('allocated_amount'),
	# 			'allocated_amount': claim.get('allocated_amount')
	# 		})
	# 	# build remarks
	# 	claim_names.append(claim.get('insurance_claim'))

	# payment_entry.remarks = _('Payment Entry against Insurance Claims {} via Healthcare Insurance Payment Request {}').format(
	# 	', '.join(claim_names), doc.name)

	payment_entry.setup_party_account_field()
	payment_entry.set_missing_values()

	return payment_entry.as_dict()

