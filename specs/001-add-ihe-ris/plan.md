````markdown
# Implementation Plan: IHE Radiology Information System (RIS)

**Branch**: `001-add-ihe-ris` | **Date**: 2025-12-24 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-add-ihe-ris/spec.md`

## Summary

Add a lightweight, IHE-aligned Radiology Information System to the Marley Health app. Deliver an
MVP that supports order scheduling (Scheduled Workflow), study metadata ingest/linking, report
draft/signing workflows, and IHE-compatible order/report export/validation. PACS integration is
metadata-linking only (references/URLs) for the MVP.

## Technical Context

**Language/Version**: Python 3.11 (Frappe/ERPNext app) + modern JS (Vue) for viewer/UI components  
**Primary Dependencies**: Frappe framework, ERPNext models where applicable, SQL (MariaDB/MySQL),
  optional: pydicom for metadata parsing, requests/httpx for connectors  
 **Storage**: MariaDB (existing Frappe DB); artifact storage (reports, fixtures) on filesystem or
  configured object store (S3) per site  
 **Testing**: Frappe builtin test runner (pytest-compatible), contract tests using JSON/XML fixtures,
  and lightweight integration tests for SWF flows  
 **Target Platform**: Linux server (bench/erpnext deployment), container-friendly (Docker)  
 **Project Type**: Frappe app module (healthcare extension)  
 **Performance Goals**: Support mid-size hospitals: scheduling throughput ~100 req/min, query
  latencies <200ms p95 for typical DB-backed queries; audit-report generation within 10s for 30-day
  windows (see SC-005)  
 **Constraints**: PHI compliance, clinical safety review for any clinical-impacting change, audit
  logging, semantic versioning for public contracts  
 **Scale/Scope**: Multi-site hospital deployments; initial MVP targeted to single-site integration
  adapters later (multi-site/HA optional)

## Constitution Check

This plan follows the Marley Health Constitution (`.specify/memory/constitution.md`):

- PHI: plan limits PHI storage to existing secure stores, requires audit logs and RBAC for access.  
- Clinical Safety: reporting workflows require clinical review; sign-off flows are immutable and
  tested.  
- Interoperability: initial support for IHE Scheduled Workflow + Report Management; contract
  fixtures and migration guidance are required for breaking changes.

Gate: Do not implement public export/import until contract fixtures and CI validation are present.

## Project Structure

Implement as a Frappe app extension under `healthcare/` with the following new components:

- `doctype/imaging_order/` — model, validations, REST API, scheduler hooks  
- `doctype/study_metadata/` — study UID, series_count, acquisition_time, storage_reference  
- `doctype/report/` — draft/sign/immutable signed state, addenda, audit trail  
- `healthcare/api/radiology.py` — API endpoints for order creation, scheduling, study linking,
  report management  
- `healthcare/doctype_hooks.py` — signals for notifications, audit logging, contract export
- UI: desk pages under `desk_page/healthcare/radiology` and viewer components in `www/` or `viewer/`

Structure Decision: Keep all code within the existing `healthcare` app to reuse `Patient` and auth.

## Complexity Tracking

No constitution violations anticipated; clinical safety and PHI handling are required and justified.
If later direct PACS/DICOM transfer is added, add a separate feature with explicit security review.

## Phases

Phase 0 — Research (1–2 weeks)
- Produce IHE Scheduled Workflow & Report Management contract fixtures (JSON/XML).  
- Map Frappe `Patient` fields to required IHE identifiers; research pydicom for metadata parsing.  
- Produce `research.md` with decisions and alternatives.

Phase 1 — Design & Contracts (1 week)
- Create `data-model.md` listing `ImagingOrder`, `StudyMetadata`, `Report`, `ScheduleSlot` with
  validation rules.  
- Produce `/contracts/` with example order/report exchange payloads and schema validations.  
- Write `quickstart.md` describing deployment and dev run steps.

Phase 2 — Implementation Core (2–4 weeks)
- Implement Doctypes and database mappings, business logic, and unit tests.  
- Implement API endpoints and server-side validators.  
- Implement audit logging and RBAC checks.

Phase 3 — UI & Reporting (2–3 weeks)
- Scheduler UI, study list and metadata view, report editor (draft/sign workflows).  
- Add unit/integration tests for UI actions where applicable.

Phase 4 — Interoperability & Validation (1–2 weeks)
- Implement export/import flows for orders/reports; build validation harness to test fixtures in CI.  
- Provide simple connector to publish exports (SFTP/HTTP) or store in repository for import.

Phase 5 — QA & Release (1 week)
- Clinical review, security review, load test for access-report generation, finalize docs and
  migration notes.  

## Deliverables

- `research.md`, `data-model.md`, `contracts/` (IHE fixtures), `quickstart.md`  
- Doctypes: `ImagingOrder`, `StudyMetadata`, `Report`, `ScheduleSlot`  
- APIs and unit/integration tests  
- UI pages for scheduling, study view, and reporting  
- CI contract validation tests for exports

## Risks & Mitigations

- Risk: Clinical-safety bugs in reporting. Mitigation: require clinical reviewer and acceptance tests
  for all report-affecting changes.  
- Risk: PHI leakage. Mitigation: audit logs, RBAC, encryption expectations documented and tested.  
- Risk: Contract drift. Mitigation: maintain fixtures in repo and CI-validation on PRs.

## Acceptance & Success Criteria

Use success criteria defined in `spec.md` (SC-001 .. SC-005). Add CI gates for contract validation
and tests for signed-report immutability.

## Next Steps (immediate)

1. Finish `Phase 0` research: produce `research.md` and contract fixture examples.  
2. Assign a clinical reviewer and policy owner for PHI retention.  
3. Begin Phase 1 design artifacts and open implementation tasks in `/specs/001-add-ihe-ris/tasks.md`.

```
