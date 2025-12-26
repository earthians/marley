# Tasks for Imaging Order → Radiology Procedure → Procedure Step

Phase 1 — Setup

- [ ] T001 Create feature spec docs in specs/002-imaging-order-procedures/ (spec.md, plan.md, research.md, data-model.md, quickstart.md)
- [ ] T002 Add development requirements to dev-requirements.txt (pytest, pytest-cov) — file: dev-requirements.txt
- [ ] T003 Add migration helper to register DocTypes — file: healthcare/patches/create_imaging_doctypes.py
- [ ] T004 Add fixture for Radiology Procedure Template — file: healthcare/fixtures/radiology_procedure_template/sample_chest_ct.json

Phase 2 — Foundational

- [ ] T005 [P] Add DocType JSONs for core entities: healthcare/doctype/imaging_order/imaging_order.json, healthcare/doctype/radiology_procedure/radiology_procedure.json, healthcare/doctype/procedure_step/procedure_step.json, healthcare/doctype/radiology_procedure_template/radiology_procedure_template.json
- [ ] T006 [P] Add Python domain wrappers for DocTypes: healthcare/doctype/*/*.py
- [ ] T007 [P] Update migration patch to include new template DocType registration: healthcare/patches/create_imaging_doctypes.py

Phase 3 — User Story 1 (Create Imaging Order with Procedures) [US1]

- [ ] T008 [US1] Implement API `POST /imaging-orders` handler and persistence: healthcare/api/imaging_orders.py
- [ ] T009 [US1] Add unit tests for Imaging Order creation and list APIs: tests/healthcare/test_imaging_orders_api.py
- [ ] T010 [US1] Add an acceptance quickstart or integration test demonstrating POST → 201 and stored procedures: specs/002-imaging-order-procedures/quickstart.md

Phase 4 — User Story 2 (Schedule and Manage Procedure Steps) [US2]

- [ ] T011 [US2] Implement Procedure Step scheduling endpoint and business logic: healthcare/api/procedure_steps.py
- [ ] T012 [US2] Add scheduler UI or desk page examples and wiring: healthcare/desk_page/* or healthcare/www/*
- [ ] T013 [US2] Add tests validating scheduling persists and status becomes `scheduled`: tests/healthcare/test_procedure_steps_api.py

Phase 5 — User Story 3 (Perform Procedure Step and Record Result) [US3]

- [ ] T014 [US3] Implement lifecycle transitions, audit history recording, and field-level hooks: healthcare/doctype/*/*.py and hooks in healthcare/hooks.py
- [ ] T015 [US3] Implement API endpoints to mark step `in-progress` and `performed`, accept notes/results: healthcare/api/procedure_steps.py
- [ ] T016 [US3] Add tests validating `in-progress` → `performed` transitions and audit entries: tests/healthcare/test_imaging_orders_*.py

Final Phase — Polish & Cross-cutting

- [ ] T017 [P] Maintain API contract: specs/002-imaging-order-procedures/contracts/openapi.yaml
- [ ] T018 [P] Add CI job to run unit and integration tests (GitHub Actions workflow: .github/workflows/test.yml)
- [ ] T019 [P] Finalize developer quickstart and migration README: specs/002-imaging-order-procedures/quickstart.md and healthcare/patches/README.md
- [ ] T020 [P] Clinical review & PHI compliance sign-off and checklist: specs/002-imaging-order-procedures/checklists/requirements.md

Dependencies & Notes

- Each user-story phase should be independently testable: ensure unit tests and a simple integration/quickstart exist for that story.
- Mark tasks with `[P]` when they can be worked on in parallel (do not require sequence).
# Tasks: Associate Imaging Order with Radiology Procedures & Procedure Steps

Phase 1 — Setup

