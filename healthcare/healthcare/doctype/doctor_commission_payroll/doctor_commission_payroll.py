# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, getdate


class DoctorCommissionPayroll(Document):
	def validate(self):
		if self.from_date and self.to_date and getdate(self.from_date) > getdate(self.to_date):
			frappe.throw(_("From Date cannot be after To Date"))

		if not self.default_commission_percent and self.default_commission_percent != 0:
			self.default_commission_percent = flt(
				frappe.db.get_single_value("Healthcare Settings", "doctors_commission")
			)

		if not self.salary_component:
			self.salary_component = frappe.db.get_single_value(
				"Healthcare Settings", "doctor_commission_salary_component"
			)

		if not self.payroll_date and self.to_date:
			self.payroll_date = self.to_date

		self._recalc_totals()

	def before_submit(self):
		if self.status not in ("Generated", "Reviewed", "Approved", "Salary Created"):
			frappe.throw(_("Generate commission before submitting"))
		if not self.doctors:
			frappe.throw(_("No doctor commission rows to submit. Generate first."))
		self.status = "Approved"

	def on_submit(self):
		self._set_linked_sales_orders_commission_flag(1)

	def on_cancel(self):
		self._cancel_linked_additional_salaries()
		self._set_linked_sales_orders_commission_flag(0)
		self.status = "Cancelled"
		self.additional_salaries_created = 0

	def _set_linked_sales_orders_commission_flag(self, value: int):
		from healthcare.api.doctor_commission import set_sales_orders_commission_generated

		sales_orders = [row.sales_order for row in (self.items or []) if row.sales_order]
		set_sales_orders_commission_generated(sales_orders, value)

	def _cancel_linked_additional_salaries(self):
		if not frappe.db.exists("DocType", "Additional Salary"):
			return
		for row in self.doctors or []:
			if not row.additional_salary:
				continue
			if not frappe.db.exists("Additional Salary", row.additional_salary):
				continue
			ads = frappe.get_doc("Additional Salary", row.additional_salary)
			if ads.docstatus == 1:
				ads.flags.ignore_permissions = True
				ads.cancel()
			row.additional_salary = None

	def _recalc_totals(self):
		total_service = 0
		total_commission = 0
		total_cases = 0
		for row in self.doctors or []:
			total_service += flt(row.service_amount)
			total_cases += int(row.cases_count or 0)
			total_commission += flt(
				row.adjusted_commission
				if row.adjusted_commission not in (None, "")
				else row.calculated_commission
			)
		self.total_service_amount = total_service
		self.total_cases = total_cases
		self.total_commission = total_commission

	@frappe.whitelist()
	def fetch_doctors(self):
		"""Load eligible practitioners (Receive Commission) into the Doctors table."""
		from healthcare.api.doctor_commission import fetch_doctors_for_period

		if self.docstatus != 0:
			frappe.throw(_("Only draft documents can fetch doctors"))
		if self.status == "Approved":
			frappe.throw(_("Approved documents cannot be changed"))

		self.flags.ignore_permissions = True
		return fetch_doctors_for_period(self)

	@frappe.whitelist()
	def generate_commission(self, include_backdated=0):
		"""Populate doctors and service lines for this payroll period."""
		from healthcare.api.doctor_commission import generate_doctor_commission_period

		if self.docstatus != 0:
			frappe.throw(_("Only draft documents can be generated"))
		if self.status == "Approved":
			frappe.throw(_("Approved documents cannot be regenerated"))

		self.flags.ignore_permissions = True
		return generate_doctor_commission_period(self, include_backdated=cint(include_backdated))

	@frappe.whitelist()
	def create_additional_salary(self):
		"""Create HRMS Additional Salary entries for each doctor after submit."""
		from healthcare.api.doctor_commission import create_additional_salaries_for_payroll

		if self.docstatus != 1:
			frappe.throw(_("Submit the document before creating Additional Salary"))

		self.flags.ignore_permissions = True
		return create_additional_salaries_for_payroll(self)
