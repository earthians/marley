<!--
  Sync Impact Report
  Version change: 1.1.0 → 1.2.0
  Modified principles: none renamed
  Added sections: VII. Website-safe booking writes; VIII. Stable public error kinds
  Removed sections: none
  Follow-up TODOs: none
-->

# Healthcare App (Abu Zahra) Constitution

## Core Principles

### I. APIs live in the Healthcare app
Website catalog, booking, and enquiry methods MUST be added under `healthcare/healthcare/api/`. They MUST NOT require a separate custom app.

**Rationale**: Operations already run Marley Health; a second app splits ownership and deploy.

### II. Existing records only
Catalog features MUST read and seed existing Healthcare DocTypes (Complaint, Therapy Type, Healthcare Service Unit, Healthcare Practitioner, Insurance Payor, and related setup). They MUST NOT introduce new DocTypes for public website lists. Public enquiry writes MUST create existing CRM Lead records (and existing UTM Source rows). They MUST NOT introduce a new enquiry DocType.

**Rationale**: Desk remains the system of record; the website consumes it.

### III. Website-safe catalog methods
Public catalog methods MUST succeed for Guest with no Authorization header (rate-limited), MUST ignore DocType permissions so a website role can read lists, and MUST return stable JSON suitable for bilingual chrome plus clinic-provided labels. Token auth MAY still work; it MUST NOT be required for these reads.

**Rationale**: Website API users often lack Desk read permission on clinical DocTypes. A rotated or stale token 401s even on `allow_guest` methods if the client still sends it.

### IV. Seed is a site helper, not a core patch
Demo or published catalog rows MUST be created by idempotent scripts under `Helper_codes/Seeding/`. Healthcare core MUST NOT be patched solely to insert Abu Zahra marketing data.

**Rationale**: Seeds are site-specific; core patches are for behavior.

### V. Simplicity
List methods SHOULD stay independently callable. Prefer `{id, label}` plus a small set of display fields over a second domain model. Booking-option APIs and catalog-page APIs MAY differ in richness but MUST NOT contradict each other on identity (same record, same id).

**Rationale**: The booking wizard already depends on independent `{id, label}` lists.

### VI. Website-safe enquiry writes
Public Contact and Medical Tourism submissions MUST succeed for Guest with no Authorization header, MUST be rate-limited more strictly than catalog reads, MUST ignore DocType permissions for the Lead insert, MUST require name and phone, and MUST distinguish Contact vs Medical Tourism using UTM Source. Token auth MAY still work; it MUST NOT be required.

**Rationale**: Enquiry writes are the public conversion path beside booking. Requiring a website token repeats the stale-key failure mode of catalog reads.

### VII. Website-safe booking writes
Public appointment requests MUST succeed for Guest with no Authorization header, MUST be rate-limited at least as strictly as enquiry writes (10 per 60 seconds), MUST ignore DocType permissions for Patient and Patient Appointment inserts, MUST require name, phone, gender, condition, service, branch, date, and time, and MUST reuse an existing Patient when the mobile number already exists. Token auth MAY still work; it MUST NOT be required. No new DocType.

**Rationale**: Booking is the primary conversion path. The website token path fails when the key is rotated or the role cannot write clinical records.

### VIII. Stable public error kinds
Public website methods MUST label failures as `validation`, `rate_limit` (HTTP 429), or `server_error`. Empty catalog lists MUST return `[]`, not an error. Guest responses MUST NOT include HTML stack traces.

**Rationale**: The website maps each kind to bilingual recovery copy. Mixed shapes force the site to guess.

## Healthcare API Constraints

- Target site for local work: `senlite.localhost`.
- No payment or claims-settlement APIs in this public-catalog program.
- Do not log API secrets. Do not put tokens in query strings.
- Enquiry methods MUST reject missing name or phone with a validation error (not a silent Lead).
- Booking write methods MUST reject missing required fields, Friday dates, and past dates with a validation error (not a silent Appointment).

## Delivery Workflow

- Specify, clarify, plan, and task before implementing a slice.
- Methods MUST be independently testable with `bench execute` or guest HTTP calls.
- Constitution gates in `/speckit-plan` MUST pass or record justified complexity.

## Governance

This constitution supersedes informal practice for Healthcare website APIs on this project. Amendments MUST bump the version (MAJOR for incompatible principle changes, MINOR for new principles, PATCH for wording). Pull requests that add whitelist methods or seed scripts MUST be reviewable against these principles.

**Version**: 1.2.0 | **Ratified**: 2026-08-26 | **Last Amended**: 2026-08-27