- [ ] T001 [P] Create doctype skeleton for ImagingOrder in healthcare/doctype/imaging_order (create files: healthcare/doctype/imaging_order/imaging_order.py and healthcare/doctype/imaging_order/imaging_order.json)
- [ ] T002 [P] Create doctype skeleton for RadiologyProcedure in healthcare/doctype/radiology_procedure (create files: healthcare/doctype/radiology_procedure/radiology_procedure.py and radiology_procedure.json)
- [ ] T003 [P] Create doctype skeleton for ProcedureStep in healthcare/doctype/procedure_step (create files: healthcare/doctype/procedure_step/procedure_step.py and procedure_step.json)
- [ ] T004 [P] Add OpenAPI contract to specs/002-imaging-order-procedures/contracts/openapi.yaml (ensure schemas for ImagingOrder, RadiologyProcedure, ProcedureStep)

Phase 2 — Foundational (blocking prerequisites)

- [ ] T005 [ ] Add persistence/migration definitions for the new doctypes in healthcare/doctype/* (DB schema or Frappe doctype JSON files) — files: healthcare/doctype/*/*.json
- [ ] T006 [P] Implement FHIR mapping utilities in healthcare/api/fhir_mappings.py (to_fhir_service_request, from_fhir_service_request)
- [ ] T007 [P] Add test scaffolding in tests/healthcare/ (tests/healthcare/test_imaging_orders.py and tests/healthcare/test_procedure_steps.py)

Phase 3 — User Story Implementation (priority order)

US1 — Create Imaging Order with Procedures (Priority: P1)

- [ ] T008 [US1] Implement `POST /api/imaging-orders` handler in healthcare/api/imaging_orders.py to create ImagingOrder (persist procedures and return 201) — file: healthcare/api/imaging_orders.py
- [ ] T009 [US1] Implement server-side validation & persistence logic for `ImagingOrder` in healthcare/doctype/imaging_order/* (validate patient_id and procedures >=1) — files: healthcare/doctype/imaging_order/*
- [ ] T010 [P] [US1] Add unit and integration tests for ImagingOrder creation in tests/healthcare/test_imaging_orders.py

US2 — Schedule and Manage Procedure Steps (Priority: P2)

- [ ] T011 [US2] Implement endpoint to update scheduling info for a ProcedureStep (PATCH /api/procedure-steps/{stepId}/status or dedicated schedule endpoint) — file: healthcare/api/procedure_steps.py
- [ ] T012 [US2] Add scheduling fields and validation to ProcedureStep model (scheduled_datetime, assigned_resource_id) — files: healthcare/doctype/procedure_step/*
- [ ] T013 [P] [US2] Add scheduler tests to verify scheduled datetime persists and status becomes `scheduled` — tests/healthcare/test_procedure_steps_schedule.py

US3 — Perform Procedure Step and Record Result (Priority: P1)

- [ ] T014 [US3] Implement status transition logic and audit-history append for ProcedureStep (record actor, timestamp, from/to statuses) — files: healthcare/doctype/procedure_step/*
- [ ] T015 [US3] Implement API endpoints to transition a step to `in-progress` and `performed` (healthcare/api/procedure_steps.py) and support notes/results upload — files: healthcare/api/procedure_steps.py
- [ ] T016 [P] [US3] Add tests for lifecycle transitions, timestamps and audit entries in tests/healthcare/test_procedure_steps_lifecycle.py

Final Phase — Polish & Cross-cutting Concerns

- [ ] T017 [P] Add clinical review checklist and sign-off file specs/002-imaging-order-procedures/checklists/clinical-review.md
- [ ] T018 [P] Add contract/contract-tests that validate OpenAPI against implemented endpoints (tests/contract/ or CI job referencing specs/002-imaging-order-procedures/contracts/openapi.yaml)
- [ ] T019 [P] Update quickstart and README in specs/002-imaging-order-procedures/quickstart.md to include developer run instructions and mapping notes
- [ ] T020 [ ] Ensure CI runs tests for new files and add any required linting/formatting changes to project config

Dependencies & Notes

- Tasks marked `[P]` can be worked on in parallel (different files, minimal dependency).
- Tasks without `[P]` are sequential or require the foundational work to be completed first.
- Each `[USx]` phase should be independently testable: implement model + API + tests for that story before moving to the next.

Task counts: 20 total tasks; US1:3, US2:3, US3:3, Setup:4, Foundational:3, Final:4
