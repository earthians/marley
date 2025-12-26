Quickstart — Implementing Imaging Orders

1. Where to add code
- Add new doctypes under `healthcare/doctype/imaging_order`, `healthcare/doctype/radiology_procedure`, and `healthcare/doctype/procedure_step` following existing patterns in the `healthcare` app.
- Add API handlers under `healthcare/api/imaging_orders.py` and wire routes consistent with the app's HTTP routing.

2. Tests
- Add unit tests in `tests/healthcare/test_imaging_orders.py` covering:
  - ImagingOrder creation (FR-001)
  - ProcedureStep lifecycle transitions (FR-003..FR-007)
  - Access control tests for roles: ordering_clinician, scheduler, radiology_staff
- Add contract tests that validate `contracts/openapi.yaml` behaviour.

3. Local run
- Use the repository's existing dev environment for the `healthcare` app; example (adapt to local setup):

```bash
# start dev server (example for frappe bench; adjust if not applicable)
bench start
# run tests
pytest tests/healthcare/test_imaging_orders.py -q
```

4. Mapping/export
- Implement mapping helpers `to_fhir_service_request()` and `from_fhir_service_request()` in `healthcare/api/fhir_mappings.py`.

5. Acceptance
- Ensure a clinical reviewer signs off on the data model and UI copy.
- Ensure automated tests pass and contract tests validate OpenAPI expectations.
