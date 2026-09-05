# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
import os

import frappe


def create_medication_classes():
	"""Seed a standard medication class tree. Classes already on the site are left in place."""
	for node in read_seed():
		create_class(node)

	create_ingredient_classes()


def read_seed():
	return read_seed_file("medication_class_seed.json")


def read_ingredients():
	return read_seed_file("medication_class_ingredients.json")


def read_seed_file(filename):
	with open(os.path.join(os.path.dirname(__file__), filename)) as seed:
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


def create_ingredient_classes():
	"""Ingredient-level leaves under the chemical subgroups, so an allergy or an interaction
	can name a single substance rather than a whole class"""
	for medication_class, ingredients in read_ingredients().items():
		add_ingredients(medication_class, ingredients)


def add_ingredients(medication_class, ingredients):
	if not frappe.db.exists("Medication Class", medication_class):
		return

	frappe.db.set_value("Medication Class", medication_class, "is_group", 1)

	for ingredient in ingredients:
		ensure_class(ingredient, False, medication_class)


def get_seeded_class_names():
	"""Every class name the seed installs, groups and ingredient leaves alike"""
	names = set()
	collect_class_names(read_seed(), names)

	for ingredients in read_ingredients().values():
		names.update(ingredients)

	return names


def collect_class_names(nodes, names):
	for node in nodes:
		names.add(node["medication_class"])
		collect_class_names(node.get("children") or [], names)


def classify_by_generic_name():
	"""Point each medication at the ingredient class matching its generic name.

	The seeded taxonomy does nothing until medications are actually classed into it, and a
	site that has been prescribing for years will have its own ad-hoc classes. This bridges
	the obvious cases; anything without a matching class is left alone for a human to place.

	Changes existing data, so it is never run by installation or a patch:

		bench --site <site> execute healthcare.healthcare.doctype.medication_class.medication_class_seed.classify_by_generic_name
	"""
	reclassified = 0

	for medication in frappe.get_all("Medication", fields=["name", "generic_name", "medication_class"]):
		if not matches_a_class(medication):
			continue
		frappe.db.set_value("Medication", medication.name, "medication_class", medication.generic_name)
		reclassified += 1

	return reclassified


def matches_a_class(medication):
	return medication.generic_name != medication.medication_class and frappe.db.exists(
		"Medication Class", medication.generic_name
	)
