# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
from frappe import _
from frappe.utils import getdate, get_link_to_form, flt
from frappe.model.document import Document

class CoverageOverlapError(frappe.ValidationError): pass

class HealthcareServiceInsuranceCoverage(Document):
	def validate(self):
		if self.coverage_based_on == 'Service':
			self.set_service_item()

		if self.is_active:
			self.validate_coverage_percentages()
			self.validate_dates()
			self.validate_overlaps()

		self.set_title()

	def validate_coverage_percentages(self):
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
				frappe.throw(_('<b>Valid From</b> date cannot be after <b>Valid Till</b> date'))

	def validate_overlaps(self):
		conditions = """is_active = 1 and name != {name} and ifnull(insurance_coverage_plan, '') = {plan}""".format(
			name=frappe.db.escape(self.name), plan=frappe.db.escape(self.insurance_coverage_plan))

		if self.valid_from and self.valid_till:
			conditions += """ and 
				((valid_from > {valid_from} and valid_from < {valid_till}) or
				(valid_till > {valid_from} and valid_till < {valid_till}) or
				({valid_from} > valid_from and {valid_from} < valid_till) or
				({valid_from} = valid_from and {valid_till} = valid_till))
			""".format(valid_from=frappe.db.escape(self.valid_from), valid_till=frappe.db.escape(self.valid_till))

		elif self.valid_from and not self.valid_till:
			conditions += """ and (valid_till >= {valid_from} or valid_from = {valid_from})""".format(valid_from=frappe.db.escape(self.valid_from))

		elif not self.valid_from and self.valid_till:
			conditions += """ and (valid_from <= {valid_till} or valid_till = {valid_till}""".format(valid_till=frappe.db.escape(self.valid_till))

		conditions += """ and ifnull(item_code, '') = {item_code}""".format(item_code=frappe.db.escape(self.item_code))

		conditions += """ and ifnull(template_dt, '') = {dt} and ifnull(template_dn, '') = {dn} """.format(
			dt=frappe.db.escape(self.template_dt), dn=frappe.db.escape(self.template_dn))

		overlap = frappe.db.sql('''
			SELECT name
			FROM `tabHealthcare Service Insurance Coverage`
			WHERE {}
		'''.format(conditions), as_dict=1)

		if overlap:
			frappe.throw(_('Coverage overlaps with {}').format(get_link_to_form(self.doctype, overlap[0].name)),
				CoverageOverlapError, title=_('Not Allowed'))

	def set_service_item(self):
		'''
		Set item code for all services except appointment type
		for appointment type, item code is based on department
		'''
		if self.template_dt == 'Therapy Plan Template':
			self.item_code = frappe.db.get_value(self.template_dt, self.template_dn, 'linked_item')
		elif self.template_dt != 'Appointment Type':
			self.item_code = frappe.db.get_value(self.template_dt, self.template_dn, 'item')

	def set_title(self):
		if self.coverage_based_on == 'Service':
			self.title = _('{} - {}').format(self.template_dt, self.template_dn)

		elif self.coverage_based_on == 'Item':
			self.title = _('{} - {}').format(self.item_code, self.coverage_based_on)

def get_insurance_coverage(item_code, template_dt=None, template_dn=None, on_date=None, coverage_plan=None):

	conditions = """ifnull(is_active, 0) = 1 and
		ifnull(insurance_coverage_plan, '') = {}""".format(frappe.db.escape(coverage_plan or ''))

	conditions += """ and ('{}' between
		ifnull(valid_from, '2000-01-01') and ifnull(valid_till, '2500-12-31'))""".format(getdate(on_date) or getdate())

	conditions += """ and ( (ifnull(item_code, '') = {item_code})""".format(item_code=frappe.db.escape(item_code or ''))

	conditions += """ or (ifnull(template_dt, '') = {dt} and ifnull(template_dn, '') = {dn}) )""".format(
			dt=frappe.db.escape(template_dt), dn=frappe.db.escape(template_dn))

	coverage = frappe.db.sql('''
		SELECT
			name, template_dt, medical_code, item_code,
			valid_from, valid_till, insurance_coverage_plan,
			mode_of_approval, coverage, discount
		FROM `tabHealthcare Service Insurance Coverage`
		WHERE {}
		ORDER BY valid_from DESC
		LIMIT 1
	'''.format(conditions), as_dict=1)

	if len(coverage) > 0:
		return coverage[0]

	return None
