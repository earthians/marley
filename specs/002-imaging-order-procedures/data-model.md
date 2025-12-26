# Data Model — Imaging Orders, Radiology Procedures, Procedure Steps

Entities
--------

- Imaging Order
  - Primary purpose: represent an order (ServiceRequest equivalent) for imaging requested by a clinician.
  - Fields:
    - `name` (string, autoname) — DocType name
    - `patient_id` (string, required)
    - `ordering_actor_id` (string)
    - `order_datetime` (datetime)
    - `status` (enum): `draft`, `requested`, `scheduled`, `in-progress`, `completed`, `cancelled`
    - `procedures` (table of `Radiology Procedure`) — one-to-many
    - `notes` (text)
    - `created_by`, `created_at`, `modified_by`, `modified_at` (audit fields)
  - Validation: `patient_id` required; at least one `procedures` row for submitted orders.

- Radiology Procedure
  - Primary purpose: a specific procedure requested (Procedure equivalent).
  - Fields:
    - `code` (string) — local code / CPT / SNOMED code mapping
    - `description` (text)
    - `priority` (enum): `routine`, `urgent`, `stat`
    - `template` (Link to `Radiology Procedure Template`, optional)
    - `steps` (table of `Procedure Step`) — ordered list
    - `scheduled_datetime` (datetime, optional)
    - `status` (enum): `requested`, `scheduled`, `in-progress`, `completed`, `cancelled`
  - Validation: `code` or `template` should be present; `priority` must be one of allowed values.

- Procedure Step
  - Primary purpose: atomic action or stage within a `Radiology Procedure` (e.g., prep, positioning, acquisition).
  - Fields:
    - `title` (string)
    - `description` (text)
    - `scheduled_datetime` (datetime)
    - `performed_datetime` (datetime)
    - `assigned_resource_id` (string) — staff or device
    - `status` (enum): `pending`, `scheduled`, `in-progress`, `performed`, `cancelled`
    - `metadata` (JSON) — store small DICOM-derived metadata (study uid, accession number) if available
  - Validation: `title` required; `status` transitions restricted (see lifecycle section).

- Radiology Procedure Template
  - Purpose: predefined templates to populate `Radiology Procedure` and `Procedure Step` content.
  - Fields: `template` (name), `modality`, `body_part`, `description`, `steps` (table of step templates), `is_billable`, `rate`.

Relationships
-------------
- `Imaging Order` 1 → N `Radiology Procedure` (table field `procedures`).
- `Radiology Procedure` 1 → N `Procedure Step` (table field `steps`).
- `Radiology Procedure` → optional `Radiology Procedure Template` link.

State Machine / Lifecycle
-------------------------
- Imaging Order: `draft` → `requested` → `scheduled` → `in-progress` → `completed` OR `cancelled`.
- Radiology Procedure: `requested` → `scheduled` → `in-progress` → `completed` OR `cancelled`.
- Procedure Step: `pending` → `scheduled` → `in-progress` → `performed` OR `cancelled`.

Implementation Notes
--------------------
- DocTypes should enable `track_changes` for auditability.
- Use table child DocTypes for `procedures` and `steps` to keep Frappe UI simple.
- Add indices on `patient_id`, `order_datetime`, and `status` for efficient queries.
- Provide lightweight JSON `metadata` on `Procedure Step` for DICOM UIDs and cross-references.

Validation Rules
----------------
- Prevent illegal status regressions (e.g., `completed` → `in-progress`).
- When an `Imaging Order` reaches `completed` set all child `Radiology Procedure` and `Procedure Step` statuses to `completed` if not already.

Security & PHI
--------------
- Limit read/write by role via DocType permissions; default to `System Manager` and `Healthcare Administrator` for creation.
- Consider field-level encryption for high-risk identifiers if deployer requires it.
Data model: ImagingOrder, RadiologyProcedure, ProcedureStep

Entities

1) ImagingOrder
- id: string (UUID or DB PK)
- patient_id: string (reference to patient record)
- ordering_actor_id: string (user id)
- created_at: datetime
- status: enum [draft, submitted, cancelled]
- procedures: list of RadiologyProcedure ids or embedded objects
- metadata: object (freeform for external ids, e.g., FHIR id)

Validation rules:
- `procedures` must contain >= 1 RadiologyProcedure
- `patient_id` required

2) RadiologyProcedure
- id: string
- imaging_order_id: string (back reference)
- code: string (codified procedure code, e.g., CPT/LOINC/organization code)
- description: string
- priority: enum [routine, urgent, stat]
- steps: list of ProcedureStep ids or embedded objects

Validation rules:
- `steps` must contain >= 1 ProcedureStep
- `code` should be present (NEEDS CLARIFICATION on code system)

3) ProcedureStep
- id: string
- radiology_procedure_id: string
- title: string
- description: string
- scheduled_datetime: datetime | null
- assigned_resource_id: string | null (operator / room / device)
- status: enum [pending, scheduled, in-progress, performed, cancelled]
- performer_id: string | null
- started_at: datetime | null
- completed_at: datetime | null
- notes: text | null
- audit_history: list of history entries

History entry:
- actor_id, timestamp, from_status, to_status, note

State transitions
- pending -> scheduled (when schedule set)
- scheduled -> in-progress (when performer starts)
- in-progress -> performed (when completed)
- any -> cancelled (with reason)
- transitions must append an audit_history entry containing actor and timestamp

Indexes & queries
- Index `ImagingOrder.patient_id`
- Index `ProcedureStep.status` and `scheduled_datetime` for scheduler queries

Persistence considerations
- Use existing ORM/doctypes in `healthcare` module (Frappe doctypes) or create new tables consistent with the project's patterns.
- Store audit_history as child table or separate audit log table for queries and PI compliance.
