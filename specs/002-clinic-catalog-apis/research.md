# Research: Clinic Catalog APIs

**Feature**: `002-clinic-catalog-apis`  
**Date**: 2026-08-26

## Decision: New `clinic_catalog.py`, do not change booking_catalog signatures

**Rationale**: Booking needs `{id,label}` only. Catalog pages need doctor profiles and payor categories. Shared identity rules for branches/services (parented HSU groups; enabled Therapy Types).

**Alternatives considered**: Expand `booking_catalog.get_branches` with extra fields (rejected — would surprise `/book`). Use `frappe.client.get_list` (rejected — website role often cannot read DocTypes; wrong insurance DocType).

## Decision: Text fields on Practitioner, not child tables

**Rationale**: Constitution II/V — no new DocTypes for catalog lists. Newline-separated certifications, expertise, languages, and branch labels can round-trip to the website as arrays.

**Alternatives considered**: Child DocTypes for certifications (richer Desk UX, extra migrate/fixtures; rejected for this slice).

## Decision: Reuse `show_in_portal` as the public-doctors flag

**Rationale**: Field already exists on Healthcare Practitioner. Seed sets it on the seven published doctors; booking placeholder stays off-portal.

**Alternatives considered**: New `show_on_website` check (redundant).

## Decision: Add `website_category` and `show_on_website` on Insurance Payor

**Rationale**: Marley Payor has no public tab category. Claims account tables stay as-is; seed uses `ignore_mandatory` so partners can exist without a full claims setup.

**Alternatives considered**: New Website Partner DocType (rejected — constitution II).

## Decision: Match booking_catalog auth pattern (`allow_guest=True` + rate_limit)

**Rationale**: Shipped booking catalog already uses guest + 60/min so the Vite proxy can call methods without a token. Spec 001 said no guest; implementation that visitors already depend on wins. Website catalog pages MUST omit Authorization because a stale token 401s even on guest methods.

**Alternatives considered**: Token-only (would break the same website path booking uses).

## Decision: Label Practitioner `show_in_portal` as **Show on Website** on the Website Profile tab

**Rationale**: Operators adding a doctor in Desk missed the old “Show in Portal” checkbox on the first tab. Same field; clearer label and placement.

**Alternatives considered**: New `show_on_website` check on Practitioner (redundant with `show_in_portal`).
