# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
import os

import frappe


def create_allergies():
	"""Seed a standard allergen list. Allergens already on the site are left in place."""
	for record in read_seed():
		create_allergy(record)


def read_seed():
	with open(os.path.join(os.path.dirname(__file__), "allergy_seed.json")) as seed:
		return json.load(seed)


def create_allergy(record):
	substance = record.get("substance")

	if frappe.db.exists("Allergy", record["allergy_name"]):
		return

	if substance and not frappe.db.exists("Medication Class", substance):
		return

	frappe.get_doc(
		{
			"doctype": "Allergy",
			"allergy_name": record["allergy_name"],
			"category": record["category"],
			"substance_type": "Medication Class" if substance else None,
			"substance": substance,
		}
	).insert(ignore_permissions=True)
