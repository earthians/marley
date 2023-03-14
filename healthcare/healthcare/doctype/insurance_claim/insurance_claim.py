# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe import _
from frappe.utils import getdate, get_link_to_form, unique
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

	def on_submit(self):
		for coverage in self.coverages:
			update_insurance_coverage_status(coverage)

	def before_cancel(self):
		'''
		stop cancel if payment is complete
		update child coverage
		update linked Patient Insurance Coverage
		'''
		if self.status == 'Completed' or self.paid_amount > 0:
			frappe.throw(_('Cannot Cancel, Insurance Claim already Completed / Partly Paid'), title=_('Not Allowed'))

		for coverage in self.coverages:
			coverage.approved_amount = coverage.rejected_amount = 0
			coverage.payment_error_reason = 'Claim Cancelled'
			coverage.status = 'Cancelled'

			update_insurance_coverage_status(coverage)

		self.insurance_claim_amount = self.outstanding_amount = self.paid_amount = self.approved_amount = self.rejected_amount = 0
		self.status = 'Cancelled'

	def before_update_after_submit(self):
		'''
		verify and set status, amount fields and payment_error_reason
		'''
		approved_amount = rejected_amount = paid_amount = 0

		for coverage in self.coverages:
			# Submitted
			if coverage.status == 'Submitted':
				coverage.approved_amount = 0
				coverage.rejected_amount = 0
				coverage.payment_error_reason = ''
				coverage.paid_amount = 0

			elif coverage.status in ['Approved', 'Completed']:
				# Approved
				coverage.approved_amount = coverage.claim_amount
				coverage.rejected_amount = 0
				coverage.payment_error_reason = ''

				# paid_amount can be set via payment_entry on_submit hook
				if coverage.paid_amount == coverage.approved_amount:
					coverage.status = 'Completed'
				else: # cancel Payment Entry
					coverage.status = 'Approved'

			elif coverage.status in ['Rejected', 'Error']:
				# Not Approved
				coverage.approved_amount = 0
				coverage.rejected_amount = coverage.claim_amount
				coverage.paid_amount = 0
				if not coverage.payment_error_reason:
						frappe.throw(_('<b>Reason for Claim Rejection / Error</b> is required, please update row #{}')
							.format(coverage.idx), title=_('Reason Required'))

			elif coverage.status == 'Cancelled':
				coverage.approved_amount = 0
				coverage.rejected_amount = 0
				coverage.paid_amount = 0
				coverage.payment_error_reason = 'Claim Cancelled'

			# validate amount fields
			if coverage.approved_amount > coverage.claim_amount or \
				coverage.rejected_amount > coverage.claim_amount or \
				coverage.paid_amount > coverage.claim_amount:
				frappe.throw(_('Approved / Rejected / Paid Amount connot be more than Claim Amount, please update row #{}')
					.format(coverage.idx), title=_('Validation Error'))

			approved_amount += coverage.approved_amount
			rejected_amount += coverage.rejected_amount
			paid_amount += coverage.paid_amount

			update_insurance_coverage_status(coverage)

		# set Insurance Claim totals
		self.approved_amount = approved_amount
		self.rejected_amount = rejected_amount
		self.paid_amount = paid_amount

		self.outstanding_amount = self.approved_amount - self.paid_amount

		# set 'Completed' status
		if self.outstanding_amount == 0 and self.paid_amount == self.approved_amount:
			if self.rejected_amount == self.insurance_claim_amount:
				self.status = 'Error'
			else:
				self.status = 'Completed'
		else:
			self.status = 'Submitted'


	def validate_and_set_totals(self, status='Draft'):
		'''
		validate coverage amount
		set total fields
		'''
		total_coverage_amount = 0
		for coverage in self.coverages:
			if coverage.claim_amount <= 0:
				frappe.throw(_('Invalid Claim Amount, row #{}').format(coverage.idx))

			coverage.status = status
			coverage.approved_amount = 0
			coverage.rejected_amount = 0
			coverage.paid_amount = 0
			coverage.payment_error_reason = ''
			total_coverage_amount += coverage.claim_amount

		self.insurance_claim_amount = total_coverage_amount
		self.outstanding_amount = self.paid_amount = self.approved_amount = self.rejected_amount = 0

		self.status = status

	def validate_existing_insurance_claims(self):
		'''
		checks if insurance coverage is already part of payment requests in status Submitted / Approved / Completed
		'''
		coverages = [coverage.insurance_coverage for coverage in self.coverages]
		claim_coverages = frappe.db.get_all('Insurance Claim Coverage', {
			'parent': ['!=', self.name],
			'status': ['in', ['Submitted', 'Approved', 'Completed']],
			'insurance_coverage': ['in', coverages]
		}, ['insurance_coverage', 'status', 'parent'])

		if claim_coverages:
			frappe.throw(_('Insurance Claim already submitted for Insurance Coverages<br>{}').format(
				'<br> '.join([f'{coverage.insurance_coverage} ({coverage.status}),\
					Insurance Claim: {get_link_to_form(self.doctype, coverage.parent)}' for coverage in claim_coverages])
				), title=_('Validation Error'))


	def set_bank_cash_account(self):
		if self.mode_of_payment:
			self.payment_account = get_bank_cash_account(self.mode_of_payment, self.company).get('account')
		else:
			self.payment_account = ''

	@frappe.whitelist()
	def get_coverages(self):
		if not self.insurance_payor or not self.company:
			frappe.throw(_('Company and Insurance Provider are mandatory'), title=_('Missing Mandatory Fields'))

		valid_statuses = ['Partly Invoiced', 'Invoiced'] # allow user selection?

		coverages = frappe.db.sql('''
			SELECT
				pic.name AS insurance_coverage,
				pic.posting_date AS insurance_coverage_posting_date,
				pic.patient AS patient,
				pic.patient_name,
				pic.template_dt,
				pic.template_dn,
				pic.coverage,
				pic.discount,
				pic.coverage_amount,
				pic.discount_amount,
				pic.medical_code_standard,
				pic.medical_code,
				pic.medical_code_description,
				pic.mode_of_approval,
				pic.insurance_plan,
				pic.gender,
				pic.birth_date,
				pic.policy_number,
				pic.policy_expiry_date,
				si.name AS sales_invoice,
				si.posting_date AS sales_invoice_posting_date,
				sii.item_code,
				sii.amount AS sales_invoice_item_amount,
				sii.coverage_percentage AS claim_coverage,
				sii.insurance_coverage_amount AS claim_amount,
				sii.discount_percentage AS invoice_discount,
				sii.discount_amount AS invoice_discount_amount,
				jea.credit_in_account_currency AS allocated_amount,
				jea.parent AS journal_entry,
				'Draft' AS status
			FROM `tabPatient Insurance Coverage` AS pic
			INNER JOIN `tabSales Invoice Item` AS sii ON
				(pic.name=sii.insurance_coverage AND sii.docstatus=1)
			INNER JOIN `tabSales Invoice` AS si ON
				(si.name=sii.parent AND si.docstatus=1)
			INNER JOIN `tabJournal Entry Account` AS jea ON
				(jea.docstatus=1 AND jea.reference_detail_no=sii.name )
			WHERE
				pic.docstatus=1 AND
				pic.company=%(company)s AND
				pic.insurance_payor=%(insurance_payor)s AND
				pic.patient=%(patient)s AND
				pic.insurance_policy=%(insurance_policy)s AND
				({filter_date_based_on} BETWEEN %(from_date)s AND %(to_date)s) AND
				pic.status IN %(statuses)s AND
				pic.paid_amount < pic.coverage_amount_invoiced
			ORDER BY patient ASC, {filter_date_based_on} DESC
			'''.format(filter_date_based_on='si.posting_date' if self.posting_date_based_on == 'Sales Invoice' else 'pic.posting_date'),
			{
				'patient': self.patient,
				'insurance_policy': self.insurance_policy,
				'company': self.company,
				'insurance_payor': self.insurance_payor,
				'from_date': self.from_date,
				'to_date': self.to_date,
				'statuses': tuple(valid_statuses)
		}, as_dict=1)

		if not coverages:
			frappe.throw(_('No matching Patient Insurance Coverages found, please check the filters'), title=_('No Data'))
		for coverage in coverages:
			self.append('coverages', coverage)


