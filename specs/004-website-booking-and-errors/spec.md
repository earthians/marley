# Feature Specification: Website Booking Write and Public Error Contract

**Feature Branch**: `004-website-booking-and-errors`

**Created**: 2026-08-27

**Status**: Implemented (verified 2026-08-27)

**Input**: Public website User Story 5 — recover gracefully when something fails — plus confirmation that this slice adds a **guest booking-write method** with a stable error contract on existing public website methods.

## Clarifications

### Session 2026-08-27

- Q: Demo confirmation vs live failure? → A: **Website concern.** This API MUST NOT invent a demo appointment. Invalid input is a validation error. Unexpected failures are server errors. Empty catalog lists remain empty arrays.
- Q: Guest booking write in this slice? → A: **Yes.** Public booking MUST succeed as Guest with no Authorization, rate-limited like enquiry, using existing Patient and Patient Appointment records.
- Q: Request timeout? → A: **Website aborts at 12 seconds.** Methods SHOULD return sooner than that on the local site for valid inserts.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a website appointment as Guest (Priority: P1)

The public website posts a booking (name, phone, gender, condition, service, branch, date, time). The method creates or reuses a Patient and inserts a Patient Appointment so staff can find the request in Desk. No API token is required.

**Why this priority**: Booking is the primary conversion path. Token-based inserts fail when a website key is rotated or the browser role cannot write clinical records.

**Independent Test**: Guest POST with valid fields returns `{name, status, …}` and a Patient Appointment exists. Repeat without Authorization.

**Acceptance Scenarios**:

1. **Given** valid name, phone, gender, condition, service, branch, date, and time, **When** the method is called with no Authorization, **Then** a Patient Appointment is inserted and its name is returned.
2. **Given** a Patient already exists with that mobile number, **When** the method is called, **Then** that Patient is reused (no duplicate Patient for the same mobile).
3. **Given** optional email, insurance, notes, language, and service unit, **When** they are passed, **Then** they are stored on the Patient and/or Appointment notes so staff can read them.

---

### User Story 2 - Reject invalid booking writes (Priority: P1)

Missing required fields, a Friday date, a past date, or an implausible email must not create an appointment. The response is a validation error, not a silent success.

**Why this priority**: Bad rows in Desk and silent inserts undermine staff trust.

**Independent Test**: Call without phone; call with a Friday date; no new Appointment.

**Acceptance Scenarios**:

1. **Given** name, phone, gender, date, or time is missing, **When** the method is called, **Then** no Appointment is created and a validation error is returned.
2. **Given** the date is a Friday or in the past, **When** the method is called, **Then** no Appointment is created and a validation error is returned.
3. **Given** email is present but not a plausible address, **When** the method is called, **Then** no Appointment is created and a validation error is returned.

---

### User Story 3 - Stable public error kinds (Priority: P1)

Public website methods (enquiry write, booking write, catalog lists, booking-option lists) distinguish **validation**, **rate-limit**, and **unexpected server** failures. Empty catalog lists remain `[]`. Guest callers do not receive HTML stack traces.

**Why this priority**: The website maps each kind to bilingual recovery copy. Mixed shapes force the site to guess.

**Independent Test**: Missing phone on enquiry and booking → validation. Exceed rate limit → 429. Empty catalog → `[]`.

**Acceptance Scenarios**:

1. **Given** a validation failure, **When** a guest method is called, **Then** the error is marked as validation (not a rate-limit and not a generic 200).
2. **Given** abusive traffic above the write limit, **When** another write is attempted, **Then** the response is a rate-limit (HTTP 429).
3. **Given** no matching catalog rows, **When** a list method is called, **Then** the result is an empty list, not an error.

---

### User Story 4 - Rate-limit website booking writes (Priority: P2)

Booking writes are rate-limited at least as strictly as enquiry writes (10 per 60 seconds). Legitimate single guest posts still succeed under the limit.

