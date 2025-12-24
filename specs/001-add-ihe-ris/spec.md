```markdown
# Feature Specification: IHE Radiology Information System (RIS)

**Feature Branch**: `001-add-ihe-ris`  
**Created**: 2025-12-24  
**Status**: Draft  
**Input**: User description: "Extend the marley/healthcare app to support implementation of an IHE compliant Radiology Information System. Clearcanvas RIS is a good resource for requirements - https://documentation.clearcanvas.ca/Documentation/UsersGuide/Workstation/2_0_SP1/index.html?imaging_service_model.htm"

## Constitution Compliance (mandatory)

This feature touches PHI, clinical workflows, and external imaging contracts. It MUST comply with the
Marley Health Constitution (`.specify/memory/constitution.md`):

- Document how PHI is accessed, stored, and audited (PHI minimization and retention).  
- Include a clinical reviewer for any changes that affect clinical decision-making or patient-facing
  outputs.  
- Specify interoperability contracts and versioning strategy (IHE profiles; HL7/FHIR mappings where
  applicable).  

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Schedule Imaging Order (Priority: P1)

Radiology scheduler or clinician creates an imaging order (request) for a patient, assigns modality,
selects priority (routine/urgent), schedules an appointment, and issues an accession number.

**Why this priority**: Core clinical workflow required for all downstream activity (imaging acquisition,
reporting, billing).

**Independent Test**: Create a new imaging order for an existing patient and verify it appears in the
"scheduled studies" view with correct patient demographics, modality, priority, and scheduled time.

**Acceptance Scenarios**:

1. **Given** a registered patient, **When** clinician creates an imaging order with modality X, **Then**
  an imaging order is persisted with a unique accession and visible in scheduler.
2. **Given** an imaging order with a scheduled slot, **When** the scheduler changes the slot, **Then**
  the imaging order reflects the new time and relevant notifications are generated to stakeholders.

---

### User Story 2 - Capture & Attach Study Metadata (Priority: P2)

After image acquisition (or on import), the system must capture study-level metadata (study UID,
acquisition time, modality, accession), associate it with the imaging order, and allow clinicians to
view study metadata and access the link to image storage (PACS or external viewer).

**Why this priority**: Enables clinicians to find images and tie them to the correct order and report.

**Independent Test**: Import a study metadata file or simulate acquisition and verify it links to the
correct order and displays metadata fields.

**Acceptance Scenarios**:

1. **Given** a completed acquisition for accession A, **When** study metadata is available, **Then** the
  system links the study to the imaging order A and exposes metadata in the study UI.

---

### User Story 3 - Reporting Workflow & Sign-off (Priority: P1)

Radiologists create structured or free-text reports linked to a study, request addenda, and sign final
reports. Signed reports become part of the patient record and are discoverable.

**Why this priority**: Reporting is the primary clinical output of RIS and must be reliable and
audit-trailed.

**Independent Test**: Create a draft report for a study, save as draft, then finalize and verify the
report is marked as signed, immutable, and audit-logged.

**Acceptance Scenarios**:

1. **Given** a study with images, **When** a radiologist drafts a report, **Then** the draft is saved and
  associated to the study.
2. **Given** a signed report, **When** a user attempts to modify it, **Then** modifications require an
  addendum and are audit-logged.

---

### User Story 4 - Interoperability: Order / Report Exchange (Priority: P2)

Exchange of orders and reports with external systems should follow IHE workflow profiles (e.g., Scheduled
Workflow) and use HL7/FHIR bundles or equivalent standards for order and report messages.

**Independent Test**: Export an order or finalized report in the agreed message format and validate it
against a contract fixture (schema) used by a receiving system.

**Acceptance Scenarios**:

1. **Given** a finalized report, **When** the system exports it, **Then** the exported artifact validates
   against the chosen IHE/HL7/FHIR contract and includes required metadata (accession, patient id,
   author, signed timestamp).

---

### Edge Cases

- Orders created without complete patient demographics: system must block or require completion before
  scheduling.  
- Duplicate accession numbers: system must prevent collisions and reconcile duplicates.  
- Network/PACS unavailability: reports and metadata must be queued for retry; user must see clear
  offline indicators.  
- Urgent (STAT) orders updated during acquisition: updates must be propagated to modalities and staff.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow clinicians to create an imaging order with patient identifier,
  modality, reason for exam, priority, and requested date/time. (Testable by creating an order and
  asserting stored fields.)
- **FR-002**: System MUST generate and persist a unique accession identifier for each imaging order.
- **FR-003**: System MUST allow scheduling, rescheduling, and cancellation of imaging orders with
  notifications to affected staff.  
- **FR-004**: System MUST accept and link study metadata to imaging orders (study UID, acquisition
  datetime, modality, series counts).  
- **FR-005**: System MUST allow radiologists to create, edit (draft), and sign reports tied to a study,
  with audit trail and immutability for signed reports.  
- **FR-006**: System MUST export/import orders and reports using IHE-compatible exchange formats and
  provide contract validation tooling or fixtures. Scope decision: support Scheduled Workflow and
  Report Management profiles initially (order scheduling and report exchange). Full modality actor
  support is out of initial scope and can be planned later.
- **FR-007**: System MUST record access logs for PHI-related operations and provide an audit trail for
  schedule changes, report sign-off, and data exports.  
- **FR-008**: System MUST handle temporary unavailability of external image stores (queue metadata and
  retries) and surface clear error states to users.  
- **FR-009**: System MUST provide role-based access controls for scheduling, reporting, and admin
  operations (e.g., scheduler, radiologist, radiology tech, admin).  
- **FR-010**: System SHOULD support linking to image storage endpoints (PACS/viewer) and include a
  discoverable URL or reference in study metadata. Scope decision: implement metadata linking only
  for the MVP (PACS references/URLs); direct DICOM storage (C-STORE) is out of scope for the initial
  implementation and may be added later as a connector.

### Key Entities *(include if feature involves data)*

- **Patient**: Existing patient record; RIS links via patient identifier.  
- **ImagingOrder**: Represents requested exam; attributes: accession, patient_id, modality, priority,
  requested_datetime, ordering_provider, status (requested/scheduled/completed/cancelled).  
- **StudyMetadata**: Represents acquired study: study_uid, series_count, acquisition_datetime,
  linked_accession, storage_reference (URL or PACS identifier).  
- **Report**: Draft/signed findings, author, signoff timestamp, linked study_uid, addenda.  
- **ScheduleSlot**: Time slot reserved for an imaging order, resource (room/modality), assigned
  technologist.  

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can create and schedule an imaging order end-to-end in under 3 minutes (measured
  by a scripted user flow).  
- **SC-002**: 95% of imaging orders created in the system successfully link to study metadata when the
  acquisition completes (measured using synthetic test imports).  
- **SC-003**: 100% of signed reports are immutable and include an audit entry with signer and timestamp
  (verified in audit logs).  
- **SC-004**: Exported orders and reports validate against the agreed IHE/HL7/FHIR contract fixtures
  in 100% of test cases for supported profiles.  
- **SC-005**: System maintains an access log for PHI operations and can produce an access report for a
  patient for a 30-day window within 10 seconds (performance target for reporting queries).  

## Assumptions

- The health app already provides a canonical `Patient` entity and authentication/authorization
  framework to leverage for RIS roles.  
- Integration with image stores (PACS) may be by reference (URL/identifier) rather than direct image
  transfer unless clarified.  
- Clinical reviewers will be available to approve clinical-impacting changes and test cases.  

## Deliverables (MVP)

- Scheduling UI and API for imaging orders.  
- Study metadata ingestion and linking to orders.  
- Report draft/signing workflow with audit logs.  
- Export fixtures for order/report contracts and a validation test harness.  

## Out of Scope (initial)

- Full DICOM storage engine and viewer implementation (PACS) unless clarified otherwise.  
- Advanced reporting templates or NLP-driven report generation (may be added later).  

---

**Next steps**: Validate the two clarification points above, assign a clinical reviewer, and produce
contract fixtures for the chosen IHE/HL7/FHIR profiles.

``` 
# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[###-feature-name]`  
**Created**: [DATE]  
**Status**: Draft  
**Input**: User description: "$ARGUMENTS"

