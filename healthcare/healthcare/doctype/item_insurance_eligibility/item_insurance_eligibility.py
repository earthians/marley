# -*- coding: utf-8 -*-
# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.query_builder import Order
from frappe.query_builder.functions import Coalesce
from frappe.utils import flt, get_link_to_form, getdate


class CoverageOverlapError(frappe.ValidationError):
	pass


class ItemInsuranceEligibility(Document):
	def validate(self):
		if self.eligibility_for == "Service":
			self.set_service_item()

		if self.is_active:
			self.validate_coverage_percentageages()
			self.validate_dates()
			self.validate_overlaps()

		self.set_title()

	def validate_coverage_percentageages(self):
		if self.coverage == 100:
			self.discount = 0

		if (
			flt(self.coverage) <= 0
			or flt(self.coverage) > 100
			or flt(self.discount) < 0
			or ((flt(self.discount) + flt(self.discount)) > 100)
		):
			frappe.throw(_("Invalid Coverage / Discount percentage"))

	def validate_dates(self):
		if self.valid_from and self.valid_till:
			if self.valid_from > self.valid_till:
				frappe.throw(_("<b>Valid From</b> date cannot be after <b>Valid Till</b> date"))

	def validate_overlaps(self):
		item_eligibility = frappe.qb.DocType("Item Insurance Eligibility")

		query = (
			frappe.qb.from_(item_eligibility)
			.select(item_eligibility.name)
			.where(
				(item_eligibility.name != self.name)
				& (item_eligibility.is_active == 1)
				& (
					frappe.qb.terms.Case()
					.when(item_eligibility.insurance_plan.isnull(), "")
					.else_(item_eligibility.insurance_plan)
					== (self.insurance_plan or "")
				)
				& (
					frappe.qb.terms.Case()
					.when(item_eligibility.item_code.isnull(), "")
					.else_(item_eligibility.item_code)
					== (self.item_code or "")
				)
				& (
					frappe.qb.terms.Case()
					.when(item_eligibility.template_dt.isnull(), "")
					.else_(item_eligibility.template_dt)
					== (self.template_dt or "")
				)
				& (
					frappe.qb.terms.Case()
					.when(item_eligibility.template_dn.isnull(), "")
					.else_(item_eligibility.template_dn)
					== (self.template_dn or "")
				)
			)
		)

		if self.valid_till:
			query = query.where(
				(item_eligibility.valid_till.isnotnull())
				& (
					(item_eligibility.valid_from >= self.valid_from)
					& (item_eligibility.valid_from <= self.valid_till)
					| (item_eligibility.valid_till >= self.valid_from)
					& (item_eligibility.valid_till <= self.valid_till)
				)
			)
		else:
			query = query.where((item_eligibility.valid_from == self.valid_from))

		overlap = query.run(as_dict=True)

		if overlap:
			frappe.throw(
				_("Item Eligibility overlaps with {eligibility}").format(
					eligibility=get_link_to_form(self.doctype, overlap[0]["name"])
				),
				CoverageOverlapError,
			)

	def set_service_item(self):
		"""
		Set item code for all services except appointment type
		for appointment type, item code is based on department
		"""
		if self.template_dt == "Therapy Plan Template":
			self.item_code = frappe.db.get_value(self.template_dt, self.template_dn, "linked_item")
		elif self.template_dt != "Appointment Type":
			self.item_code = frappe.db.get_value(self.template_dt, self.template_dn, "item")

	def set_title(self):
		if self.eligibility_for == "Service":
			self.title = _(f"{self.template_dt} - {self.template_dn}")

		elif self.eligibility_for == "Item":
			self.title = _(f"{self.item_code} - {self.eligibility_for}")


def get_insurance_eligibility(
	item_code, template_dt=None, template_dn=None, on_date=None, insurance_plan=None
):
	"""
	Returns the eligibility for item_code / template_dn
	"""

	on_date = getdate(on_date) or getdate()

	def get_query(include_null_till):
		Eligibility = frappe.qb.DocType("Item Insurance Eligibility")
		query = (
			frappe.qb.from_(Eligibility)
			.select(
				Eligibility.name,
				Eligibility.template_dt,
				Eligibility.code_value,
				Eligibility.item_code,
				Eligibility.mode_of_approval,
				Eligibility.coverage,
				Eligibility.discount,
				Eligibility.valid_from,
				Eligibility.valid_till,
				Eligibility.insurance_plan,
			)
			.where(
				(Eligibility.is_active == 1)
				& (Coalesce(Eligibility.insurance_plan, "") == (insurance_plan or ""))
				& (
					(Coalesce(Eligibility.item_code, "") == item_code)
					| (
						(Coalesce(Eligibility.template_dt, "") == (template_dt or ""))
						& (Coalesce(Eligibility.template_dn, "") == (template_dn or ""))
					)
				)
				& (Eligibility.valid_from <= on_date)
			)
			.orderby(Eligibility.valid_from, order=Order.desc)
			.limit(1)
		)
		if include_null_till:
			query = query.where((Eligibility.valid_till.isnull()))
		else:
			query = query.where((Eligibility.valid_till.isnotnull()) & (Eligibility.valid_till >= on_date))
		return query

	# First try with a valid_till date
	coverage = get_query(include_null_till=False).run(as_dict=True)

	# Fallback: try eligibility without a valid_till
	if not coverage:
		coverage = get_query(include_null_till=True).run(as_dict=True)

	return coverage[0] if coverage else None
