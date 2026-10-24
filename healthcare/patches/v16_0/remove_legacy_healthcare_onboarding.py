# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

LEGACY_STEPS = (
	"Explore Clinical Procedure Templates",
	"Explore Healthcare Settings",
	"Introduction to Healthcare Practitioner",
)


def execute():
	frappe.delete_doc("Module Onboarding", "Healthcare", ignore_missing=True, force=True)
	for step in LEGACY_STEPS:
		frappe.delete_doc("Onboarding Step", step, ignore_missing=True, force=True)
