# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
import os

import frappe


def create_medication_classes():
	"""Seed a standard medication class tree. Classes already on the site are left in place."""
	for node in read_seed():
		create_class(node)


def read_seed():
	with open(os.path.join(os.path.dirname(__file__), "medication_class_seed.json")) as seed:
		return json.load(seed)


def create_class(node, parent=None):
	children = node.get("children") or []
	medication_class = ensure_class(node["medication_class"], bool(children), parent)

	for child in children:
		create_class(child, parent=medication_class)


def ensure_class(medication_class, is_group, parent):
	if frappe.db.exists("Medication Class", medication_class):
		if is_group:
			frappe.db.set_value("Medication Class", medication_class, "is_group", 1)
		return medication_class

	return (
		frappe.get_doc(
			{
				"doctype": "Medication Class",
				"medication_class": medication_class,
				"is_group": is_group,
				"parent_medication_class": parent,
			}
		)
		.insert(ignore_permissions=True)
		.name
	)
