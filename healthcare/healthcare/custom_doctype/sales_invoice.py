import frappe

from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice


class HealthcareSalesInvoice(SalesInvoice):
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
			item_line.amount = float(item_line.rate) * float(item_line.qty)
			if checked_item["income_account"]:
				item_line.income_account = checked_item["income_account"]
			if checked_item["dt"]:
				item_line.reference_dt = checked_item["dt"]
			if checked_item["dn"]:
				item_line.reference_dn = checked_item["dn"]
			if checked_item["description"]:
				item_line.description = checked_item["description"]

		self.set_missing_values(for_validate=True)