def update_insurance_coverage_status(coverage):
	'''
	update status of Patient Insurance Coverage
	'''
	coverage_doc = frappe.get_doc('Patient Insurance Coverage', coverage.insurance_coverage)

	coverage_doc.db_set({
		'approved_amount': coverage.approved_amount,
		'paid_amount': coverage.paid_amount
	})

	coverage_doc.add_comment('Comment', f'''
		Insurance Claim {get_link_to_form('Insurance Claim', coverage.parent)} {coverage.status}
		{"<br>Reason: " + coverage.payment_error_reason if coverage.status in ['Rejected', 'Error'] else ''}
	''')

	coverage_doc.notify_update()


def validate_payment_entry_and_set_claim_fields(pe):
	'''
	hook Payment Entry validate
	if reference_doctype is journal entry and journal_entry has insurance_coverage link validate an approved claim is present
	if approved claim is available, set links in Payment Entry Reference
	'''
	for pe_ref in pe.get('references'):
		if pe_ref.get('reference_doctype') == 'Journal Entry':
			insurance_coverage = frappe.db.get_value('Journal Entry', pe_ref.get('reference_name'), 'insurance_coverage')
			if not insurance_coverage:
				continue

			claim_details = frappe.db.get_value('Insurance Claim Coverage',
				filters={
					'journal_entry': pe_ref.get('reference_name'),
					'insurance_coverage': insurance_coverage,
					'status': 'Approved'
				},
				fields=['name as insurance_claim_coverage', 'parent as insurance_claim']
			)

			if not claim_details:
				# claim created for the jv yet, stop payment
				frappe.throw(_('Row #{1} No Approved Insurance Claim found for Journal Entry {0}')
					.format(pe_ref.get("reference_name"), pe_ref.get("idx")), title=_('Not Allowed'))

			pe_ref.insurance_claim = claim_details.insurance_claim
			pe_ref.insurance_claim_coverage = claim_details.insurance_claim_coverage



