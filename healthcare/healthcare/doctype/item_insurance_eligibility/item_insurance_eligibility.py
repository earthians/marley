# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe import _
from frappe.utils import getdate, get_link_to_form, flt
from frappe.model.document import Document

class CoverageOverlapError(frappe.ValidationError):
	pass

class ItemInsuranceEligibility(Document):
	def validate(self):
		if self.eligibility_for == 'Service':
			self.set_service_item()

		if self.is_active:
			self.validate_coverage_percentageages()
			self.validate_dates()
			self.validate_overlaps()

		self.set_title()

	def validate_coverage_percentageages(self):
		if self.coverage == 100:
			self.discount = 0

		if flt(self.coverage) <= 0 or \
				flt(self.coverage) > 100 or \
				flt(self.discount) < 0 or \
				((flt(self.discount) + flt(self.discount)) > 100):
			frappe.throw(_('Invalid Coverage / Discount percentage'))

	def validate_dates(self):
		if self.valid_from and self.valid_till:
			if self.valid_from > self.valid_till:
				frappe.throw(
					_('<b>Valid From</b> date cannot be after <b>Valid Till</b> date'))

	def validate_overlaps(self):
		conditions = '''is_active=1 AND
			name!={name} AND
			COALESCE(insurance_plan, '')={plan}
		'''.format(
			name=frappe.db.escape(self.name),
			plan=frappe.db.escape(self.insurance_plan)
		)

		if self.valid_from and self.valid_till:
			conditions += ''' AND
				((valid_from > {valid_from} AND valid_from < {valid_till}) OR
				(valid_till > {valid_from} AND valid_till < {valid_till}) OR
				({valid_from} > valid_from AND {valid_from} < valid_till) OR
				({valid_from} = valid_from AND {valid_till} = valid_till))
			'''.format(
				valid_from=frappe.db.escape(self.valid_from),
				valid_till=frappe.db.escape(self.valid_till)
			)

		elif self.valid_from and not self.valid_till:
			conditions += ''' AND
				(valid_till>={valid_from}
				OR
				valid_from={valid_from})
			'''.format(valid_from=frappe.db.escape(self.valid_from))

		elif not self.valid_from and self.valid_till:
			conditions += ''' AND
				(valid_from <= {valid_till}
				OR
				valid_till={valid_till}
			'''.format(valid_till=frappe.db.escape(self.valid_till))

		conditions += ''' AND COALESCE(item_code, '')={item_code} AND
			COALESCE(template_dt, '')={dt} AND
			COALESCE(template_dn, '')={dn}
		'''.format(
			item_code=frappe.db.escape(self.item_code),
			dt=frappe.db.escape(self.template_dt),
			dn=frappe.db.escape(self.template_dn)
		)

		overlap = frappe.db.sql('''
			SELECT name
			FROM `tabItem Insurance Eligibility`
			WHERE {conditions}
		'''.format(conditions=conditions), as_dict=1)

		if overlap:
			frappe.throw(_('Item Eligibility overlaps with {eligibility}').format(eligibility=get_link_to_form(self.doctype, overlap[0].name)),
						 CoverageOverlapError, title=_('Not Allowed'))

	def set_service_item(self):
		'''
		Set item code for all services except appointment type
		for appointment type, item code is based on department
		'''
		if self.template_dt == 'Therapy Plan Template':
			self.item_code = frappe.db.get_value(
				self.template_dt, self.template_dn, 'linked_item')
		elif self.template_dt != 'Appointment Type':
			self.item_code = frappe.db.get_value(
				self.template_dt, self.template_dn, 'item')

	def set_title(self):
		if self.eligibility_for == 'Service':
			self.title = _(f'{self.template_dt} - {self.template_dn}')

		elif self.eligibility_for == 'Item':
			self.title = _(f'{self.item_code} - {self.eligibility_for}')


def get_insurance_eligibility(item_code, template_dt=None, template_dn=None, on_date=None, insurance_plan=None):
	'''
	Returns the eligibility for item_code / template_dn
	'''

	conditions = '''COALESCE(is_active, 0)=1 AND (
		COALESCE(insurance_plan, '')={plan}
		OR
		COALESCE(insurance_plan, '')=''
		)
	'''.format(plan=frappe.db.escape(insurance_plan or ''))

	conditions += ''' AND ({on_date} BETWEEN
		COALESCE(valid_from, '2000-01-01') AND COALESCE(valid_till, '2500-12-31'))
	'''.format(on_date=frappe.db.escape(getdate(on_date) or getdate()))

	conditions += ''' AND (
		(COALESCE(item_code, '')={item_code})
		OR
		(COALESCE(template_dt, '')={dt} and COALESCE(template_dn, '')={dn})
		)
	'''.format(item_code=frappe.db.escape(item_code or ''),
		dt=frappe.db.escape(template_dt),
		dn=frappe.db.escape(template_dn)
	)

	coverage = frappe.db.sql('''
		SELECT
			name,
			template_dt,
			medical_code,
			item_code,
			mode_of_approval,
			coverage,
			discount,
			valid_from,
			valid_till,
			insurance_plan
		FROM `tabItem Insurance Eligibility`
		WHERE {conditions}
		ORDER BY valid_from DESC
		LIMIT 1
	'''.format(conditions=conditions),
	as_dict=1)

	return coverage[0] if coverage else None
