# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import frappe
from frappe import _
from frappe.utils import getdate, flt, get_link_to_form
from frappe.model.document import Document
from healthcare.healthcare.doctype.item_insurance_eligibility.item_insurance_eligibility import get_insurance_eligibility
from healthcare.healthcare.doctype.patient_insurance_policy.patient_insurance_policy import (
	is_insurance_policy_valid,
	get_insurance_price_lists
)

from erpnext.stock.get_item_details import get_item_details

class CoverageNotFoundError(frappe.ValidationError): pass
class PatientInsuranceCoverage(Document):
	def validate(self):
		self.validate_insurance_policy()
		self.set_and_validate_template_details()

		if self.status in ['Draft', 'Approved']:
			self.set_insurance_coverage()
			self.set_insurance_price_list_rate()
			self.set_insurance_coverage_details()
			self.set_status()

		self.validate_invoice_details()
		self.set_title()

		# show alert if mode of approval is Manual
		if self.mode_of_approval == 'Manual' and self.status == 'Draft' and not self.flags.silent:
			frappe.msgprint(_('Manual approval required for Insurance Coverage {}').format(self.name),
				alert=True, indicator='orange')

	def validate_insurance_policy(self):
		if not self.insurance_policy:
			frappe.throw(_('Patient Insurance Policy is required to create Insurance Coverage'), title=_('Missing Insurance Policy'))

		if not is_insurance_policy_valid(self.insurance_policy, self.posting_date, self.company): # also checks for valid contract
			frappe.throw(_('Patient Insurance Policy {} is not valid as on {}').format(
				frappe.bold(self.insurance_policy), self.posting_date), title=_('Invalid Insurance Policy'))

	def set_status(self):
		if self.coverage_amount > 0:
			self.status = 'Approved' if self.mode_of_approval == 'Automatic' else self.status
		else:
			# Approve only if status manually set as "Approved"
			self.status = 'Draft' if self.mode_of_approval == 'Automatic' else self.status

	def validate_invoice_details(self):
		if self.qty_invoiced > self.qty or self.coverage_amount_invoiced > self.coverage_amount:
			frappe.throw(_('Invoiced Quantity and Invoiced Amount cannot be more than Claim Quantity {} and Claim Amount {}').format(
				self.qty_invoiced, self.status), title=_('Not Allowed'))

	def before_submit(self):
		if self.status not in ['Approved', 'Rejected']:
			frappe.throw(_('Only Insurance Coverages in Status <b>Approved</b> or <b>Rejected</b> can be submitted'), title=_('Not Allowed'))

		if self.status == 'Approved' and self.coverage <= 0:
			frappe.throw(_('Invalid Coverage Percent {}, cannot submit Insurance Coverage as Approved').format(frappe.bold(self.coverage)), title=_('Not Allowed'))

	def on_submit(self):
		if not self.flags.silent:
			frappe.msgprint(_('Insurance Coverage {} - {}<br>Discount: {}%, Coverage: {}%').format(
				self.name, frappe.bold(self.status), self.discount, self.coverage),
				alert=True, indicator='green' if self.status == 'Approved' else 'orange')

		self.flags.silent = False

	def update_invoice_details(self, qty=0, amount=0):
		'''
		updates qty_invoiced, coverage_amount_invoiced and sets status
		NOTE: on invoice cancel, qty and amount ca be negative
		'''
		qty_invoiced = self.qty_invoiced + qty
		coverage_amount_invoiced = self.coverage_amount_invoiced + amount

		if qty_invoiced == 0:
			status = 'Approved'
		if qty_invoiced < self.qty:
			status = 'Partly Invoiced'
		else:
			status = 'Invoiced'

		self.db_set({
			'qty_invoiced': qty_invoiced,
			'coverage_amount_invoiced': coverage_amount_invoiced,
			'status': status
		})

	def before_cancel(self):
		allowed = ['Draft', 'Approved', 'Rejected']
		if self.status not in allowed:
			frappe.throw(_('You can only cancel Insurance Coverage with Status {}').format(', '.join(allowed)),
				title=_('Not Allowed'))

	def set_title(self):
		self.title = f'{self.patient_name} - {self.template_dn} - {self.status}'

	def set_and_validate_template_details(self):
		'''
		set details from template
		is_billable and item fieldnames are mandatory for template doctypes
		Appointment Type is not considered except for validating item_code
		'''
		details = {}
		if self.template_dt and self.template_dn and self.template_dt != 'Appointment Type':
			field_list = ['is_billable', 'item']
			if frappe.get_meta(self.template_dt).has_field('medical_code'):
				field_list.extend(['medical_code', 'medical_code_standard'])

			details = frappe.db.get_value(self.template_dt, self.template_dn, field_list, as_dict=1)

			if not details.get('is_billable'):
				frappe.throw(_('Invalid Service Template, Insurance Coverage can only be created for Templates marked <b>Is Billable</b>'), title=_('Not Allowed'))

			self.item_code = details.get('item')
			self.medical_code = details.get('medical_code')
			self.medical_code_standard = details.get('medical_code_standard')

			# item code is mandatory for all coverages
			if not self.item_code:
				frappe.throw(_('Invalid Service Template, Item is required to create Insurance Coverage'), title=_('Missing Mandatory Fields'))

	def set_insurance_coverage(self):
		'''
		Set Insurance coverage for the Item and set coverage details
		Retruns True if if Insurance Coverage present for template / item_code else show alert and return False
		'''
		eligibility = get_insurance_eligibility(
			item_code=self.item_code,
			template_dt=self.template_dt,
			template_dn=self.template_dn,
			on_date=self.posting_date,
			insurance_plan=self.insurance_plan
		)

		if not eligibility:
			frappe.msgprint(_('Insurance Coverage not found for {}.').format(self.item_code), alert=True, indicator='error')

			if self.mode_of_approval == 'Automatic':
				# mode_of_approval cannot be automatic if coverage not based on coverage
				raise CoverageNotFoundError
		else:
			self.service_coverage = eligibility.get('name')
			self.insurance_plan = eligibility.get('insurance_plan')
			self.mode_of_approval = eligibility.get('mode_of_approval')
			self.coverage = eligibility.get('coverage')
			self.discount = eligibility.get('discount')
			# reset coverage_validity_end_date if coverage validity is less than policy end date (default)
			if eligibility.get('valid_till') and getdate(eligibility.get('valid_till')) < getdate(self.coverage_validity_end_date):
				self.coverage_validity_end_date = eligibility.get('valid_till')

	def set_insurance_price_list_rate(self):
		'''
		Set Insurance price list and price list rate for the Item
		Fetch Item price for Price List in this order: 1: Insurance Plan 2: Insurance Payor 3: Default Selling Price List
		Retruns True if Item Price found else show alert and return False
		'''
		insurance_price_lists = get_insurance_price_lists(self.insurance_policy, self.company)
		price_list = price_list_rate = None

		# price list set in insurance plan
		if insurance_price_lists and insurance_price_lists.get('plan_price_list'):
			price_list = insurance_price_lists.get('plan_price_list')
			price_list_rate = get_item_price_list_rate(self.item_code, price_list, self.qty, self.company)

		# insurance company price list
		if not price_list_rate and insurance_price_lists.get('default_price_list'):
			price_list = insurance_price_lists.get('default_price_list')
			price_list_rate = get_item_price_list_rate(self.item_code, price_list, self.qty, self.company)

		# fall back to Default Selling Price List set in Selling Settings
		if not price_list_rate:
			price_list = frappe.db.get_single_value('Selling Settings', 'selling_price_list')
			if price_list:
				price_list_rate = get_item_price_list_rate(self.item_code, price_list, self.qty, self.company)

		if price_list_rate:
			self.price_list_rate = price_list_rate
			self.price_list = price_list
		else:
			frappe.msgprint(_('Item Price for Item {} not found').format(get_link_to_form('Item', self.item_code)), alert=True, indicator='error')

	def set_insurance_coverage_details(self):
		'''
		Set coverage details (coverage amount, patient payable) based on Insurance Coverage and Item Price
		Retruns True if coverage amount calculated else show alert and return False
		'''
		if self.discount and self.discount > 0:
			self.discount_amount = (flt(self.price_list_rate) * flt(self.discount) * 0.01) * flt(self.qty)
		else:
			self.discount_amount = 0

		self.amount = (flt(self.price_list_rate) * flt(self.qty)) - flt(self.discount_amount)

		if self.coverage and self.coverage > 0:
			self.coverage_amount = flt(self.amount) * flt(self.coverage) * 0.01
		else:
			self.coverage_amount = 0

		self.patient_payable = flt(self.amount) - flt(self.coverage_amount)

		if self.coverage_amount <= 0:
			frappe.msgprint(_('Error calculating Coverage for Insurance Coverage {}. \
				Please verify Coverage for Item and then try saving Insurance Coverage again').format(self.name),
				alert=True, indicator='error')


