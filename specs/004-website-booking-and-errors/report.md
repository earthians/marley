# Implementation Report: Website Booking Write and Public Error Contract

**Date**: 2026-08-27  
**Feature**: `specs/004-website-booking-and-errors`  
**Pairs with**: Front-end `specs/005-graceful-recovery` (User Story 5)

## Summary

Guest `healthcare.healthcare.api.website_booking.create_appointment` creates Patient + Patient Appointment without an API token. Public failures are labeled `validation` (title), `rate_limit` (HTTP 429), or `server_error`. Enquiry validation throws were aligned to the same `validation` title.

## Spec Kit

Specify → clarify (2026-08-27 answers) → constitution v1.2.0 (VII, VIII) → plan → tasks T001–T009 → analyze → checklist `api.md` (unchecked) → implement → converge (no extra tasks). `/speckit-taskstoissues` not run.

## Verified on senlite.localhost

| Check | Result |
|-------|--------|
| Missing phone | ValidationError, no insert |
| Friday date | ValidationError, no insert |
| Past date | ValidationError, no insert |
| Valid guest create | `HLC-APP-2026-00005` |

## Source

- `healthcare/healthcare/api/website_errors.py`
- `healthcare/healthcare/api/website_booking.py`
- `healthcare/healthcare/api/website_enquiry.py`
