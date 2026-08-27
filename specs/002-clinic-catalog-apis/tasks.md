# Tasks: Clinic Catalog APIs

**Input**: Design documents from `/specs/002-clinic-catalog-apis/`

**Tests**: Not requested. Validation is [quickstart.md](./quickstart.md).

## Phase 1: Setup

- [x] T001 Confirm `healthcare/healthcare/api/booking_catalog.py` pattern (whitelist, rate_limit, ignore_permissions) to copy in `healthcare/healthcare/api/clinic_catalog.py`

---

## Phase 2: Foundational

- [x] T002 Add website profile fields to `healthcare/healthcare/doctype/healthcare_practitioner/healthcare_practitioner.json`
- [x] T003 [P] Add `website_category` and `show_on_website` to `healthcare/healthcare/doctype/insurance_payor/insurance_payor.json`

**Checkpoint**: DocTypes ready for migrate

---

## Phase 3: User Story 1 - List public doctors (Priority: P1) 🎯 MVP

- [x] T004 [US1] Implement `get_doctors` in `healthcare/healthcare/api/clinic_catalog.py` (Active + show_in_portal, split text lists, optional specialty/branch filters)

**Checkpoint**: Doctors method callable after migrate + seed

---

## Phase 4: User Story 2 - List branch and service identities (Priority: P1)

- [x] T005 [P] [US2] Implement `get_branches` in `healthcare/healthcare/api/clinic_catalog.py`
- [x] T006 [P] [US2] Implement `get_services` in `healthcare/healthcare/api/clinic_catalog.py`

---

## Phase 5: User Story 3 - List public insurance payors (Priority: P1)

- [x] T007 [US3] Implement `get_insurance_payors` in `healthcare/healthcare/api/clinic_catalog.py`

---

## Phase 6: User Story 4 - Seed clinic catalog rows (Priority: P2)

- [x] T008 [US4] Create idempotent `Helper_codes/Seeding/seed_clinic_catalog.py` for seven doctors, payors with categories, and missing branches/services
- [x] T009 [US4] Reuse booking branch/service identity rules so names stay aligned with `Helper_codes/Seeding/seed_booking_catalog.py`

---

## Phase 7: Polish

- [x] T010 Run migrate + seed + [quickstart.md](./quickstart.md) method calls on `senlite.localhost` if the bench is available

---

## Dependencies

- T002 before T004/T008 (doctor fields)
- T003 before T007/T008 (payor fields)
- T005/T006 parallel after T001

## Implementation Strategy

Migrate fields first, then methods, then seed, then curl/execute checks.

## Verification (2026-08-26)

All T001–T010 remain complete. Guest `get_doctors` / `get_insurance_payors` and Desk **Show on Website** match the updated spec. No new unchecked tasks.
