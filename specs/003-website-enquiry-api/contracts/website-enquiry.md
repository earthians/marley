# Contract: Website enquiry (Healthcare method)

**Provider**: `healthcare.healthcare.api.website_enquiry.create_enquiry`  
**Transport**: HTTPS JSON (`/api/method/...`)  
**Auth**: Guest + rate limit (10 requests / 60 seconds). Token MAY work; MUST NOT be required.

**Request fields**: `source`, `lead_name`, `mobile_no`, optional `email_id`, `notes`, `language`, `country`, `condition`, `dates`.

**source mapping**:

| Request `source` | UTM Source name |
|------------------|-----------------|
| `website-contact` | Website Contact |
| `website-medical-tourism` | Website Medical Tourism |

Anything else → validation error, no Lead.

**Success**: `{ "name": "CRM-LEAD-...", "source": "website-contact", "status": "Lead" }` inside Frappe `message`.

**Validation errors**: missing `lead_name` or `mobile_no`; unknown `source`; implausible `email_id`.

**Permissions**: `insert(ignore_permissions=True)` so Guest can create Lead.

**Side effects**: Ensure UTM Source exists (seed preferred; method MAY create the row if missing so a fresh site still works). Append a staff-visible note for extras. Store `condition` on `utm_content` when that Lead field exists.

---

## List website enquiries (CRM overview)

**Provider**: `healthcare.healthcare.api.website_enquiry.list_enquiries`  
**Auth**: Guest + rate limit (30 requests / 60 seconds). Same guest rule as create: do not require a token.

**Request fields**: optional `limit` (1–100, default 50).

**Filter**: only Leads whose UTM Source is `Website Contact` or `Website Medical Tourism`.

**Success**: array of:

| Field | Meaning |
|-------|---------|
| `id` | Lead name (`CRM-LEAD-…`) |
| `name` | Display name |
| `source` | UTM Source label |
| `condition` | From `utm_content` or parsed from the CRM note |
| `branch` | Empty (website forms do not collect branch) |
| `creation` | Lead creation datetime |
| `status` | Dashboard key: `Lead`/`Open` → `new`; `Replied`/`Interested` → `contacted`; `Opportunity`/`Quotation`/`Lost Quotation` → `appointment`; `Converted` → `patient` |
| `erpnext_status` | Desk status (`Lead`, `Converted`, …) |
| `phone` | `mobile_no` |
| `email` | `email_id` when stored |

Empty clinic → `[]`, not an error.
