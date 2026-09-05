# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils.nestedset import NestedSet

ANCESTOR_CACHE_KEY = "medication_class_ancestors"


class MedicationClass(NestedSet):
	def validate(self):
		self.validate_parent_is_group()
		self.validate_group_has_no_children()

	def on_update(self):
		super().on_update()
		clear_ancestor_cache()

	def on_trash(self):
		super().on_trash()
		clear_ancestor_cache()

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


def get_ancestor_map():
	"""Every class mapped to its ancestors. The tree is small and changes rarely, so it is
	held in the cache rather than walked with a query per lookup"""
	return frappe.cache().get_value(ANCESTOR_CACHE_KEY, build_ancestor_map)


def build_ancestor_map():
	rows = frappe.get_all("Medication Class", fields=["name", "parent_medication_class"])
	parents = {row.name: row.parent_medication_class for row in rows}

	return {name: walk_up(name, parents) for name in parents}


def walk_up(name, parents):
	ancestors, seen = [], {name}
	parent = parents.get(name)

	while parent and parent not in seen:
		ancestors.append(parent)
		seen.add(parent)
		parent = parents.get(parent)

	return ancestors


def clear_ancestor_cache():
	frappe.cache().delete_value(ANCESTOR_CACHE_KEY)
