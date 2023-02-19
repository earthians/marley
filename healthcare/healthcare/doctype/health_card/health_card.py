# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
import json
from frappe import _
from frappe.model.document import Document
from frappe.utils import (nowdate, getdate, add_months, add_days)
from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import get_receivable_account
from frappe.utils.nestedset import get_root_of

class HealthCard(Document):
	pass

@frappe.whitelist()
def generate_healthcards(health_card_type, no_of_cards):
	for i in range(int(no_of_cards)):
		frappe.get_doc({
			'doctype': 'Health Card',
			'health_card_type': health_card_type,
		}).insert()
	return

@frappe.whitelist()
def set_expired_status():
	expired_cards_list = frappe.db.get_list('Health Card', 
		filters = {
		'status': 'Active',
		'to_date': ['<', nowdate()]
		}, 
		fields = ['name', 'patient']
	)

	for card in expired_cards_list:
		health_card = frappe.get_doc("Health Card", card.name)
		health_card.status = 'Expired'
		health_card.save(ignore_permissions=True)
		health_card.reload()

		customer_group = frappe.db.get_single_value("Selling Settings", "customer_group") or get_root_of("Customer Group")
		patient_doc = frappe.get_doc("Patient", card.patient)
		patient_doc.customer_group = customer_group
		patient_doc.save(ignore_permissions=True)
		patient_doc.reload()
	return

@frappe.whitelist()
def activate_renew_health_card(args):
	card_info = json.loads(args)

	health_card = frappe.get_doc("Health Card", card_info['health_card'])
	from_date = card_info['from_date']
	validity_map = {'Monthly': 1, 'Quarterly': 3, 'Half-Yearly': 6,	'Yearly': 12}
	to_date = add_months(from_date,	validity_map[health_card.validity])

	health_card.status = 'Active'
	health_card.from_date = from_date
	health_card.to_date = add_days(to_date, -1)
	if card_info['renewal']:
		health_card.invoiced = 0
	health_card.save(ignore_permissions=True)

	customer_group = frappe.db.get_value("Health Card Type", health_card.health_card_type, "customer_group")
	patient_doc = frappe.get_doc("Patient", health_card.patient)
	patient_doc.customer_group = customer_group
	patient_doc.save(ignore_permissions=True)
	patient_doc.reload()

@frappe.whitelist()
def invoice_health_card(args):
	payment_info = json.loads(args)

	patient = frappe.get_doc(
		'Patient', payment_info['patient'])
	healthcard_type = frappe.get_doc(
		'Health Card Type', payment_info['health_card_type'])

	sales_invoice = frappe.new_doc('Sales Invoice')
	sales_invoice.patient = patient.name
	sales_invoice.customer = patient.customer
	sales_invoice.due_date = getdate()
	sales_invoice.company = frappe.db.get_value("Global Defaults", None, "default_company")
	sales_invoice.debit_to = get_receivable_account(sales_invoice.company)
	
	item = sales_invoice.append('items', {})
	item.item_code = healthcard_type.item_code
	item.cost_center = frappe.get_cached_value('Company', sales_invoice.company, 'cost_center')
	item.rate = healthcard_type.rate
	item.amount = healthcard_type.rate
	item.qty = 1
	item.reference_dt = 'Health Card'
	item.reference_dn = payment_info['health_card']

	sales_invoice.is_pos = 1
	payment = sales_invoice.append('payments', {})
	payment.mode_of_payment = payment_info['mode_of_payment']
	payment.amount = payment_info['paid_amount']

	sales_invoice.set_missing_values(for_validate=True)
	sales_invoice.flags.ignore_mandatory = True
	sales_invoice.save(ignore_permissions=True)
	sales_invoice.submit()

	frappe.msgprint(_('Sales Invoice {0} created'.format(
		sales_invoice.name)), alert=True)
