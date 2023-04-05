# Copyright (c) 2023, healthcare and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from erpnext.stock.get_item_details import get_item_price
from healthcare.healthcare.doctype.inpatient_record.inpatient_record import (
	create_inpatient_record,
)


class TreatmentPlanConsent(Document):
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
				"Treatment Plan Consent",
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
					_("Active Treatment Plan Consent {0} already exist for encounter {1}").format(
						frappe.bold(
							frappe.utils.get_link_to_form("Treatment Plan Consent", active_tpc)
						),
						frappe.bold(
							frappe.utils.get_link_to_form(
								"Patient Encounter", self.admission_encounter
							)
						),
					)
				)
		set_item_amount(self)


	def after_insert(self):
		if self.admission_encounter:  # Update encounter
			frappe.db.set_value(
				"Patient Encounter",
				self.admission_encounter,
				"inpatient_status",
				"Treatment Plan Consent Created",
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


def set_item_amount(self):
	if (
		self.treatment_plan_template
		and self.treatment_plan_template
		and not self.treatment_plan_template_items
	):
		template_doc = frappe.get_doc(
			"Treatment Plan Template", self.treatment_plan_template
		)
		total_price = 0
		for item in template_doc.items:
			args = {"price_list": self.price_list}
			item_details = get_item_price(args, item.template)
			if item_details:
				item_price = [
					element for tupl in item_details for element in tupl
				][1]
				total_price += item_price
				item.amount = item_price
			self.append(
				"treatment_plan_template_items", (frappe.copy_doc(item)).as_dict()
			)
		self.amount = total_price

@frappe.whitelist()
def create_ip_from_treatment_plan_consent(admission_order, treatment_plan_consent):
	ip_name = create_inpatient_record(admission_order)
	frappe.db.set_value(
		"Treatment Plan Consent", treatment_plan_consent, {"status": "Completed", "inpatient_record": ip_name}
	)
