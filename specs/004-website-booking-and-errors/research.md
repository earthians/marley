# Research: Website Booking Write and Public Error Contract

**Feature**: `004-website-booking-and-errors`  
**Date**: 2026-08-27

## Decision: Guest method in Healthcare, not browser `insertResource`

**Rationale**: Constitution VII. The website currently creates Patient and Patient Appointment with a token. Rotated keys 401; website roles often cannot insert those DocTypes.

**Alternatives considered**: Keep token REST inserts (rejected — user asked for guest booking write). Marley `create_website_appointment` (not deployed on this site).

## Decision: Reuse Patient by mobile; required Gender Male/Female

**Rationale**: Matches current website payload (`patient_sex`: Male/Female). Patient.sex is a Link to Gender. Missing Gender is a server error after lookup, not a new DocType.

**Alternatives considered**: Skip sex (Patient requires it). Free-text sex (rejected — Link field).

## Decision: First active Practitioner + first Appointment Type + default Company

**Rationale**: Same auto-assign approach the website token path used. Staff confirm by phone; the public form does not pick a doctor.

**Alternatives considered**: Require the website to send practitioner (rejected — booking wizard has no doctor step).

## Decision: Shared `website_errors.throw_validation` with title `validation`

**Rationale**: Frappe `rate_limit` already returns HTTP 429. Validation uses `frappe.throw(..., title="validation")`. Unexpected exceptions mapped to title `server_error` without HTML traceback in the message.

**Alternatives considered**: Custom HTTP 422 JSON body (more code; website already parses `_server_messages` + title).

## Decision: Friday and past dates rejected in the method

**Rationale**: Website already skips Friday in the picker; the API MUST still reject them so a crafted POST cannot create a closed-day row.

**Alternatives considered**: Trust the website only (rejected — guest endpoint).

## Decision: Do not wrap list methods in try/except that converts bugs to `[]`

**Rationale**: Empty clinic is `[]`. Unexpected programming errors SHOULD be 500/`server_error` so the website falls back. Swallowing exceptions would hide Desk misconfiguration.

**Alternatives considered**: Catch-all return `[]` (rejected — hides real failures; website already falls back on 5xx).
