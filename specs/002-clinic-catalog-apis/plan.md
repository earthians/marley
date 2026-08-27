# Implementation Plan: Clinic Catalog APIs

**Branch**: `002-clinic-catalog-apis` | **Date**: 2026-08-26 | **Spec**: [spec.md](./spec.md)

## Summary

Extend Healthcare Practitioner and Insurance Payor for public website fields. Add `clinic_catalog.py` whitelist methods. Seed Abu Zahra doctors and payors from a site helper script.

## Technical Context

**Language/Version**: Python 3 / Frappe

**Primary Dependencies**: Healthcare DocTypes on `senlite.localhost`; same whitelist/rate-limit pattern as `booking_catalog.py`

**Storage**: Existing DocTypes plus new fields on Practitioner and Insurance Payor

**Testing**: `bench execute` / token HTTP; seed idempotency by running twice

**Target Platform**: Frappe site `senlite.localhost`

**Project Type**: Frappe app (Healthcare)

**Performance Goals**: List methods under 2 seconds locally (SC-001)

**Constraints**: No custom app; no new top-level catalog DocTypes; seed is a helper script; `ignore_permissions=True`; rate limit guest/token like booking catalog

**Scale/Scope**: Four list methods; ~7 public doctors; ~80 insurance payors; 3 branches; 4 therapy types

## Constitution Check

- I. APIs in Healthcare app — `clinic_catalog.py`
- II. Existing records only — field additions, no new list DocTypes
- III. Website-safe methods — guest without token MUST succeed; ignore permissions; rate limit
- IV. Seed is a site helper — `Helper_codes/Seeding/seed_clinic_catalog.py`
- V. Simplicity — newline text fields instead of new child DocTypes for certs/expertise

**Gate result (pre-research)**: PASS

**Gate result (post-design)**: PASS — extending Practitioner/Payor is required by clarification Q2/Q1 and is not a new catalog DocType

**Gate result (verification 2026-08-26)**: PASS — `get_doctors` / `get_insurance_payors` succeed as Guest; Desk **Show on Website** maps to `show_in_portal` / `show_on_website`

## Project Structure

```text
healthcare/healthcare/doctype/healthcare_practitioner/healthcare_practitioner.json
healthcare/healthcare/doctype/insurance_payor/insurance_payor.json
healthcare/healthcare/api/clinic_catalog.py
Helper_codes/Seeding/seed_clinic_catalog.py
specs/002-clinic-catalog-apis/
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Extra fields on Practitioner/Payor | Q2/Q1: website doctors and payors must come from clinic records | Overlay-only doctors/payors rejected by the user |
