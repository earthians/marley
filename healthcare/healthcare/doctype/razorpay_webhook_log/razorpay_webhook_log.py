# Copyright (c) 2025, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class RazorpayWebhookLog(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		event: DF.Data | None
		payload: DF.Code | None
		payment_id: DF.Data | None
	# end: auto-generated types

	def after_insert(self):
		payment_record = frappe.get_doc("Razorpay Payment Record", {"order_id": self.order_id})

		if self.event in ("order.paid", "payment.captured") and payment_record.status != "Captured":
			payment_record.update({"payment_id": self.payment_id, "status": "Captured"})
			payment_record.save(ignore_permissions=True)
