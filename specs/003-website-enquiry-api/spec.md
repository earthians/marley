# Feature Specification: Website Enquiry API

**Feature Branch**: `003-website-enquiry-api`

**Created**: 2026-08-26

**Status**: Implemented (verified 2026-08-26)

**Input**: Public website User Story 4 — send a contact or medical-tourism enquiry. Clarifications from 2026-08-26.

## Clarifications

### Session 2026-08-26

- Q: Where do staff find the enquiry? → A: **CRM Lead** (existing ERPNext record). No new enquiry DocType.
- Q: How is Contact vs Medical Tourism distinguished? → A: **UTM Source** rows `Website Contact` and `Website Medical Tourism`.
- Q: Must the website send an API token? → A: **No.** The method MUST succeed as Guest with no Authorization (stricter rate limit than catalog reads). Token MAY still work.
- Q: Which fields are stored? → A: Required name and phone. Contact also optional email and notes. Medical Tourism also optional country, condition, and preferred dates.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a contact lead (Priority: P1)

The website posts a Contact enquiry. The method creates a CRM Lead with UTM Source Website Contact so staff can open it in Desk.

**Independent Test**: Guest POST with name and phone returns `{name, source, status}` and a Lead exists.

**Acceptance Scenarios**:

1. **Given** valid name and phone, **When** the method is called with source contact, **Then** a Lead is inserted and its UTM Source is Website Contact.
2. **Given** optional email and notes, **When** they are passed, **Then** they are stored on that Lead (email on the Lead; notes as a staff-visible note/comment).
3. **Given** no Authorization header, **When** the method is called, **Then** it still succeeds (rate limits apply).

---

### User Story 2 - Create a medical-tourism lead (Priority: P1)

The website posts a Medical Tourism enquiry. The method creates a CRM Lead with UTM Source Website Medical Tourism, including extras when provided.

**Independent Test**: Guest POST with name, phone, country, condition, and dates creates a Lead staff can distinguish from Contact.

**Acceptance Scenarios**:

1. **Given** valid name and phone and source medical-tourism, **When** the method is called, **Then** a Lead is inserted with UTM Source Website Medical Tourism.
2. **Given** country, condition, and dates, **When** they are passed, **Then** staff can read them on that Lead.

---

### User Story 3 - Reject invalid enquiries (Priority: P1)

Missing name or phone does not create a Lead. Implausible email does not create a Lead.

**Independent Test**: Call the method without phone; no new Lead; validation error.

**Acceptance Scenarios**:

1. **Given** name or phone is missing, **When** the method is called, **Then** no Lead is created and a validation error is returned.
2. **Given** email is present but not a plausible address, **When** the method is called, **Then** no Lead is created and a validation error is returned.

---

### User Story 4 - Seed UTM sources (Priority: P2)

A site helper ensures the two UTM Source rows exist so Lead insert does not fail on a missing Source.

**Independent Test**: Running the seed twice does not duplicate UTM Source rows.

**Acceptance Scenarios**:

1. **Given** the sources are missing, **When** the seed runs, **Then** Website Contact and Website Medical Tourism exist.
2. **Given** they already exist, **When** the seed runs again, **Then** it does not create duplicates.

### Edge Cases

- Duplicate visitor email: a new Lead MUST still be created (do not fail uniqueness); email MAY be stored on the Lead or in the note if CRM uniqueness would block insert.
- Country text that does not match a Country master: still store the visitor’s country text on the Lead note rather than failing the insert.
- Language `en` / `ar`: store when a matching Language exists; otherwise omit without failing.
- Abusive traffic: rate-limited; legitimate guest posts still succeed under the limit.

## Requirements *(mandatory)*

- **FR-001**: `healthcare.healthcare.api.website_enquiry.create_enquiry` MUST insert a CRM Lead with required first/full name and mobile number.
- **FR-002**: `source` MUST be `website-contact` or `website-medical-tourism` and MUST map to UTM Source **Website Contact** or **Website Medical Tourism**.
- **FR-003**: Optional `email_id` and `notes` MUST be accepted for contact. Optional `country`, `condition`, and `dates` MUST be accepted for medical tourism (and MAY be accepted on either source).
- **FR-004**: Missing name or phone MUST throw a validation error and MUST NOT insert a Lead.
- **FR-005**: The method MUST succeed for Guest with no Authorization header, MUST be rate-limited more strictly than catalog reads (catalog is 60/minute), and MUST ignore DocType permissions for this insert. Token auth MAY still work and MUST NOT be required.
- **FR-006**: No new DocType for website enquiries. Existing Lead and UTM Source only.
- **FR-007**: An idempotent site seed under `Helper_codes/Seeding/` MUST ensure the two UTM Source rows exist. It MUST NOT be a Healthcare core patch that inserts Abu Zahra marketing data into every site.
- **FR-008**: Success JSON MUST include the Lead `name`, mapped `source`, and `status` so the website can show a reference.

### Key Entities

- CRM Lead (`first_name` / `lead_name`, `mobile_no`, optional `email_id`, `utm_source`, `status`, staff-visible note)
- UTM Source (`Website Contact`, `Website Medical Tourism`)

## Success Criteria *(mandatory)*

- **SC-001**: Guest POST of a valid contact enquiry returns a Lead id in under 2 seconds on the local site.
- **SC-002**: Unauthenticated abusive traffic is rate-limited; a single valid guest enquiry still succeeds.
- **SC-003**: Staff opening Lead list can tell Website Contact from Website Medical Tourism without reading the note.
- **SC-004**: Missing phone never creates a Lead.
- **SC-005**: Re-running the seed does not duplicate UTM Source rows.

## Assumptions

- Site: `senlite.localhost` at `http://senlite.localhost:8000/`
- ERPNext CRM Lead is already installed with the site
- Catalog and booking methods remain unchanged
- Lead `notes` is a child table; visitor free text is stored via Lead note/comment, not a string field named `notes`

## Scope Boundaries

### In scope

- One whitelist method in `healthcare/healthcare/api/website_enquiry.py`
- Idempotent UTM Source seed
- Validation of name, phone, and optional email

### Out of scope

- Appointment / Patient creation
- New Healthcare DocTypes
- Changing catalog or booking catalog signatures
- Installing or administering the clinic server
