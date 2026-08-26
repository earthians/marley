# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _


class WardStore:
	"""Where a patient's ward stock is drawn from."""

	def __init__(self, inpatient_record):
		self.admission = frappe.get_doc("Inpatient Record", inpatient_record)

	def warehouse(self):
		"""The warehouse of the bed the patient occupies, and nothing else.

		Medication issued from anywhere else could not be traced back to the bed
		it was transferred to. Callers that can live with a looser answer, such
		as consumables, fall back to the company warehouse themselves.
		"""
		service_unit = self.service_unit()
		return bed_warehouse(service_unit) if service_unit else None

	def service_unit(self):
		"""The bed the patient is in now, rather than one they have left."""
		occupancy = [row for row in self.admission.inpatient_occupancies if not row.left]
		return occupancy[-1].service_unit if occupancy else None

	def company_warehouse(self):
		return frappe.db.get_value("Company", self.admission.company, "default_warehouse")


def bed_warehouse(service_unit):
	return frappe.db.get_value("Healthcare Service Unit", service_unit, "warehouse")


def set_batch(row, batch_no):
	"""ERPNext reads batch_no only when the row opts out of batch bundles.
	Where a site uses bundles instead, say so rather than quietly dropping
	the batch that was picked."""
	if not frappe.db.get_single_value("Stock Settings", "use_serial_batch_fields"):
		frappe.throw(
			_("Enable {0} in Stock Settings to record a batch").format(
				frappe.bold(_("Use Serial / Batch fields"))
			)
		)

	row.use_serial_batch_fields = 1
	row.batch_no = batch_no
