# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: Python 3.14
**Primary Dependencies**: Frappe / Bench (latest stable), frappe framework, MariaDB (default bench setup), optional: pydicom (for DICOM hooks), requests
**Storage**: MariaDB (Frappe default); attachments stored via Frappe file store (filesystem/S3 as configured)
**Testing**: `pytest` for unit tests; Frappe's integration testing when run inside a bench
**Target Platform**: Frappe Bench (Linux/macOS dev machines, deployable to Ubuntu servers via bench)
**Project Type**: Frappe app (integrated into existing `healthcare` app)
**Performance Goals**: Initial goal — correctness and auditability; perf targets TBD (NEEDS CLARIFICATION)
**Constraints**: PHI protection and audit logging required; must be compatible with current Frappe bench APIs and Python 3.14 runtime
**Scale/Scope**: Hospital-scale deployment (hundreds of concurrent users expected), but initial rollout limited to feature pilot in single org

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates are determined by the project constitution at `.specify/memory/constitution.md`.
Every plan MUST include a short "Constitution Compliance" checklist calling out any
applicable principles (e.g., PHI handling, clinical safety review, required tests, standard
compliance such as FHIR).

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: This will be implemented as a Frappe app feature under the existing `healthcare` app. DocTypes and Python domain wrappers live under `healthcare/doctype/<name>/` and API endpoints under `healthcare/api/`. Tests live under `tests/healthcare/` and fixtures under `healthcare/fixtures/`.

Constitution Compliance (short checklist):
- **PHI Handling**: Must document data minimization and encryption-at-rest options; provide role-based access controls for DocTypes (System Manager / Healthcare Administrator by default)
- **Clinical Safety**: Feature requires clinical reviewer sign-off before Phase 2 merge
- **Automated Tests**: Unit tests added and CI job required to run `pytest` inside the bench-compatible environment
- **Interoperability**: Provide FHIR mapping plan (ServiceRequest -> Imaging Order, Procedure -> Radiology Procedure); details to be captured in `research.md`

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
