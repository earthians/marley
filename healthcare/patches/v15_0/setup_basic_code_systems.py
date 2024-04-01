from healthcare.setup import (
	setup_code_sysem_for_version,
	setup_fhir_code_systems,
	setup_non_fhir_code_systems,
)


def execute():
	setup_code_sysem_for_version()
	setup_non_fhir_code_systems()
	setup_fhir_code_systems()
