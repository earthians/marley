# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe import _
from frappe.utils import get_link_to_form, getdate
from frappe.model.document import Document

class OverlapError(frappe.ValidationError):
	pass

class PatientInsurancePolicy(Document):
	def validate(self):
		self.validate_expiry_date()
		self.validate_policy_overlap()
		self.validate_policy_number()
		self.set_title()

	def validate_expiry_date(self):
		if getdate(self.policy_expiry_date) < getdate():
			frappe.throw(_('Expiry Date for the Insruance Policy cannot be a past date'))

	def validate_policy_overlap(self):
		insurance_policy = frappe.db.exists('Patient Insurance Policy', {
			'patient': self.patient,
			'docstatus': 1,
			'policy_expiry_date': ['<=', self.policy_expiry_date],
			'insurance_payor': self.insurance_payor,
			'insurance_plan': self.insurance_plan or ''
		})
		if insurance_policy:
			frappe.throw(_('Patient {0} already has an active insurance policy {1} with the coverage plan {2} for this period').format(
				frappe.bold(self.patient), get_link_to_form('Patient Insurance Policy', insurance_policy),
				frappe.bold(self.insurance_plan)), title=_('Duplicate'))

	def validate_policy_number(self):
		insurance_policy = frappe.db.exists('Patient Insurance Policy', {
			'patient': self.patient,
			'docstatus': 1,
			'policy_number': self.policy_number
		})
		if insurance_policy:
			frappe.throw(_('Patient {0} already has an Insurance Policy {1} with the same Policy Number {2}').format(
				frappe.bold(self.patient), get_link_to_form('Patient Insurance Policy', insurance_policy),
				frappe.bold(self.policy_number)), title=_('Duplicate'), exc=OverlapError)

	def set_title(self):
		self.title = _('{0} - {1}').format(self.patient_name or self.patient, self.policy_number)


def is_insurance_policy_valid(policy, on_date=None, company=None):
	'''
	Returns True if Patient Insurance Policy is valid
	#TODO: If company is received, checks if the company has a valid contract
	'''
	policy_expiry = frappe.db.get_value('Patient Insurance Policy', policy, ['policy_expiry_date'])
	if getdate(policy_expiry) >= (getdate(on_date) or getdate()):
		return True

	return False


def get_insurance_price_lists(insurance_policy, company):
	'''
	Returns plan price list and the default price list
	'''
	price_lists = {}
	insurance_plan, insurance_payor = frappe.db.get_value('Patient Insurance Policy', insurance_policy, ['insurance_plan', 'insurance_payor'])
	if insurance_plan:
		plan_price_list = frappe.db.get_value('Healthcare Insurance Plan', insurance_plan, 'price_list')
		if plan_price_list:
			price_lists.update({'plan_price_list': plan_price_list})

	if insurance_payor and company:
		default_price_list = frappe.db.get_value('Insurance Payor Contract', {'insurance_payor': insurance_payor, 'company': company}, 'default_price_list')
		price_lists.update({'default_price_list': default_price_list})

	return price_lists
