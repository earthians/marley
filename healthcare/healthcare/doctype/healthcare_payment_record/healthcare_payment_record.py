# Copyright (c) 2025, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt, getdate

from healthcare.healthcare.api.patient_portal import update_payment_record
from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import (
	get_receivable_account,
)
from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
	get_appointment_item,
)


class HealthcarePaymentRecord(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		failure_reason: DF.SmallText | None
		order_id: DF.Data | None
		payment_id: DF.Data | None
		signature: DF.Data | None
		status: DF.Literal["Captured", "Failed", "Pending"]
		user: DF.Link | None
	# end: auto-generated types

	def on_update(self):
		if self.has_value_changed("status") and self.status == "Captured":
			self.process_sales_invoice()

	def process_sales_invoice(self):
		appointment_doc = frappe.get_doc("Patient Appointment", self.payment_for_document)

		sales_invoice = frappe.new_doc("Sales Invoice")
		sales_invoice.patient = appointment_doc.patient
		sales_invoice.customer = frappe.get_value("Patient", appointment_doc.patient, "customer")
		sales_invoice.appointment = appointment_doc.name
		sales_invoice.due_date = getdate()
		sales_invoice.company = appointment_doc.company
		sales_invoice.debit_to = get_receivable_account(appointment_doc.company)
		sales_invoice.allocate_advances_automatically = 0

		item = sales_invoice.append("items", {})
		item = get_appointment_item(appointment_doc, item)
		paid_amount = flt(self.amount)

		# Add payments if payment details are supplied else proceed to create invoice as Unpaid
		sales_invoice.is_pos = 1
		mode_of_payment = frappe.get_single_value("Healthcare Settings", "mode_of_payment")
		payment = sales_invoice.append("payments", {})
		payment.mode_of_payment = mode_of_payment
		payment.amount = paid_amount
		payment.reference_no = self.payment_id
		payment.reference_date = getdate(self.creation)

		sales_invoice.set_missing_values(for_validate=True)
		sales_invoice.flags.ignore_mandatory = True
		sales_invoice.save(ignore_permissions=True)
		sales_invoice.submit()

		frappe.db.set_value(
			"Patient Appointment",
			appointment_doc.name,
			{
				"invoiced": 1,
				"ref_sales_invoice": sales_invoice.name,
				"paid_amount": paid_amount,
				"mode_of_payment": mode_of_payment,
				"billing_item": item.item_code,
			},
		)

		appointment_doc.notify_update()

	@frappe.whitelist()
	def sync(self):
		try:
			update_payment_record(self.payment_for_doctype, self.payment_for_document)
		except Exception:
			frappe.log_error(
				title="Failed to sync Payment Record",
				message=f"Exception:\n{frappe.get_traceback(with_context=True)}\n",
				reference_doctype=self.doctype,
				reference_name=self.name,
			)
