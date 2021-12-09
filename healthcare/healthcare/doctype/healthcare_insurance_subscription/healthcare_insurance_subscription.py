# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe import _
from frappe.utils import get_link_to_form, getdate
from frappe.model.document import Document
from healthcare.healthcare.doctype.healthcare_insurance_company.healthcare_insurance_company import has_active_contract

class OverlapError(frappe.ValidationError):
	pass

class HealthcareInsuranceSubscription(Document):
	def validate(self):
		# check if a contract exist for the insurance company
		if not has_active_contract(self.insurance_company):
			frappe.throw(_('No active contracts found for Insurance Company {0}')
				.format(self.insurance_company))

		self.validate_expiry_date()
		self.validate_subscription_overlap()
		self.validate_policy_number()
		self.set_title()

	def validate_expiry_date(self):
		if getdate(self.policy_expiry_date) < getdate():
			frappe.throw(_('Expiry Date for the Subscription cannot be a past date'))

	def validate_subscription_overlap(self):
		insurance_subscription = frappe.db.exists('Healthcare Insurance Subscription', {
			'patient': self.patient,
			'docstatus': 1,
			'policy_expiry_date': ['<=', self.policy_expiry_date],
			'insurance_company': self.insurance_company,
			'insurance_coverage_plan': self.insurance_coverage_plan or ''
		})
		if insurance_subscription:
			frappe.throw(_('Patient {0} already has an active insurance subscription {1} with the coverage plan {2} for this period').format(
				frappe.bold(self.patient), get_link_to_form('Healthcare Insurance Subscription', insurance_subscription),
				frappe.bold(self.insurance_coverage_plan)), title=_('Duplicate'))

	def validate_policy_number(self):
		insurance_subscription = frappe.db.exists('Healthcare Insurance Subscription', {
			'patient': self.patient,
			'docstatus': 1,
			'policy_number': self.policy_number
		})
		if insurance_subscription:
			frappe.throw(_('Patient {0} already has an insurance subscription {1} with the same Policy Number {2}').format(
				frappe.bold(self.patient), get_link_to_form('Healthcare Insurance Subscription', insurance_subscription),
				frappe.bold(self.policy_number)), title=_('Duplicate'), exc=OverlapError)

	def set_title(self):
		self.title = _('{0} - {1}').format(self.patient_name or self.patient, self.policy_number)


def is_insurance_policy_valid(subscription, on_date=None, company=None):
	'''
	Returns True if Patient Insurance Policy is valid
	#TODO: If company is received, checks if the company has a valid contract
	'''
	policy_expiry = frappe.db.get_value('Healthcare Insurance Subscription', subscription, ['policy_expiry_date'])
	if getdate(policy_expiry) >= (getdate(on_date) or getdate()):
		return True

	return False


def get_insurance_price_lists(insurance_subscription, company):
	'''
	Returns plan price list and the default price list
	'''
	price_lists = {}
	coverage_plan, insurance_company = frappe.db.get_value('Healthcare Insurance Subscription', insurance_subscription, ['insurance_coverage_plan', 'insurance_company'])
	if coverage_plan:
		plan_price_list = frappe.db.get_value('Healthcare Insurance Coverage Plan', coverage_plan, 'price_list')
		if plan_price_list:
			price_lists.update({'plan_price_list': plan_price_list})

	if insurance_company and company:
		default_price_list = frappe.db.get_value('Healthcare Insurance Contract', {'insurance_company': insurance_company, 'company': company}, 'default_price_list')
		price_lists.update({'default_price_list': default_price_list})

	return price_lists