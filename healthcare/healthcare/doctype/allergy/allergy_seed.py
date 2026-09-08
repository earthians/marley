# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import get_file_json

SEED_FILE = ("healthcare", "healthcare", "doctype", "allergy", "allergy_seed.json")


def create_allergies():
	"""Seed a standard allergen list. Allergens already on the site are left in place."""
	for record in read_seed():
		create_allergy(record)


def read_seed():
	return get_file_json(frappe.get_app_path(*SEED_FILE))


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
