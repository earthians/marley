# Feature Specification: Clinic Catalog APIs

**Feature Branch**: `002-clinic-catalog-apis`

**Created**: 2026-08-26

**Status**: Implemented (verified 2026-08-26)

**Input**: Public website User Story 3 — doctors, branches, services, and insurance from clinic records. Clarifications from 2026-08-26.

## Clarifications

### Session 2026-08-26

- Q: Insurance coverage checker? → A: **Not in this slice.** List Insurance Payors for the public website. Website partner names MUST come from these records when connected.
- Q: Doctor profile source? → A: **Extend Healthcare Practitioner** in the Healthcare (Marley) app so it can store the public website profile (photo, bio, certifications, and other required fields). Doctors viewed on the website MUST come from these records.
- Q: Branch/service brochure copy? → A: **Identity from clinic; website overlays published marketing copy when names match.** APIs return names (and doctor full profiles). No new DocTypes for branch/service brochure tables.
- Q: Must the website send an API token to list public catalogs? → A: **No.** Methods MUST succeed as Guest with no Authorization (rate-limited). Token MAY still work. Desk flags: practitioners need Active + Show on Website; payors need not disabled + Show on Website.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - List public doctors (Priority: P1)

The website needs public practitioner profiles: name, photo, credentials, role, specialty, bio, certifications, expertise, languages, and branch names.

**Independent Test**: Guest POST of the doctors method (no Authorization) returns profile rows from Healthcare Practitioner records flagged Show on Website and Active.

**Acceptance Scenarios**:

1. **Given** public practitioners exist, **When** the method is called, **Then** each row includes identity and the public profile fields stored on the practitioner.
2. **Given** a practitioner is not flagged for the website or is Disabled, **When** the method is called, **Then** that practitioner is omitted.
3. **Given** optional specialty or branch filters, **When** they are passed, **Then** only matching public practitioners are returned.

---

### User Story 2 - List branch and service identities (Priority: P1)

The website needs current location names and enabled treatment-type names so catalog pages can overlay published brochure copy.

**Independent Test**: Branches and services methods return `{id, label}` (services may include a clinic description when present) from existing Healthcare Service Unit groups and enabled Therapy Types.

**Acceptance Scenarios**:

1. **Given** bookable location records exist, **When** branches is called, **Then** location names are returned and the company root unit is omitted.
2. **Given** enabled Therapy Types exist, **When** services is called, **Then** those names are returned; disabled types are omitted.

---

### User Story 3 - List public insurance payors (Priority: P1)

The website needs Insurance Payor names and a public category so Insurance tabs can be filled from the clinic.

**Independent Test**: Payors method returns enabled, website-visible Insurance Payors with category.

**Acceptance Scenarios**:

1. **Given** website Insurance Payors exist, **When** the method is called, **Then** each row has identity, display name, and category.
2. **Given** a payor is disabled or not flagged for the website, **When** the method is called, **Then** it is omitted.
3. **Given** an optional category filter, **When** it is passed, **Then** only that category is returned.

---

### User Story 4 - Seed clinic catalog rows (Priority: P2)

A site helper seeds the published doctors, three branches (if missing), treatment types (if missing), and insurance payors so catalog APIs are not empty on the local site.

**Independent Test**: Running the seed twice does not duplicate rows; doctors and payors then appear on the list methods.

**Acceptance Scenarios**:

1. **Given** an empty or partial site, **When** the seed runs, **Then** public practitioners matching the published website doctors exist with profile fields filled.
2. **Given** published insurance partner names, **When** the seed runs, **Then** Insurance Payors exist with the matching public category.
3. **Given** the seed is run again, **When** those names already exist, **Then** it does not create duplicates.

### Edge Cases

- Empty catalog returns `[]` (the website applies published fallback).
- Website API user may lack DocType read permission; methods still return rows.
- Practitioner photo may be empty; website may overlay a published image by name.

## Requirements *(mandatory)*

- **FR-001**: Healthcare Practitioner MUST store public website profile fields: photo (existing image), bio, credentials, role, specialty, languages, certifications, expertise, and branch names (or links), plus a flag that the record should appear on the public website.
- **FR-002**: Insurance Payor MUST store a public website category (insurance / healthcare / special / bank) and a flag that the record should appear on the public website.
- **FR-003**: `healthcare.healthcare.api.clinic_catalog.get_doctors` MUST return public, Active practitioners with the profile fields in FR-001, optionally filtered by specialty or branch, ordered by name.
- **FR-004**: `healthcare.healthcare.api.clinic_catalog.get_branches` MUST return bookable Healthcare Service Unit groups with a parent as `{id, label}` ordered by label (same identity rule as booking catalog).
- **FR-005**: `healthcare.healthcare.api.clinic_catalog.get_services` MUST return enabled Therapy Types as `{id, label}` ordered by label.
- **FR-006**: `healthcare.healthcare.api.clinic_catalog.get_insurance_payors` MUST return website-visible, non-disabled Insurance Payors as `{id, label, category}` ordered by label, optionally filtered by category.
- **FR-007**: Methods MUST succeed for Guest with no Authorization header (rate-limited) and MUST ignore DocType permissions for these reads. Token auth MAY still work and MUST NOT be required.
- **FR-008**: No new top-level catalog DocTypes. Practitioner and Payor field additions are allowed. Branch/service brochure tables are not added.
- **FR-009**: An idempotent site seed under `Helper_codes/Seeding/` MUST create/update the published doctors, payors, and any missing branch/service identities used by the website. It MUST NOT be a Healthcare core patch that inserts Abu Zahra data into every site.

### Key Entities

- Healthcare Practitioner (extended public profile fields, `show_in_portal` labeled **Show on Website**, `status`)
- Healthcare Service Unit (group locations with a parent)
- Therapy Type (`therapy_type`, `disabled`)
- Insurance Payor (`insurance_payor_name`, `disabled`, public category, website flag)

## Success Criteria *(mandatory)*

- **SC-001**: Token-authenticated catalog calls return JSON in under 2 seconds on the local site.
- **SC-002**: Unauthenticated abusive traffic is rate-limited; website catalog reads still succeed in the same way as the existing booking catalog methods.
- **SC-003**: Adding or editing a public practitioner in Desk (Active + Show on Website) makes the new profile appear on the next doctors call without a website code change.
- **SC-004**: Disabled Therapy Types and disabled/hidden payors never appear in services or insurance lists.
- **SC-005**: Re-running the seed does not duplicate doctors, branches, services, or payors.

## Assumptions

- Site: `senlite.localhost` at `http://senlite.localhost:8000/`
- Token from existing website API keys
- Booking catalog `{id, label}` methods remain for `/book`; clinic catalog methods serve the four public catalog pages
- Seed may use `ignore_mandatory` for Insurance Payor accounting tables so website partners can exist without a full claims setup
- Existing placeholder practitioner used for booking MAY remain hidden from the public doctors list

## Scope Boundaries

### In scope

- Practitioner and Insurance Payor field additions in the Healthcare app
- Four whitelist methods in `healthcare/healthcare/api/clinic_catalog.py`
- Idempotent `Helper_codes/Seeding/seed_clinic_catalog.py`

### Out of scope

- Insurance coverage / eligibility APIs
- New top-level DocTypes for a website-only partner directory
- Changing booking catalog method signatures
- Installing or administering the clinic server
