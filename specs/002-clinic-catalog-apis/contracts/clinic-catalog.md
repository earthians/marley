# Contract: Clinic catalog APIs

**Provider**: Healthcare app  
**Base**: `/api/method/healthcare.healthcare.api.clinic_catalog.{method}`  
**Auth**: Guest (no Authorization) MUST succeed; token MAY succeed; `@rate_limit(limit=60, seconds=60)`; `ignore_permissions=True`

## `get_doctors`

Optional JSON: `{ "specialty": string, "branch": string }`

Response `message`: array of `{ id, name, credentials, role, specialty, bio, languages, certifications, expertise, branches, image }`.

Filters: Active + `show_in_portal` (Desk label **Show on Website**). Specialty matches `website_specialty`. Branch matches a line in `website_branches`.

## `get_branches`

Response: `[{ id, label }]` — parented Healthcare Service Unit groups, excluding the company root.

## `get_services`

Response: `[{ id, label }]` — Therapy Type with `disabled=0`.

## `get_insurance_payors`

Optional JSON: `{ "category": "insurance"|"healthcare"|"special"|"bank" }`

Response: `[{ id, label, category }]` — `disabled=0` and `show_on_website=1`.
