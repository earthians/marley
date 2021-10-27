import frappe
from frappe import DuplicateEntryError


def create_encounter(patient, medical_department, practitioner):
	encounter = frappe.new_doc('Patient Encounter')
	encounter.patient = patient
	encounter.practitioner = practitioner
	encounter.medical_department = medical_department
	encounter.save()
	encounter.submit()
	return encounter