**Why this priority**: Guest appointment create is a write against clinical records.

**Independent Test**: One valid guest booking succeeds. A burst above the limit is rejected with 429 and does not insert extra appointments.

**Acceptance Scenarios**:

1. **Given** a valid guest booking under the limit, **When** the method is called, **Then** it succeeds.
2. **Given** more than 10 writes in 60 seconds from the same client, **When** another write is attempted, **Then** it is rate-limited.

---

### Edge Cases

- Friday is clinic-closed: validation, no insert.
- Past calendar dates: validation, no insert.
- Unknown or missing Appointment Type / active Practitioner / Company: server error after attempting existing records; do not invent a new DocType.
- Gender must match an existing Gender master (Male/Female as used by the website).
- Service unit id, when provided, is stored when it exists; unknown id is omitted rather than failing the whole insert if the appointment can still be created for a practitioner.
- Token MAY still work; it MUST NOT be required.
- Enquiry `create_enquiry` keeps existing validation messages and 10/60s limit; it MUST set the same validation title/kind as booking writes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `healthcare.healthcare.api.website_booking.create_appointment` MUST create a Patient Appointment from website booking fields using existing Patient and Patient Appointment records.
- **FR-002**: The method MUST succeed for Guest with no Authorization header, MUST ignore DocType permissions for the insert, and MUST be rate-limited at 10 requests per 60 seconds.
- **FR-003**: Required fields: patient name, phone, gender (Male/Female), condition, service, branch, appointment date, appointment time. Optional: email, insurance, notes, language, service unit.
- **FR-004**: Missing required fields, Friday dates, past dates, and implausible email MUST throw a validation error and MUST NOT insert an Appointment.
- **FR-005**: Public website methods MUST label failures as `validation`, `rate_limit` (HTTP 429), or `server_error`. Empty lists MUST remain `[]`.
- **FR-006**: Guest responses MUST NOT include HTML stack traces. Messages MUST be short and staff-safe.
- **FR-007**: No new DocTypes. Seed, if any, only ensures masters the insert already needs (Appointment Type, Gender) via a site helper — not a core patch to insert marketing data.
- **FR-008**: Patient is reused by mobile number when one exists.
- **FR-009**: Visitor extras (condition, service, branch, insurance, language, notes) MUST be readable by staff on the Appointment notes (and Patient email when valid).

### Key Entities

- **Patient**: first name, last name, sex (Gender), mobile, optional email.
- **Patient Appointment**: appointment type, practitioner, company, date, time, optional service unit, notes.
- **Error kind**: `validation` | `rate_limit` | `server_error`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A valid guest booking insert returns in under 2 seconds on the local site.
- **SC-002**: 100% of scripted missing-field and Friday-date calls create zero Appointments.
- **SC-003**: 100% of validation failures are distinguishable from HTTP 429.
- **SC-004**: Empty catalog methods still return an empty list (not an error page) in 100% of empty-clinic checks.
- **SC-005**: A single legitimate guest booking under the rate limit succeeds in 100% of scripted tests.

## Assumptions

- Existing Healthcare Patient and Patient Appointment DocTypes are the system of record.
- Appointment Type, an active Healthcare Practitioner, Company, and Gender (Male/Female) already exist on the Abu Zahra site (same masters the website token path used).
- Enquiry write already exists; this slice aligns its error kind labeling, not its Lead mapping.
- The website, not this API, implements the 12-second abort and bilingual recovery copy.

## Scope Boundaries

### In scope

- Guest `create_appointment` in the Healthcare app.
- Shared error-kind helper used by booking writes and aligned on enquiry writes and list methods.
- Rate limit on booking writes.

### Out of scope

- Payments, claims, or a new appointment DocType.
- Changing catalog list shapes (`{id,label}` and doctor/payor payloads stay).
- Website UI copy (Front-End slice).
- Installing the clinic server.
