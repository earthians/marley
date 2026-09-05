import frappe


def create_encounter(patient, practitioner, submit=False, **kwargs):
	encounter = frappe.new_doc("Patient Encounter")
	encounter.patient = patient
	encounter.practitioner = practitioner
	encounter.company = "_Test Company"
	encounter.appointment_type = "_Test Appointment Type"
	encounter.update(kwargs)
	encounter.save()
	if submit:
		encounter.submit()
	return encounter


# TODO: move other test utility functions here
