# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils.nestedset import NestedSet


class MedicationClass(NestedSet):
	def validate(self):
		self.validate_parent_is_group()
		self.validate_group_has_no_children()

	def validate_parent_is_group(self):
		if not self.parent_medication_class:
			return

		if not frappe.db.get_value("Medication Class", self.parent_medication_class, "is_group"):
			frappe.throw(
				_("{0} cannot be a parent because it is not a group").format(
					frappe.bold(self.parent_medication_class)
				)
			)

	def validate_group_has_no_children(self):
		if self.is_group or self.is_new():
			return

		if frappe.db.exists("Medication Class", {"parent_medication_class": self.name}):
			frappe.throw(
				_("{0} has narrower classes under it and must stay a group").format(frappe.bold(self.name))
			)
