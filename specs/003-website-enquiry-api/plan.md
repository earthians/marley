# Implementation Plan: Website Enquiry API

**Branch**: `003-website-enquiry-api` | **Date**: 2026-08-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-website-enquiry-api/spec.md`

## Summary

Add a guest, rate-limited Healthcare method that inserts an ERPNext CRM Lead for Contact and Medical Tourism, distinguished by UTM Source. Seed those two sources. No new DocType.

## Technical Context

**Language/Version**: Python 3 as used by the Frappe bench (`senlite.localhost`)

**Primary Dependencies**: Frappe whitelist + rate_limit; ERPNext CRM Lead; Frappe UTM Source

**Storage**: Site database Lead + UTM Source rows

**Testing**: `bench execute` / guest HTTP POST; [quickstart.md](./quickstart.md)

**Target Platform**: Frappe site `senlite.localhost`

**Project Type**: Healthcare app API slice inside Marley Health

**Performance Goals**: Valid guest insert returns in under 2 seconds locally (SC-001)

**Constraints**: Existing records only; guest without token; stricter rate limit than catalog (60/min); ignore_permissions on insert; validate name and phone

**Scale/Scope**: One method, two UTM Source rows, one seed script

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- I. APIs live in the Healthcare app — `healthcare/healthcare/api/website_enquiry.py`
- II. Existing records only — CRM Lead + UTM Source; no new DocType
- III. Website-safe catalog methods — unchanged
- IV. Seed is a site helper — `Helper_codes/Seeding/seed_website_enquiry.py`
- V. Simplicity — one method, mapped source strings
- VI. Website-safe enquiry writes — guest, stricter rate limit, ignore_permissions

**Gate result (pre-research)**: PASS

**Gate result (post-design)**: PASS — Lead.notes is a child table; visitor text uses add_note/comment rather than inventing a custom field

## Project Structure

### Documentation (this feature)

```text
specs/003-website-enquiry-api/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── website-enquiry.md
└── checklists/
    └── requirements.md
```

### Source Code

```text
healthcare/healthcare/api/website_enquiry.py
Helper_codes/Seeding/seed_website_enquiry.py
```

## Phase 0 — Research

Completed in [research.md](./research.md).

## Phase 1 — Design & Contracts

Completed:

- [data-model.md](./data-model.md)
- [contracts/website-enquiry.md](./contracts/website-enquiry.md)
- [quickstart.md](./quickstart.md)
