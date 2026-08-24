# Feature Specification: Booking Catalog APIs

**Feature Branch**: `001-booking-catalog-apis`

**Created**: 2026-08-24

**Status**: Draft

**Input**: User description: "Expose Condition, Service, and Branch options from existing Healthcare records through APIs inside the Healthcare app. Independent lists. Used by the website booking wizard."

## Clarifications

### Session 2026-08-24 (revised)

- Q1: Live data on booking wizard only; options come from the back-end.
- Q2: APIs live **inside the Healthcare app** (not a custom app).
- Q3: Condition, Service, and Branch lists are **independent**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - List concerns (Priority: P1)

The website needs the current Complaint names for the Condition step.

**Independent Test**: Authenticated GET/POST of the conditions method returns `{id, label}` rows from Complaint.

**Acceptance Scenarios**:

1. **Given** Complaint records exist, **When** the method is called with a valid API token, **Then** each row has `id` and `label`.
2. **Given** no token, **When** the method is called, **Then** it is rejected.
3. **Given** a new Complaint in Desk, **When** the method is called again, **Then** the new name is included.

### User Story 2 - List treatment types (Priority: P1)

The website needs enabled Therapy Type names for the Service step.

**Independent Test**: Services method returns enabled Therapy Types only, with no condition argument.

**Acceptance Scenarios**:

1. **Given** enabled Therapy Types, **When** the method is called, **Then** those names are returned.
2. **Given** a disabled Therapy Type, **When** the method is called, **Then** it is omitted.
3. **Given** any or no condition, **When** the method is called, **Then** the list is the same.

### User Story 3 - List clinic locations (Priority: P1)

The website needs bookable location names, not the company-wide Healthcare Service Unit root.

**Independent Test**: Branches method returns group units that have a parent, excluding the root.

**Acceptance Scenarios**:

1. **Given** branch group units under the company root, **When** the method is called, **Then** those location names are returned.
2. **Given** the root "All Healthcare Service Units" unit, **When** the method is called, **Then** it is omitted.

### Edge Cases

- Empty catalog returns `[]`.
- Website API user may lack DocType read permission; methods still return rows.

## Requirements *(mandatory)*

- **FR-001**: `healthcare.healthcare.api.booking_catalog.get_conditions` MUST return Complaint `{id, label}` ordered by label.
- **FR-002**: `healthcare.healthcare.api.booking_catalog.get_services` MUST return enabled Therapy Type `{id, label}` ordered by label.
- **FR-003**: `healthcare.healthcare.api.booking_catalog.get_branches` MUST return Healthcare Service Unit groups with a parent as `{id, label}` ordered by label.
- **FR-004**: Methods MUST require authentication (`@frappe.whitelist()`, no `allow_guest`).
- **FR-005**: Methods MUST NOT require a selected condition to list services.
- **FR-006**: Methods MUST ignore DocType permissions so the website token can read catalog rows.
- **FR-007**: No new DocTypes. Existing Healthcare records only.

### Key Entities

- Complaint (`complaints`)
- Therapy Type (`therapy_type`, `disabled`)
- Healthcare Service Unit (`healthcare_service_unit_name`, `is_group`, `parent_healthcare_service_unit`)

## Success Criteria *(mandatory)*

- **SC-001**: Token-authenticated calls return JSON `{id, label}` arrays in under 2 seconds on the local site.
- **SC-002**: Unauthenticated calls do not return catalog rows.
- **SC-003**: Adding a Complaint in Desk makes it appear on the next conditions call without a code change.
- **SC-004**: Disabled Therapy Types never appear in services.

## Assumptions

- Site: `senlite.localhost` at `http://senlite.localhost:8000/`
- Token from `frappe_api_keys.csv`
- Catalog is seeded on the site so the website is not empty; seed is a one-off site script, not a Healthcare core patch
