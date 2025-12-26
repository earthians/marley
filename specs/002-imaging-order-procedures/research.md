# Phase 0 Research — Imaging Order / Radiology Procedure feature

Summary
-------
Resolve open technical choices for implementing Imaging Orders, Radiology Procedures and Procedure Steps in the `healthcare` Frappe app (stack: Frappe Bench latest, Python 3.14).

Decisions
---------

- Decision: FHIR mapping
  - Choice: Map `ServiceRequest` → `Imaging Order`, `Procedure` → `Radiology Procedure`, and `ImagingStudy`/`ProcedureStep` concepts for performed imaging results and steps.
  - Rationale: `ServiceRequest` closely matches the clinical order semantics; `Procedure` maps to performed/intentional procedure resources; keeping the mapping aligned to FHIR allows straightforward export/import adapters.
  - Alternatives considered: HL7 v2 ORM/ORU (legacy) — rejected for greenfield interoperability in favor of FHIR.

- Decision: DICOM / Imaging handling
  - Choice: Use `pydicom` for in-app parsing and integrate with an external DICOM store for production (Orthanc recommended) via REST hooks.
  - Rationale: `pydicom` is lightweight for metadata extraction; Orthanc provides a robust store and REST API for retrieval and event hooks.
  - Alternatives: full in-repo DICOM storage (complex) or relying solely on PACS vendor APIs (vendor lock-in). Chosen hybrid supports vendor-neutral workflows.

- Decision: PHI safeguards and audit
  - Choice: Enforce RBAC via DocType permissions (System Manager, Healthcare Administrator, Clinical roles), enable Frappe's audit trail (`track_changes`) on clinical DocTypes, and document recommended encryption-at-rest (S3/Filesystem + DB encryption) and retention policies.
  - Rationale: Minimizes PHI exposure by default and leverages Frappe's built-in controls; adds explicit guidance for deployers to configure encryption and backups.
  - Alternatives: Store PHI in separate encrypted microservice — higher operational cost and integration complexity; not chosen for initial rollout.

- Decision: Python / Frappe compatibility
  - Choice: Target Frappe Bench "latest stable" and develop for Python 3.14 as requested; include compatibility shims in code to gracefully fallback when API differences exist (e.g., use dynamic imports and HAS_FRAPPE flags), and explicitly test in CI against the target bench and Python versions.
  - Rationale: User-specified stack; plan to validate in CI and during local bench runs. Code already uses runtime detection (`HAS_FRAPPE`) and in-memory fallbacks for unit tests outside bench.
  - Alternatives: Lock to a specific older Python (3.11) for maximum compatibility — this is available as a fallback if bench compatibility issues appear.

- Decision: Testing strategy
  - Choice: `pytest` for unit tests, with integration tests run in a bench-enabled CI job (e.g., GitHub Actions runner that provisions a bench or uses a Frappe test container).
  - Rationale: Allows fast-running unit tests locally and full bench integration in CI.

Next steps / Actions
--------------------
- Implement `data-model.md` and OpenAPI contracts based on the FHIR mapping above.
- Add CI matrix entries to validate Python 3.14 + Frappe bench compatibility; if conflicts surface, evaluate pinning to the highest-compatible Python supported by bench.
- Add DICOM integration guide and example Orthanc hook for pushing study metadata into `Radiology Procedure` and `Procedure Step` records.

References & Notes
------------------
- Fixtures and minimal in-repo DocType JSONs have been added under `healthcare/doctype/*` and sample fixture in `healthcare/fixtures/`.
- Migration helper updated to register DocTypes during `bench execute` runs; see `healthcare/patches/README.md` for usage.
Decision: Use internal domain model with FHIR-aligned mappings

Rationale:
- The repository is a Frappe/ERPNext style Python app; we should implement healthcare domain objects (doctypes/models) inside the existing `healthcare` app to keep logic consistent with the codebase and existing deployment patterns.
- For interoperability, map internal objects to FHIR resources when exchanging data with external systems (RIS/PACS). Using a mapping layer preserves internal schema flexibility while meeting standards requirements.

Mapping choices (decisions):
- Imaging Order: map to FHIR `ServiceRequest` (category: imaging / codeable concept) when exporting or receiving orders. Rationale: `ServiceRequest` is the FHIR resource for orders/requests; imaging-specific fields map naturally.
- Radiology Procedure: model internally as `RadiologyProcedure` (domain entity). When performed, map to FHIR `Procedure` and/or `ImagingStudy` depending on payload (ImagingStudy for image collections/results, Procedure for performed activity).
- Procedure Step: tracked as first-class internal entity (`ProcedureStep`) with lifecycle statuses. When a step is performed, emit or map to `Procedure` and attach references to `ImagingStudy` as needed.

Alternatives considered:
- Implementing a direct FHIR-first model (persisting FHIR resources verbatim). Rejected because the repository uses domain objects and a FHIR-first persistence would complicate internal queries and UI behaviour.
- Using only `ImagingStudy` or `Procedure` for orders. Rejected because `ServiceRequest` is the canonical ordering resource in FHIR.

Unknowns / NEEDS CLARIFICATION (research tasks):
- Confirm target DB (MariaDB vs PostgreSQL) used in deployment.
- Confirm Python runtime version and test tooling (pytest vs unittest).
- Confirm whether there is an existing FHIR library or integration pattern in the repo / org.

Implementation implications
- Create small mapping utilities: `to_fhir_service_request(imaging_order)` and `from_fhir_service_request(payload)`.
- Keep audit/history at the `ProcedureStep` level; emit audit events for status changes.
- Contract tests must validate mapping correctness for at least happy-path export/import.
