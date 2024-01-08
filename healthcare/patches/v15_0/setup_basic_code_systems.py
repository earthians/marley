from healthcare.setup import (
    setup_fhir_code_systems,
    setup_non_fhir_code_systems,
    setup_code_sysem_for_version,
)


def execute():
	setup_code_sysem_for_version()
	setup_non_fhir_code_systems()
	setup_fhir_code_systems()
