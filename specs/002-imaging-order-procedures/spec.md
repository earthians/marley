## Associate Imaging Order with Radiology Procedures & Procedure Steps

## Constitution Compliance (mandatory)

- This feature will handle protected health information (PHI). Any implementation must follow
  organisational PHI controls, audit logging and least-privilege access. A clinical reviewer
  should sign-off on the data model and user-facing labels before release.
- The spec avoids implementation details; integrations (RIS/PACS, scheduling) are called out
  as dependencies and must be validated in integration testing.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create Imaging Order with Procedures (Priority: P1)

As an ordering clinician, I want to create an Imaging Order that references one or more
Radiology Procedures so that the radiology department has a structured plan for imaging.

Why this priority: core to ordering workflow.

Independent Test: Create an Imaging Order in the UI or API that contains 1..N Radiology
Procedures and verify the order persists and is visible to scheduling and radiology staff.

Acceptance Scenarios:
1. Given a clinician with ordering privileges, when they create an Imaging Order with two
   Radiology Procedures, then the system stores an Imaging Order with two procedure objects
   and returns 201/OK with the order ID.
2. Given an existing Imaging Order, when a procedure is added, then the change is auditable
   and visible to schedulers.

---

### User Story 2 - Schedule and Manage Procedure Steps (Priority: P2)

As a scheduler, I want to view Procedure Steps for each Radiology Procedure and schedule
their planned date/time so that each step can be performed at the right time and by the
right resource.

Independent Test: From a scheduler account, open an Imaging Order, list Procedure Steps,
assign a scheduled date/time to one step, and verify its status becomes `scheduled` and the
value is persisted.

Acceptance Scenarios:
1. Given a Procedure Step with no schedule, when the scheduler assigns a date/time, then the
   step's status is `scheduled` and the scheduled datetime is recorded.

---

### User Story 3 - Perform Procedure Step and Record Result (Priority: P1)

As a radiology technician, I want to mark a Procedure Step as `in-progress` and then
`performed` with optional result/notes, so that completed work is tracked per-step.

Independent Test: From a technician account, mark a step `in-progress` then `performed`,
attach notes, and verify the step history contains timestamps, actor, and notes.

Acceptance Scenarios:
1. Given a `scheduled` Procedure Step, when a technician starts it, then status becomes
   `in-progress` and a start timestamp is recorded.
2. Given an `in-progress` Procedure Step, when technician completes it, then status becomes
   `performed`, completion timestamp and optional notes/results are stored.

---

### Edge Cases

- Cancelling a Procedure Step before it is started: step should move to `cancelled` with a
  reason and timestamp.
- If multiple Procedure Steps run in parallel for the same Procedure, ensure scheduling
  conflicts are surfaced to schedulers.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow creation of an `ImagingOrder` that references one or
  more `RadiologyProcedure` objects (1..N). (Testable: API POST returns 201 and stored
  object contains procedures.)
- **FR-002**: Each `RadiologyProcedure` MUST contain one or more `ProcedureStep` items
  (1..N). (Testable: procedure object contains array of steps >=1.)
- **FR-003**: Each `ProcedureStep` MUST expose a lifecycle status with at least these values:
  `pending` (default), `scheduled`, `in-progress`, `performed`, `cancelled`. (Testable: status
  transitions allowed and recorded.)
- **FR-004**: Authorized users MUST be able to set or update schedule info (datetime, resource)
  on a `ProcedureStep`. (Testable: scheduler updates step and fields persist.)
- **FR-005**: When a `ProcedureStep` status changes, the system MUST record an auditable history
  entry containing actor, timestamp, previous and new status, and optional notes. (Testable:
  history entries exist and contain required fields.)
- **FR-006**: The system MUST provide read access to Imaging Orders and their Procedures/Steps
  to roles: ordering clinician, scheduler, radiology staff. (Testable: role-based access tests.)
- **FR-007**: Cancelling a Procedure Step MUST not delete its history; it must mark status
  `cancelled` and record who cancelled and why. (Testable: cancelled entries persist with reason.)

### Key Entities *(data model-level, technology-agnostic)*

- **ImagingOrder**: id, ordering_actor, patient_reference, created_at, procedures (list of
  RadiologyProcedure ids)
- **RadiologyProcedure**: id, code (procedure type), description, steps (list of ProcedureStep)
- **ProcedureStep**: id, title, description, scheduled_datetime, assigned_resource, status,
  performer, started_at, completed_at, notes, audit_history

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Orders containing multiple procedures: 100% of created Imaging Orders correctly
  store the specified number of procedures (automated test coverage).
- **SC-002**: Procedure Step lifecycle: 95% of step state transitions are correctly recorded
  with complete audit details in automated tests.
- **SC-003**: Scheduling accuracy: 99% of schedule updates persist and are visible to
  schedulers within 2 seconds of the update in integration tests.
- **SC-004**: User task success: Ordering clinicians and schedulers can complete their primary
  tasks (create order, schedule a step) in the happy path in under 3 minutes during usability
  testing.

## Assumptions

- Defaults: a `ProcedureStep` default status is `pending` until explicitly scheduled.
- Status names are the canonical set listed in FR-003. Additional custom statuses can be
  added later but must map to these canonical states for reporting.
- Authorization model: standard role-based access exists; this spec assumes roles
  `ordering_clinician`, `scheduler`, and `radiology_staff` are already available.

## Dependencies

- Scheduling subsystem (existing calendar/resource assignment).
- RIS/PACS integration for exchange of performed procedure metadata (out of scope for
  initial spec but required for end-to-end validation).

## Acceptance Tests (high level)

1. API: POST /imaging-orders with payload including two procedures → returns 201 and stored
   order contains two procedures. (FR-001)
2. Scheduler: Update step scheduled_datetime → step status becomes `scheduled` and field
   persisted. (FR-004)
3. Technician: Mark step `in-progress` then `performed` with notes → history contains
   start and completion entries with actor and timestamps. (FR-005)
4. Cancellation: Cancel a scheduled step → status `cancelled`, reason persisted, history
   entry present. (FR-007)

## Notes

- No implementation details (frameworks, APIs) are included; tests specify observable
  behaviour.
- If you want different default statuses or role mappings, update the Assumptions section
  and re-run validation.

- **SC-001**: [Measurable metric, e.g., "Users can complete account creation in under 2 minutes"]
- **SC-002**: [Measurable metric, e.g., "System handles 1000 concurrent users without degradation"]
- **SC-003**: [User satisfaction metric, e.g., "90% of users successfully complete primary task on first attempt"]
- **SC-004**: [Business metric, e.g., "Reduce support tickets related to [X] by 50%"]
