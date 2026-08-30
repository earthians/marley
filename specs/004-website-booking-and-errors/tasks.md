# Tasks: Website Booking Write and Public Error Contract

**Input**: Design documents from `/specs/004-website-booking-and-errors/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not requested. Validation is [quickstart.md](./quickstart.md).

## Phase 1: Setup

- [x] T001 Confirm Healthcare API package path `healthcare/healthcare/api/` exists for new modules

---

## Phase 2: Foundational

- [x] T002 Add shared `throw_validation` / `throw_server_error` helpers in `healthcare/healthcare/api/website_errors.py`

---

## Phase 3: User Story 1 - Create a website appointment as Guest (Priority: P1)

**Goal**: Guest POST creates Patient Appointment without Authorization

**Independent Test**: curl without token returns appointment name; Desk shows the row

- [x] T003 [US1] Implement `create_appointment` in `healthcare/healthcare/api/website_booking.py` (guest, 10/60s, ignore_permissions, reuse Patient by mobile)

---

## Phase 4: User Story 2 - Reject invalid booking writes (Priority: P1)

**Goal**: Missing fields, Friday, past date, bad email do not insert

**Independent Test**: Omit phone; Friday date; no new Appointment

- [x] T004 [US2] Validate required fields, Friday, past dates, and email in `healthcare/healthcare/api/website_booking.py`

---

## Phase 5: User Story 3 - Stable public error kinds (Priority: P1)

**Goal**: validation vs 429 vs server_error; empty lists stay `[]`

**Independent Test**: Missing phone on enquiry and booking → title `validation`; empty catalog → `[]`

- [x] T005 [US3] Point enquiry `frappe.throw` calls at `title="validation"` via `website_errors` in `healthcare/healthcare/api/website_enquiry.py`
- [x] T006 [P] [US3] Ensure catalog list methods still return `[]` when empty in `healthcare/healthcare/api/clinic_catalog.py`
- [x] T007 [P] [US3] Ensure booking-option list methods still return `[]` when empty in `healthcare/healthcare/api/booking_catalog.py`

---

## Phase 6: User Story 4 - Rate-limit booking writes (Priority: P2)

**Goal**: 10 requests / 60 seconds on `create_appointment`

- [x] T008 [US4] Apply `@rate_limit(limit=10, seconds=60)` on `create_appointment` in `healthcare/healthcare/api/website_booking.py`

---

## Phase 7: Polish

- [x] T009 Run [quickstart.md](./quickstart.md) guest create and validation on `senlite.localhost`

## Dependencies

- T002 before T003–T005
- T003 before T004/T008 (same file; sequential)
- T006–T007 parallel

## Implementation strategy

MVP: helper + guest `create_appointment` + validation. Then align enquiry titles. Rate limit is on the same method decorator.
