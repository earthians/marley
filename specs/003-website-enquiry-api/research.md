# Research: Website Enquiry API

**Feature**: `003-website-enquiry-api`  
**Date**: 2026-08-26

## Decision: CRM Lead, not a new Healthcare DocType

**Rationale**: Clarification + constitution II. Staff already have Lead list. UTM Source distinguishes Contact vs Medical Tourism (`utm_source` replaced the old Lead `source` field).

**Alternatives considered**: New Website Enquiry DocType (rejected). Opportunity (too far down the funnel). Patient comment only (not a staff enquiry list).

## Decision: Stricter rate limit than catalog (10 / 60 seconds)

**Rationale**: Catalog reads are 60/minute. Writes create documents. 10/minute still allows real visitors and blocks naive spam.

**Alternatives considered**: Same 60/minute as catalog (weaker). Token-only (rejected — stale key).

## Decision: Store visitor notes via Lead `add_note` / comment, not the `notes` string

**Rationale**: Lead.`notes` is a CRM Note child table. Putting a string there would error. Country that does not match Country master also goes in the note so insert does not fail.

**Alternatives considered**: Custom fields on Lead (rejected — constitution II / YAGNI). `utm_content` only (too short).

## Decision: Duplicate email must not block a new Lead

**Rationale**: CRM Settings may disallow duplicate `email_id`. Enquiries from the same family email must still be staff-visible. If uniqueness would throw, store email in the note and insert without `email_id`.

**Alternatives considered**: Fail the request (rejected — visitor would think the form vanished). Change CRM Settings globally (out of scope).

## Decision: Seed UTM Source rows, not fixtures in Healthcare

**Rationale**: Constitution IV. Sources are site-specific labels.

**Alternatives considered**: Create UTM Source inside `create_enquiry` on every call (works, but hides missing setup; seed makes Desk review obvious).
