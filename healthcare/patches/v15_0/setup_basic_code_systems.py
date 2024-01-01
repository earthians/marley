from healthcare.setup import setup_fhir_code_systems, setup_non_fhir_code_systems


def execute():
	setup_non_fhir_code_systems()
	setup_fhir_code_systems()