## Constitution Compliance (mandatory)

Summarize how this spec satisfies relevant constitution principles in `.specify/memory/constitution.md`.
Call out any required compliance actions (e.g., clinical reviewer needed, PHI handling, migration plan).

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently - e.g., "Can be fully tested by [specific action] and delivers [specific value]"]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]
2. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 2 - [Brief Title] (Priority: P2)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 3 - [Brief Title] (Priority: P3)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- What happens when [boundary condition]?
- How does system handle [error scenario]?

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: System MUST [specific capability, e.g., "allow users to create accounts"]
- **FR-002**: System MUST [specific capability, e.g., "validate email addresses"]  
- **FR-003**: Users MUST be able to [key interaction, e.g., "reset their password"]
- **FR-004**: System MUST [data requirement, e.g., "persist user preferences"]
- **FR-005**: System MUST [behavior, e.g., "log all security events"]

*Example of marking unclear requirements:*

- **FR-006**: System MUST authenticate users via [NEEDS CLARIFICATION: auth method not specified - email/password, SSO, OAuth?]
- **FR-007**: System MUST retain user data for [NEEDS CLARIFICATION: retention period not specified]

### Key Entities *(include if feature involves data)*

- **[Entity 1]**: [What it represents, key attributes without implementation]
- **[Entity 2]**: [What it represents, relationships to other entities]

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: [Measurable metric, e.g., "Users can complete account creation in under 2 minutes"]
- **SC-002**: [Measurable metric, e.g., "System handles 1000 concurrent users without degradation"]
- **SC-003**: [User satisfaction metric, e.g., "90% of users successfully complete primary task on first attempt"]
- **SC-004**: [Business metric, e.g., "Reduce support tickets related to [X] by 50%"]
