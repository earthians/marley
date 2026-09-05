# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import get_link_to_form


class PatientAllergy(Document):
	def validate(self):
		self.validate_duplicate()

	def validate_duplicate(self):
		duplicate = frappe.db.exists(
			"Patient Allergy",
			{
				"patient": self.patient,
				"allergy": self.allergy,
				"status": "Active",
				"name": ("!=", self.name),
			},
		)

		if duplicate:
			frappe.throw(
				_("{0} is already recorded as an active allergy for this patient in {1}").format(
					frappe.bold(self.allergy), get_link_to_form("Patient Allergy", duplicate)
				),
				title=_("Duplicate Allergy"),
			)
