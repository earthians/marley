import frappe
from frappe.utils import flt

from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice


class HealthcareSalesInvoice(SalesInvoice):
	def validate(self):
		super(SalesInvoice, self).validate()
		domain_settings = frappe.get_doc("Domain Settings")
		active_domains = [d.domain for d in domain_settings.active_domains]

		if "Healthcare" in active_domains:
			self.calculate_healthcare_insurance_claim()

	@frappe.whitelist()
	def set_healthcare_services(self, checked_values):
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
			if checked_item["insurance_claim_coverage"]:
				item_line.insurance_claim_coverage = checked_item["insurance_claim_coverage"]
			if checked_item["insurance_claim"]:
				item_line.insurance_claim = checked_item["insurance_claim"]

			if item_line.discount_percentage:
				item_line.discount_amount = flt(item_line.rate) * flt(item_line.discount_percentage) * 0.01
				item_line.rate = flt(item_line.rate) - flt(item_line.discount_amount)

			item_line.amount = flt(item_line.rate) * flt(item_line.qty)

			if item_line.insurance_claim_coverage:
				item_line.insurance_claim_amount = (
					flt(item_line.amount) * 0.01 * flt(item_line.insurance_claim_coverage)
				)

		self.calculate_healthcare_insurance_claim()
		self.set_missing_values(for_validate=True)

	def calculate_healthcare_insurance_claim(self):
		total_claim_amount = 0.0

		for item in self.items:
			if item.amount and item.insurance_claim_coverage:
				item.insurance_claim_amount = item.amount * 0.01 * flt(item.insurance_claim_coverage)

			if item.insurance_claim_amount and flt(item.insurance_claim_amount) > 0:
				total_claim_amount += flt(item.insurance_claim_amount)

		self.total_insurance_claim_amount = total_claim_amount
		if self.total_insurance_claim_amount and self.outstanding_amount:
			self.patient_payable_amount = self.outstanding_amount - self.total_insurance_claim_amount
