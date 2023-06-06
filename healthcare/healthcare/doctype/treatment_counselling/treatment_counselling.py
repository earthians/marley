# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from erpnext.stock.get_item_details import get_item_price
from healthcare.healthcare.doctype.inpatient_record.inpatient_record import (
	create_inpatient_record,
)


class TreatmentCounselling(Document):
	def before_insert(self):
		if self.customer:
			self.price_list = frappe.db.get_value(
				"Customer", self.customer, "default_price_list"
			)

		if not self.price_list:
			self.price_list = frappe.db.get_single_value(
				"Selling Settings", "selling_price_list"
			)

	def validate(self):
		if self.status == "Active":
			active_tpc = frappe.db.exists(
				"Treatment Counselling",
				{
					"status": "Active",
					"docstatus": 1,
					"inpatient_record": self.inpatient_record,
					"admission_encounter": self.admission_encounter,
					"name": ["!=", self.name],
				},
			)

			if active_tpc:
				frappe.throw(
					_("Active Treatment Counselling {0} already exist for encounter {1}").format(
						frappe.bold(
							frappe.utils.get_link_to_form("Treatment Counselling", active_tpc)
						),
						frappe.bold(
							frappe.utils.get_link_to_form(
								"Patient Encounter", self.admission_encounter
							)
						),
					)
				)
		set_treatment_plan_template_items(self)
		set_total_amount(self)

		if self.paid_amount:
			self.outstanding_amount = self.amount - self.paid_amount
		else:
			self.outstanding_amount = self.amount


	def after_insert(self):
		if self.admission_encounter:  # Update encounter
			frappe.db.set_value(
				"Patient Encounter",
				self.admission_encounter,
				"inpatient_status",
				"Treatment Counselling Created",
			)

	def on_update_after_submit(self):
		doc_before_save = self.get_doc_before_save()
		if (
			self.status == "Closed"
			and doc_before_save.status != "Closed"
			and self.admission_encounter
		):
			frappe.db.set_value(
				"Patient Encounter", self.admission_encounter, "inpatient_status", ""
			)

		if self.paid_amount:
			self.outstanding_amount = self.amount - self.paid_amount
		else:
			self.outstanding_amount = self.amount


def set_treatment_plan_template_items(doc):
	if (
		doc.treatment_plan_template
		and doc.treatment_plan_template
		and not doc.treatment_plan_template_items
	):
		template_doc = frappe.get_doc(
			"Treatment Plan Template", doc.treatment_plan_template
		)

		for item in template_doc.items:
			args = {"price_list": doc.price_list}
			item_details = get_item_price(args, item.template)
			if item_details:
				item_price = [
					element for tupl in item_details for element in tupl
				][1]
				item.amount = item_price
			doc.append(
				"treatment_plan_template_items", (frappe.copy_doc(item)).as_dict()
			)

		if doc.admission_service_unit_type:
			su_item, su_rate = frappe.db.get_value("Healthcare Service Unit Type", doc.admission_service_unit_type, ["item", "rate"])
			if su_item and su_rate:
				doc.append("treatment_plan_template_items", {"type":"Item", "template": su_item, "qty": doc.expected_length_of_stay, "amount": su_rate})


def set_total_amount(doc):
	total_price = 0
	for item in doc.treatment_plan_template_items:
		total_price += item.amount

	doc.amount = total_price


@frappe.whitelist()
def create_ip_from_treatment_counselling(admission_order, treatment_counselling):
	ip_name = create_inpatient_record(admission_order)
	frappe.db.set_value(
		"Treatment Counselling", treatment_counselling, {"status": "Completed", "inpatient_record": ip_name}
	)


@frappe.whitelist()
def create_payment_entry(treatment_counselling):
	payment_entry = frappe.db.exists("Payment Entry", {"treatment_counselling": treatment_counselling, "docstatus": ["!=", 2]})
	if payment_entry:
		return payment_entry
	treatment_counselling_doc = frappe.get_doc("Treatment Counselling", treatment_counselling)
	payment_entry_doc = frappe.new_doc("Payment Entry")
	payment_entry_doc.update({
		"payment_type": "Receive",
		"party_type":"Customer",
		"party" : treatment_counselling_doc.customer,
		"treatment_counselling" : treatment_counselling,
		"paid_amount": treatment_counselling_doc.outstanding_amount,
		"received_amount": treatment_counselling_doc.outstanding_amount,
		"target_exchange_rate": 1,
	})

	payment_entry_doc.insert(ignore_mandatory = True)
	return payment_entry_doc.name