def make_insurance_coverage(patient, policy, company, template_dt=None, template_dn=None, item_code=None, qty=1):
	'''
	Inserts a new Insurance Coverage for the service
	If coverage status is Approved, Submits the coverage
	Returns dict with coverage name and status if Insurance Coverage inserted
	'''
	if not (template_dt and template_dn) and not item_code:
		return None

	coverage = frappe.new_doc('Patient Insurance Coverage')
	coverage.status = 'Draft'
	coverage.mode_of_approval = 'Automatic' # setting to Manual will create coverage in draft mode
	coverage.patient = patient
	coverage.company = company
	coverage.posting_date = getdate()

	coverage.template_dt = template_dt
	coverage.template_dn = template_dn
	coverage.item_code = item_code if item_code else frappe.db.get_value(template_dt, template_dn, 'item') #TODO: verify fieldname item
	coverage.qty = qty

	coverage.insurance_policy = policy
	policy_details = frappe.db.get_value('Patient Insurance Policy', policy, ['policy_expiry_date', 'insurance_plan'], as_dict=True)
	coverage.coverage_validity_end_date = policy_details.get('policy_expiry_date')
	coverage.insurance_plan = policy_details.get('insurance_plan')

	try:
		coverage.insert(ignore_permissions=True)
	except CoverageNotFoundError:
		return None

	if coverage.status == 'Approved' and coverage.mode_of_approval == 'Automatic':
		coverage.submit()

	return {
		'coverage': coverage.name,
		'coverage_status': coverage.status
	}

def get_item_price_list_rate(item_code, price_list, qty, company):

	item_details = get_item_details(args={
		'doctype': 'Sales Invoice',
		'item_code': item_code,
        'qty': qty,
        'selling_price_list': price_list,
		'company': company,
		'plc_conversion_rate': 1.0,
		'conversion_rate': 1.0
	})

	return item_details.price_list_rate


@frappe.whitelist()
def create_insurance_coverage(doc):
	from six import string_types
	import json

	if isinstance(doc, string_types):
		doc = json.loads(doc)
		doc = frappe._dict(doc)

	coverage = frappe.new_doc('Item Insurance Eligibility')
	coverage.eligibility_for = 'Service' if doc.template_dt else 'Item'
	coverage.insurance_plan = doc.insurance_plan
	coverage.template_dt = doc.template_dt
	coverage.template_dn = doc.template_dn
	coverage.item = doc.item_code

	coverage.mode_of_approval = doc.mode_of_approval
	coverage.coverage = doc.coverage
	coverage.discount = doc.discount
	coverage.start_date = doc.posting_date or getdate()
	# coverage.end_date = doc.approval_validity_end_date # leave blank as coverage.approval_validity_end_date is dependent on policy end date

	return coverage
