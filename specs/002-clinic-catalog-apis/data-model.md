# Data Model: Clinic Catalog APIs

**Feature**: `002-clinic-catalog-apis`  
**Date**: 2026-08-26

## Healthcare Practitioner (additions)

Existing: `practitioner_name`, `image`, `status`, `department`, `show_in_portal`, `first_name`, `last_name`.

| Field | Type | Rules |
|-------|------|--------|
| website_bio | Text | Public biography |
| website_credentials | Data | e.g. PT Consultant, DPT |
| website_role | Data | e.g. Chairman |
| website_specialty | Data | Filter key |
| website_languages | Small Text | Newline or comma separated |
| website_certifications | Text | One item per line |
| website_expertise | Text | One item per line |
| website_branches | Small Text | One branch label per line; must match public location labels |

**Public list filter**: `status = Active` AND `show_in_portal = 1` (Desk: **Show on Website** on the Website Profile tab).

## Insurance Payor (additions)

| Field | Type | Rules |
|-------|------|--------|
| website_category | Select | `insurance`, `healthcare`, `special`, `bank` |
| show_on_website | Check | Default 1 for seeded public partners |

**Public list filter**: `disabled = 0` AND `show_on_website = 1`.

## Healthcare Service Unit / Therapy Type

Unchanged. Branches: group units with a parent. Services: `disabled = 0`.

## Seed identities

- Seven published website doctors (names, profile text, branches, `show_in_portal=1`)
- Three branch labels already used by booking seed
- Four therapy type labels already used by booking seed
- Published insurance / healthcare / special / bank partner names as Insurance Payors
