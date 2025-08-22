# Copyright (c) 2025, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import contextlib
import json
from datetime import datetime, timedelta

import frappe
from frappe.model.document import Document
from frappe.utils import flt, getdate

from healthcare.healthcare.doctype.healthcare_settings.healthcare_settings import (
	get_razorpay_client,
	get_receivable_account,
)
from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
	get_appointment_item,
)


class RazorpayPaymentRecord(Document):
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
		client = get_razorpay_client()
		payment = client.payment.fetch(self.payment_id)
		amount = float(payment["amount"] / 100)
		appointment = payment["notes"].get("appointment", "")
		if not appointment:
			return

		appointment_doc = frappe.get_doc("Patient Appointment", appointment)

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
		paid_amount = flt(amount)

		# Add payments if payment details are supplied else proceed to create invoice as Unpaid
		sales_invoice.is_pos = 1
		payment = sales_invoice.append("payments", {})
		payment.mode_of_payment = "RazorPay"
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
				"mode_of_payment": "Razorpay",
				"billing_item": item.item_code,
			},
		)

		appointment_doc.notify_update()

	@frappe.whitelist()
	def sync(self):
		try:
			client = get_razorpay_client()
			response = client.order.payments(self.order_id)

			for item in response.get("items"):
				if item["status"] == "captured":
					frappe.get_doc(
						{
							"doctype": "Razorpay Webhook Log",
							"payload": frappe.as_json(item),
							"event": "order.paid",
							"payment_id": item["id"],
							"order_id": item["order_id"],
						}
					).insert(ignore_if_duplicate=True)
		except Exception:
			log_error(title="Failed to sync Razorpay Payment Record", order_id=self.order_id)


def fetch_pending_payment_orders(hours=12):
	past_12hrs_ago = datetime.now() - timedelta(hours=hours)
	pending_orders = frappe.get_all(
		"Razorpay Payment Record",
		dict(status="Pending", creation=(">=", past_12hrs_ago)),
		pluck="order_id",
	)

	client = get_razorpay_client()
	if not pending_orders:
		return

	for order_id in pending_orders:
		try:
			response = client.order.payments(order_id)
			for item in response.get("items"):
				if item["status"] == "captured":
					frappe.get_doc(
						{
							"doctype": "Razorpay Webhook Log",
							"payload": frappe.as_json(item),
							"event": "order.paid",
							"payment_id": item["id"],
							"name": item["order_id"],
						}
					).insert(ignore_if_duplicate=True)
		except Exception:
			log_error(title="Failed to capture pending order", order_id=order_id)

	"""
	Sample Response
	ref: https://razorpay.com/docs/api/orders/#fetch-payments-for-an-order

	{
		"entity": "collection",
		"count": 1,
		"items": [
			{
				"id": "pay_JhOBNkFZFi0EOX",
				"entity": "payment",
				"amount": 100,
				"currency": "INR",
				"status": "captured",
				"order_id": "order_DaaS6LOUAASb7Y",
				"invoice_id": null,
				"international": false,
				"method": "card",
				"amount_refunded": 0,
				"refund_status": null,
				"captured": true,
				"description": "",
				"card_id": "card_Be7AhhLtm1gxzc",
				"bank": null,
				"wallet": null,
				"vpa": null,
				"email": "gaurav.kumar@example.com",
				"contact": "+919900000000",
				"customer_id": "cust_Be6N4O63pXzmqK",
				"token_id": "token_BhNxzjrZvkqLWr",
				"notes": [],
				"fee": 0,
				"tax": 0,
				"error_code": null,
				"error_description": null,
				"error_source": null,
				"error_step": null,
				"error_reason": null,
				"acquirer_data": {
					"auth_code": null
				},
				"created_at": 1655212834
			}
		]
	}
	"""


def log_error(title, **kwargs):
	if frappe.flags.in_test:
		try:
			raise
		except RuntimeError as e:
			if e.args[0] == "No active exception to reraise":
				pass
			else:
				raise

	reference_doctype = kwargs.get("reference_doctype")
	reference_name = kwargs.get("reference_name")

	# Prevent double logging as `message`
	if reference_doctype and reference_name:
		del kwargs["reference_doctype"]
		del kwargs["reference_name"]

	if doc := kwargs.get("doc"):
		reference_doctype = doc.doctype
		reference_name = doc.name
		del kwargs["doc"]

	with contextlib.suppress(Exception):
		kwargs["user"] = frappe.session.user

	message = ""
	if serialized := json.dumps(
		kwargs,
		indent=4,
		sort_keys=True,
		default=str,
		skipkeys=True,
	):
		message += f"Data:\n{serialized}\n"

	if traceback := frappe.get_traceback(with_context=True):
		message += f"Exception:\n{traceback}\n"

	with contextlib.suppress(Exception):
		frappe.log_error(
			title=title,
			message=message,
			reference_doctype=reference_doctype,
			reference_name=reference_name,
		)


@frappe.whitelist()
def handle_razorpay_payment_failed(response):
	payment_record = frappe.get_doc(
		"Razorpay Payment Record",
		{"order_id": response["error"]["metadata"].get("order_id")},
		for_update=True,
	)

	payment_record.status = "Failed"
	payment_record.failure_reason = response["error"]["description"]
	payment_record.save(ignore_permissions=True)


@frappe.whitelist()
def handle_razorpay_payment_success(response):
	if isinstance(response, str):
		response = json.loads(response)
	payment_record = frappe.get_doc(
		"Razorpay Payment Record",
		{"order_id": response.get("razorpay_order_id")},
		for_update=True,
	)

	payment_record.status = "Captured"
	payment_record.payment_id = response.get("razorpay_payment_id")
	payment_record.signature = response.get("razorpay_signature")
	payment_record.save(ignore_permissions=True)
