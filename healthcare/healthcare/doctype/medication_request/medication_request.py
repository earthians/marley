# Copyright (c) 2022, healthcare and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import frappe
from frappe import _

from healthcare.controllers.service_request_controller import ServiceRequestController


class MedicationRequest(ServiceRequestController):
	def on_update_after_submit(self):
		self.validate_invoiced_qty()

	def set_title(self):
		if frappe.flags.in_import and self.title:
			return
		self.title = f"{self.patient_name} - {self.medication}"

	def before_insert(self):
		self.calculate_total_dispensable_quantity()
		self.status = "Draft"

		if self.amended_from:
			frappe.db.set_value("Medication Request", self.amended_from, "status", "Replaced")

	def set_order_details(self):
		if not self.medication:
			frappe.throw(
				_("Medication is mandatory to create Medication Request"), title=_("Missing Mandatory Fields")
			)

		medication = frappe.get_doc("Medication", self.medication)
		# set item code
		self.item_code = medication.get("item")

		if not self.staff_role and medication.get("staff_role"):
			self.staff_role = medication.staff_role

		if not self.intent:
			self.intent = frappe.db.get_single_value("Healthcare Settings", "default_intent")

		if not self.priority:
			self.priority = frappe.db.get_single_value("Healthcare Settings", "default_priority")

	def calculate_total_dispensable_quantity(self):
		if self.number_of_repeats_allowed:
			self.total_dispensable_quantity = self.quantity + (
				self.number_of_repeats_allowed * self.quantity
			)
		else:
			self.total_dispensable_quantity = self.quantity

	def update_invoice_details(self, qty):
		"""
		updates qty_invoiced and set  billing status
		"""
		qty_invoiced = self.qty_invoiced + qty

		if qty_invoiced == 0:
			status = "Pending"
		if self.number_of_repeats_allowed and self.total_dispensable_quantity:
			if qty_invoiced < self.total_dispensable_quantity:
				status = "Partly Invoiced"
			else:
				status = "Invoiced"
		else:
			if qty_invoiced < self.quantity:
				status = "Partly Invoiced"
			else:
				status = "Invoiced"

		medication_request_doc = frappe.get_doc("Medication Request", self.name)
		medication_request_doc.qty_invoiced = qty_invoiced
		medication_request_doc.billing_status = status
		medication_request_doc.save(ignore_permissions=True)

	def validate_invoiced_qty(self):
		if self.qty_invoiced > self.total_dispensable_quantity:
			frappe.throw(
				_("Maximum billable quantity exceeded by {0}").format(
					frappe.bold(self.qty_invoiced - self.total_dispensable_quantity)
				),
				title=_("Maximum Quantity Exceeded"),
			)


@frappe.whitelist()
def set_medication_request_status(medication_request, status):
	frappe.db.set_value("Medication Request", medication_request, "status", status)
