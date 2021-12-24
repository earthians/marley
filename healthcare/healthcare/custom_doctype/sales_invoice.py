import frappe
from frappe.utils import flt

from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice


class HealthcareSalesInvoice(SalesInvoice):
	def validate(self):
		self.calculate_patient_insurance_coverage()
		super(HealthcareSalesInvoice, self).validate()

	@frappe.whitelist()
	def set_healthcare_services(self, checked_values):

		self.set("items", [])
		from erpnext.stock.get_item_details import get_item_details

		for checked_item in checked_values:
			item_line = self.append("items", {})
			price_list, price_list_currency = frappe.db.get_values(
				"Price List", {"selling": 1}, ["name", "currency"]
			)[0]
			args = {
				"doctype": "Sales Invoice",
				"item_code": checked_item["item"],
				"company": self.company,
				"customer": frappe.db.get_value("Patient", self.patient, "customer"),
				"selling_price_list": price_list,
				"price_list_currency": price_list_currency,
				"plc_conversion_rate": 1.0,
				"conversion_rate": 1.0,
			}
			item_details = get_item_details(args)
			item_line.item_code = checked_item["item"]
			item_line.qty = 1

			if checked_item["qty"]:
				item_line.qty = checked_item["qty"]

			if checked_item["rate"]:
				item_line.rate = checked_item["rate"]
			else:
				item_line.rate = item_details.price_list_rate

			if checked_item["income_account"]:
				item_line.income_account = checked_item["income_account"]

			if checked_item["dt"]:
				item_line.reference_dt = checked_item["dt"]

			if checked_item["dn"]:
				item_line.reference_dn = checked_item["dn"]

			if checked_item["description"]:
				item_line.description = checked_item["description"]

			if checked_item["discount_percentage"]:
				item_line.discount_percentage = checked_item["discount_percentage"]

			if checked_item["insurance_coverage"]:
				item_line.insurance_coverage = checked_item["insurance_coverage"]

			if checked_item["patient_insurance_policy"]:
				item_line.patient_insurance_policy = checked_item["patient_insurance_policy"]

			if checked_item["coverage_percentage"]:
				item_line.coverage_percentage = checked_item["coverage_percentage"]

			if checked_item["insurance_payor"]:
				item_line.insurance_payor = checked_item["insurance_payor"]

			if checked_item["coverage_rate"]:
				item_line.coverage_rate = checked_item["coverage_rate"]

			if checked_item["coverage_qty"]:
				item_line.coverage_qty = checked_item["coverage_qty"]

			if item_line.discount_percentage:
				item_line.discount_amount = flt(item_line.rate) * flt(item_line.discount_percentage) * 0.01
				item_line.rate = flt(item_line.rate) - flt(item_line.discount_amount)

			item_line.amount = flt(item_line.rate) * flt(item_line.qty)

			if item_line.insurance_coverage:
				item_line.insurance_coverage_amount = (
					flt(item_line.amount) * 0.01 * flt(item_line.coverage_percentage)
				)

		self.calculate_patient_insurance_coverage()
		self.set_missing_values(for_validate=True)

	def calculate_patient_insurance_coverage(self):
		total_coverage_amount = 0.0

		for item in self.items:
			if item.amount and item.insurance_coverage:
				item.insurance_coverage_amount = item.amount * 0.01 * flt(item.coverage_percentage)

			if item.insurance_coverage_amount and flt(item.insurance_coverage_amount) > 0:
				total_coverage_amount += flt(item.insurance_coverage_amount)

		self.total_insurance_coverage_amount = total_coverage_amount
		if self.total_insurance_coverage_amount:
			self.patient_payable_amount = self.outstanding_amount - self.total_insurance_coverage_amount
		else:
			self.patient_payable_amount = self.outstanding_amount
