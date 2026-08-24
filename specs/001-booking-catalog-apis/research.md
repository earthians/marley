# Research: Booking Catalog APIs

## Decision 1: Healthcare app, not custom app

**Decision**: Methods live in `healthcare.healthcare.api.booking_catalog`.

**Rationale**: Q2 = C. Custom app `abuzahraptc` was rolled back.

## Decision 2: Existing DocTypes

**Decision**: Complaint, Therapy Type (`disabled=0`), Healthcare Service Unit (`is_group=1` with parent).

## Decision 3: Token auth

**Decision**: `@frappe.whitelist()` without `allow_guest`, same as appointment create.

## Decision 4: Site seed, not a Healthcare patch

**Decision**: Seed clinic names via a one-off `bench execute` of an unwhitelisted helper so Healthcare core is not permanently patched with Abu Zahra labels.