def update_claim_paid_amount(pe, method):
	'''
	hook Payment Entry on_submit / on_cancel
	update paid amount in Insurance Claim Coverage
	'''
	if not pe.payment_type == 'Receive':
		return

	insurance_claims = unique([pe_ref.get('insurance_claim') for pe_ref in pe.references if pe_ref.get('insurance_claim')])

	for claim in insurance_claims:

		claim = frappe.get_doc('Insurance Claim', claim)
		for claim_coverage in claim.coverages:
			# process claim coverage based on journal entry

			if claim_coverage.status not in ['Approved', 'Completed']:
				continue

			pe_refs = [pe_ref for pe_ref in pe.get('references') if pe_ref.get('reference_name') == claim_coverage.journal_entry]
			if not pe_refs:
				continue

			# set paid_amount
			if method == 'on_submit':
				claim_coverage.paid_amount += sum(pe_ref.get('allocated_amount') for pe_ref in pe_refs)
			else:
				claim_coverage.paid_amount -= sum(pe_ref.get('allocated_amount') for pe_ref in pe_refs)

		# NOTE: claim status handled via Insurance Claim before_update_after_submit
		claim.save(ignore_permissions=True)
		claim.notify_update()


@frappe.whitelist()
def create_payment_entry(doc):

	import json

	if isinstance(doc, str):
		doc = json.loads(doc)
		doc = frappe._dict(doc)

	pe = frappe.new_doc('Payment Entry')
	pe.voucher_type = 'Payment Entry'
	pe.company = doc.company
	pe.posting_date = getdate()
	pe.mode_of_payment = doc.mode_of_payment
	pe.paid_to = doc.payment_account
	pe.payment_type = "Receive"
	pe.party_type = "Customer"
	pe.party = doc.customer
	pe.paid_amount= doc.outstanding_amount
	pe.received_amount = doc.outstanding_amount
	pe.custom_remarks = True

	coverage_names = []
	# add references
	references = []
	for coverage in doc.coverages:
		if coverage.get('status') == 'Approved' and coverage.get('journal_entry'):
			references.append({
				'reference_doctype': 'Journal Entry',
				'reference_name': coverage.get('journal_entry'),
				'insurance_claim': coverage.get('parent'),
				'insurance_claim_coverage': coverage.get('name'),
				'total_amount': coverage.get('allocated_amount'),
				'outstanding_amount': coverage.get('allocated_amount'),
				'allocated_amount': coverage.get('allocated_amount')
			})
			# build remarks
			coverage_names.append(coverage.get('insurance_coverage'))

	if references:
		pe.update({'references': references})
	else:
		frappe.throw('No Insurance Claim Coverages in Approved status to create Payment Entry')

	pe.remarks = _('Payment Entry against Insurance Coverages {} via Insurance Claim {}').format(
		', '.join(coverage_names), doc.name)

	pe.setup_party_account_field()
	pe.set_missing_values()

	return pe.as_dict()
