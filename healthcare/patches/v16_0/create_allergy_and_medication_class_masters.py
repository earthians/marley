# Copyright (c) 2026, earthians Health Informatics Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from healthcare.healthcare.doctype.allergy.allergy_seed import create_allergies
from healthcare.healthcare.doctype.medication_class.medication_class_seed import (
	create_medication_classes,
)


def execute():
	frappe.reload_doc("healthcare", "doctype", "medication_class")
	frappe.reload_doc("healthcare", "doctype", "allergy")
	create_medication_classes()
	create_allergies()
