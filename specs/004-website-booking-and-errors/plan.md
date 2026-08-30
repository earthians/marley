# Implementation Plan: Website Booking Write and Public Error Contract

**Branch**: `004-website-booking-and-errors` | **Date**: 2026-08-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-website-booking-and-errors/spec.md`

## Summary

Add a guest, rate-limited Healthcare method that inserts Patient + Patient Appointment for website booking, and label public method failures as `validation`, `rate_limit`, or `server_error` so the website can recover without stack traces.

## Technical Context

**Language/Version**: Python 3 as used by the Frappe bench (`senlite.localhost`)

**Primary Dependencies**: Frappe whitelist + rate_limit; Healthcare Patient and Patient Appointment

**Storage**: Site database Patient + Patient Appointment

**Testing**: `bench execute` / guest HTTP POST; [quickstart.md](./quickstart.md)

**Target Platform**: Frappe site `senlite.localhost`

**Project Type**: Healthcare app API slice inside Marley Health

**Performance Goals**: Valid guest insert returns in under 2 seconds locally (SC-001)

**Constraints**: Existing records only; guest without token; 10/60s write limit; ignore_permissions; Friday and past dates rejected

**Scale/Scope**: One booking write method, shared error helper, enquiry throws aligned to `validation` title

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- I. APIs live in the Healthcare app — `healthcare/healthcare/api/website_booking.py`
- II. Existing records only — Patient + Patient Appointment
- III. Website-safe catalog methods — unchanged list shapes; empty `[]`
- IV. Seed is a site helper — optional Gender/Appointment Type check only if needed
- V. Simplicity — one write method, shared error helper
- VI. Website-safe enquiry writes — align throw title to `validation`
- VII. Website-safe booking writes — guest, 10/60s, ignore_permissions
- VIII. Stable public error kinds — `validation` / `rate_limit` / `server_error`

**Gate result (pre-research)**: PASS

**Gate result (post-design)**: PASS — no new DocType; notes on Appointment carry website extras; Gender is existing master

## Project Structure

### Documentation (this feature)

```text
specs/004-website-booking-and-errors/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── website-booking.md
└── checklists/
    └── requirements.md
```

### Source Code

```text
healthcare/healthcare/api/website_errors.py
healthcare/healthcare/api/website_booking.py
healthcare/healthcare/api/website_enquiry.py
healthcare/healthcare/api/clinic_catalog.py
healthcare/healthcare/api/booking_catalog.py
```

## Phase 0 — Research

Completed in [research.md](./research.md).

## Phase 1 — Design & Contracts

Completed:

- [data-model.md](./data-model.md)
- [contracts/website-booking.md](./contracts/website-booking.md)
- [quickstart.md](./quickstart.md)
