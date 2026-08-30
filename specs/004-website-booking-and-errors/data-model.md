# Data Model: Website Booking Write and Public Error Contract

**Feature**: `004-website-booking-and-errors`  
**Date**: 2026-08-27

## Patient (reuse or create)

| Field | Type | Rules |
|-------|------|--------|
| first_name | Data | Required; first token of `patient_name` |
| last_name | Data | Remainder of `patient_name` |
| sex | Link (Gender) | Required; `Male` or `Female` |
| mobile | Data | Required; reuse key |
| email | Data | Optional; validated if present |

## Patient Appointment (created)

| Field | Type | Rules |
|-------|------|--------|
| appointment_type | Link | First existing Appointment Type |
| appointment_for | Select | From appointment type (`Practitioner`) |
| practitioner | Link | First Active Healthcare Practitioner |
| company | Link | Default company |
| appointment_date | Date | Required; not Friday; not past |
| appointment_time | Time | Required |
| patient | Link | From reuse/create |
| service_unit | Link | Optional; set when the id exists |
| notes | Small Text | Website extras (condition, service, branch, insurance, language, visitor notes) |
| status | Select | Default Open/Scheduled as DocType default |

## Error kind

| Kind | How |
|------|-----|
| validation | `frappe.throw(..., title="validation")` |
| rate_limit | `@rate_limit` → HTTP 429 |
| server_error | Missing masters or unexpected failure; title `server_error` |

## Method arguments

| Arg | Required | Notes |
|-----|----------|--------|
| patient_name | yes | |
| patient_phone | yes | |
| patient_sex | yes | `Male` \| `Female` |
| condition | yes | Stored in notes |
| service | yes | Stored in notes |
| branch | yes | Stored in notes |
| appointment_date | yes | `YYYY-MM-DD` |
| appointment_time | yes | Website slot or `HH:MM:SS` |
| patient_email | no | |
| insurance_company | no | |
| notes | no | |
| language | no | `en` \| `ar` |
| service_unit | no | Healthcare Service Unit name |
| source | no | Default `website` |
