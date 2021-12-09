# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe, erpnext
from frappe import _
from frappe.model.document import Document
from frappe.contacts.address_and_contact import load_address_and_contact
from frappe.utils import getdate

class InsurancePayor(Document):
	def validate(self):
		# Verify if party account entries are duplicated for company
		receivable_accounts_list = [account.get('company') for account in self.claims_receivable_accounts]
		if len(receivable_accounts_list) != len(set(receivable_accounts_list)):
			frappe.throw(_('Receivable Account is entered more than once for same Company'))

		expense_accounts_list = [account.get('company') for account in self.rejected_claims_expense_accounts]
		if len(expense_accounts_list) != len(set(expense_accounts_list)):
			frappe.throw(_('Rejected Claims Expense Account is entered more than once for same company'))

	def onload(self):
		load_address_and_contact(self)

	def on_update(self):
		if self.customer:
			self.update_customer()
		else:
			self.create_customer()

	def create_customer(self):
		accounts = []

		if self.claims_receivable_accounts:
			for party_account in self.claims_receivable_accounts:
				if party_account.account:
					accounts.append({
						'account': party_account.account,
						'company': party_account.company
					})
				else:
					frappe.throw(_('Claims Receivable Account is mandatory for Company {}').format(frappe.bold(party_account.company)))

		customer_group = frappe.db.exists('Customer Group', {'customer_group_name': _('Insurance Payor')})
		if not customer_group:
			customer_group = frappe.get_doc({
				'customer_group_name': 'Insurance Payor',
				'parent_customer_group': 'All Customer Groups',
				'doctype': 'Customer Group'
			}).insert(ignore_permissions=True, ignore_mandatory=True)

		customer = frappe.get_doc({
			'doctype': 'Customer',
			'customer_name': self.insurance_payor_name,
			'customer_group': customer_group or frappe.db.get_single_value('Selling Settings', 'customer_group'),
			'territory': frappe.db.get_single_value('Selling Settings', 'territory'),
			'customer_type': 'Company',
			'accounts': accounts
		}).insert(ignore_permissions=True, ignore_mandatory=True)

		self.db_set('customer', customer.name)
		frappe.msgprint(_('Customer {0} is created.').format(customer.name), alert=True)

	def update_customer(self):
		customer = frappe.get_doc('Customer', self.customer)

		for party_account in self.claims_receivable_accounts:
			if not party_account.account:
				frappe.throw(_('Claims Receivable Account is mandatory for Company {}').format(frappe.bold(party_account.company)))

			customer_party_account = next((customer_account for customer_account in customer.accounts if customer_account.get('company') == party_account.get('company')), None)
			if customer_party_account:
				# Update Party Account
				customer_party_account.update({
					'account': party_account.account
				})
			else:
				# Append new Party Account
				customer.append('accounts', {
					'account': party_account.account,
					'company': party_account.company
				})

		customer.save(ignore_permissions=True)


def get_insurance_party_details(insurance_payor, company):
	'''
	Returns linked Customer, Receivable Account configured for Insurance Payor or Default Receivable Account for Company
	'''
	if insurance_payor and company:
		return {
			'party': frappe.db.get_value('Insurance Payor', insurance_payor, 'customer'),
			'receivable_account': get_account('claims_receivable_accounts', insurance_payor, company) or
				frappe.get_cached_value('Company', company, 'default_receivable_account')
		}


def get_insurance_payor_expense_account(insurance_payor, company):
	'''
	Returns the Rejected Claims Expense Account if configured for Insurance Payor
	'''
	if insurance_payor and company:
		account = get_account('rejected_claims_expense_accounts', insurance_payor, company)
		if not account:
			frappe.throw(_('Rejected Claims Expense account is not configured for Company {}').format(frappe.bold(company)))

		return account


def get_account(parent_field, insurance_payor, company):
	if parent_field and insurance_payor and company:
		return frappe.db.get_value('Party Account',
			{'parenttype': 'Insurance Payor', 'parentfield': parent_field, 'parent': insurance_payor, 'company': company},
			'account'
		)

@frappe.whitelist()
def has_active_contract(insurance_payor, company=None, on_date=None):
	if not frappe.db.get_value('Insurance Payor', insurance_payor, 'disabled'):
		return frappe.db.exists('Insurance Payor Contract', {
				'insurance_payor': insurance_payor,
				'company': company or erpnext.get_default_company(),
				'is_active': 1,
				'docstatus': 1,
				'start_date': ('<=', getdate(on_date) or getdate()),
				'end_date':('>=', getdate(on_date) or getdate())
			})
