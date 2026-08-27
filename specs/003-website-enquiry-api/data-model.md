# Data Model: Website Enquiry API

**Feature**: `003-website-enquiry-api`  
**Date**: 2026-08-26

## CRM Lead (created)

| Field | Type | Rules |
|-------|------|--------|
| first_name | Data | Required; visitor full name |
| mobile_no | Data | Required |
| email_id | Data | Optional; validated if present |
| status | Select | `Lead` |
| utm_source | Link (UTM Source) | `Website Contact` or `Website Medical Tourism` |
| language | Link (Language) | Set when `en`/`ar` exists; else omit |
| country | Link (Country) | Set only when the visitor text matches a Country; else text goes in the note |

## Staff-visible note

Visitor notes, tourism condition, dates, unmatched country, and email-if-uniqueness-blocked are appended as a Lead note/comment so Desk users can read them without custom fields.

## UTM Source (seeded)

| Name | Slug |
|------|------|
| Website Contact | website-contact |
| Website Medical Tourism | website-medical-tourism |

## Method arguments

| Arg | Required | Notes |
|-----|----------|--------|
| source | yes | `website-contact` \| `website-medical-tourism` |
| lead_name | yes | |
| mobile_no | yes | |
| email_id | no | |
| notes | no | |
| language | no | `en` \| `ar` |
| country | no | |
| condition | no | |
| dates | no | |

## Relationships

```text
create_enquiry ──inserts──► Lead
Lead.utm_source ──links──► UTM Source
```
