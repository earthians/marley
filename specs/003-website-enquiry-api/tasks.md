# Tasks: Website Enquiry API

**Input**: Design documents from `/specs/003-website-enquiry-api/`

**Tests**: Not requested. Validation is [quickstart.md](./quickstart.md).

## Phase 1: Setup

- [x] T001 Confirm `healthcare/healthcare/api/clinic_catalog.py` guest + rate_limit + ignore_permissions pattern to copy in `healthcare/healthcare/api/website_enquiry.py`

---

## Phase 2: Foundational

- [x] T002 Create idempotent `Helper_codes/Seeding/seed_website_enquiry.py` for UTM Source rows Website Contact and Website Medical Tourism

**Checkpoint**: Sources can exist before the first guest post

---

## Phase 3: User Story 1 - Create a contact lead (Priority: P1) 🎯 MVP

- [x] T003 [US1] Implement `create_enquiry` in `healthcare/healthcare/api/website_enquiry.py` (guest, rate_limit 10/60, ignore_permissions, map `website-contact` → Website Contact)

**Checkpoint**: Guest POST with name and phone creates a Lead

---

## Phase 4: User Story 2 - Create a medical-tourism lead (Priority: P1)

- [x] T004 [US2] Map `website-medical-tourism` → Website Medical Tourism and store country, condition, dates on the Lead note in `healthcare/healthcare/api/website_enquiry.py`

---

## Phase 5: User Story 3 - Reject invalid enquiries (Priority: P1)

- [x] T005 [US3] Reject missing name/phone and implausible email without inserting a Lead in `healthcare/healthcare/api/website_enquiry.py`

---

## Phase 6: User Story 4 - Seed UTM sources (Priority: P2)

- [x] T006 [US4] Ensure `create_enquiry` can create missing UTM Source rows so a fresh site still inserts, while the seed remains the documented setup path

---

## Phase 7: Polish

- [x] T007 Run seed + [quickstart.md](./quickstart.md) guest POSTs on `senlite.localhost` if the bench is available

---

## Dependencies

- T001 before T003
- T002 can run in parallel with T003
- T004/T005 extend T003 in the same file (sequential after T003)

## Implementation Strategy

Seed sources, implement the method with validation, then curl as Guest.

## Verification (2026-08-26)

All T001–T007 remain complete. `create_enquiry` inserts CRM Leads with UTM Source Website Contact / Website Medical Tourism. Missing phone is rejected. Tourism extras persist on the Lead note. Seed created the two UTM Source rows. No new unchecked tasks.
